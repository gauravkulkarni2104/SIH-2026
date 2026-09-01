"""
Real OSM/Overpass geometry matching with proper multi-provider failover.

Key correctness rule this module exists to enforce: a provider being down is
NOT the same thing as a provider telling us "no building here." Those two
cases must never collapse into the same status, or "geometry unavailable"
silently starts meaning two different things to the person reading it.

Failover algorithm, per radius in the configured escalation list:
  1. Try providers in configured order.
  2. If a provider fails at the network/HTTP/timeout level, move to the next
     provider IMMEDIATELY at the SAME radius. We never retry a failed
     provider at a different radius before trying its siblings.
  3. The first provider that returns a valid HTTP response (empty or with
     candidates) ends this radius's provider loop — we don't keep polling
     other providers once we have a real answer.
  4. Radius only escalates after a successful (valid) query — either because
     it returned zero usable candidates, or because its best candidate was
     below the match threshold. A radius where every provider failed is
     still escalated (so a transient outage doesn't get permanently stuck),
     but the final status distinguishes "every attempt failed" from
     "providers answered and found nothing."
"""
from __future__ import annotations
import os
import json
import time
import math
import logging
from typing import Optional
import httpx
from shapely.geometry import Polygon, Point
import requests
import xml.etree.ElementTree as ET
from . import cache

logger = logging.getLogger("ulpin.geometry")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [geometry] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# ---------------------------------------------------------------- config

def _configured_providers() -> list[dict]:
    """
    Reads OVERPASS_ENDPOINT_1 / _2 / _3 (extendable to _4, _5, ...). Falls
    back to the legacy OVERPASS_URL / OVERPASS_FALLBACK_URL variables, and
    finally to two public defaults, so the app still works out of the box.
    """
    providers = []
    i = 1
    while True:
        url = os.environ.get(f"OVERPASS_ENDPOINT_{i}")
        if not url:
            break
        providers.append({"name": f"overpass-endpoint-{i}", "url": url})
        i += 1

    if not providers:
        legacy_primary = os.environ.get("OVERPASS_URL")
        legacy_fallback = os.environ.get("OVERPASS_FALLBACK_URL")
        if legacy_primary:
            providers.append({"name": "overpass-primary", "url": legacy_primary})
        if legacy_fallback:
            providers.append({"name": "overpass-fallback", "url": legacy_fallback})

    if not providers:
        providers = [
            {"name": "overpass-de", "url": "https://overpass-api.de/api/interpreter"},
            {"name": "overpass-kumi", "url": "https://overpass.kumi.systems/api/interpreter"},
        ]
    return providers


def _configured_radii() -> list[float]:
    raw = os.environ.get("GEOMETRY_SEARCH_RADII", "50,100,250")
    try:
        return [float(x.strip()) for x in raw.split(",") if x.strip()]
    except ValueError:
        return [50.0, 100.0, 250.0]


MATCH_THRESHOLD = float(os.environ.get("GEOMETRY_MATCH_THRESHOLD", 0.80))
WEIGHTS = {"distance": 0.40, "area": 0.30, "containment": 0.20, "validity": 0.10}
REQUEST_TIMEOUT_S = float(os.environ.get("OVERPASS_TIMEOUT_S", 12))

CACHE_PATH = os.environ.get(
    "GEOMETRY_CACHE_PATH",
    os.path.join(os.path.dirname(__file__), "..", ".cache", "geometry_cache.json"),
)
POSITIVE_CACHE_TTL_S = 6 * 3600   # matched / unverified results — geometry rarely changes
NEGATIVE_CACHE_TTL_S = 5 * 60     # confirmed-empty results — short, so real new data isn't hidden long
# Provider failures are never cached — a retry must always hit the network again.

# In-memory, process-lifetime record of the last attempt against each provider,
# independent of any one ULPIN lookup. Powers a general provider-health view.
_PROVIDER_STATE: dict[str, dict] = {}


def provider_health() -> list[dict]:
    providers = _configured_providers()
    out = []
    for p in providers:
        state = _PROVIDER_STATE.get(p["name"])
        out.append({
            "name": p["name"],
            "url": p["url"],
            "status": state["outcome"] if state else "AVAILABLE",
            "lastCheckedAt": state["timestamp"] if state else None,
            "lastHttpStatus": state["httpStatus"] if state else None,
            "lastElapsedMs": state["elapsedMs"] if state else None,
        })
    return out


# ---------------------------------------------------------------- cache

def _load_cache() -> dict:
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_cache(cache: dict):
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w") as f:
        json.dump(cache, f)


def _cache_get(ulpin: str) -> Optional[dict]:
    res = cache.cache_get(f"geometry:{ulpin}")
    if res:
        return res
    local_cache = _load_cache()
    entry = local_cache.get(ulpin)
    if not entry:
        return None
    age = time.time() - entry.get("_cachedAt", 0)
    ttl = POSITIVE_CACHE_TTL_S if entry.get("_kind") == "positive" else NEGATIVE_CACHE_TTL_S
    if age >= ttl:
        return None
    result = dict(entry["result"])
    result["cached"] = True
    return result


def _cache_put(ulpin: str, result: dict):
    # UNAVAILABLE (provider failure) is intentionally never cached.
    if result.get("status") == "UNAVAILABLE":
        return
    ttl = 86400 if result.get("status") in ("MATCHED", "UNVERIFIED") else 300
    cache.cache_set(f"geometry:{ulpin}", result, ttl_seconds=ttl)
    kind = "positive" if result.get("status") in ("MATCHED", "UNVERIFIED") else "negative"
    local_cache = _load_cache()
    local_cache[ulpin] = {"_cachedAt": time.time(), "_kind": kind, "result": result}
    _save_cache(local_cache)


# ---------------------------------------------------------------- geometry math

def _haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _local_meters_ring(ring_lonlat, origin_lat):
    R = 6371000
    pts = []
    for lon, lat in ring_lonlat:
        x = math.radians(lon) * R * math.cos(math.radians(origin_lat))
        y = math.radians(lat) * R
        pts.append((x, y))
    return pts


# ---------------------------------------------------------------- provider query

def _classify_and_query(provider: dict, lat: float, lon: float, radius: float) -> dict:
    """
    Executes one query against one provider at one radius. Returns a dict:
    { outcome, httpStatus, elapsedMs, data (or None), errorDetail }
    outcome is one of: NETWORK_ERROR, HTTP_5XX, TIMEOUT, VALID_EMPTY_RESULT, VALID_CANDIDATE_RESULT
    Never raises — every failure mode is captured as an outcome so the caller
    can move on to the next provider without a try/except at the call site.
    """
    query = f'[out:json][timeout:{int(REQUEST_TIMEOUT_S)}];way(around:{radius},{lat},{lon})["building"];(._;>;);out body;'
    start = time.monotonic()
    try:
        resp = httpx.post(provider["url"], data=query, timeout=REQUEST_TIMEOUT_S)
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
    except httpx.TimeoutException as e:
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        return {"outcome": "TIMEOUT", "httpStatus": None, "elapsedMs": elapsed_ms, "data": None, "errorDetail": str(e)}
    except (httpx.ConnectError, httpx.NetworkError, httpx.TransportError) as e:
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        return {"outcome": "NETWORK_ERROR", "httpStatus": None, "elapsedMs": elapsed_ms, "data": None, "errorDetail": str(e)}
    except Exception as e:  # noqa: BLE001 - any other transport-level failure is still a provider failure, not "no building"
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        return {"outcome": "NETWORK_ERROR", "httpStatus": None, "elapsedMs": elapsed_ms, "data": None, "errorDetail": str(e)}

    if 500 <= resp.status_code < 600:
        return {"outcome": "HTTP_5XX", "httpStatus": resp.status_code, "elapsedMs": elapsed_ms, "data": None, "errorDetail": resp.text[:200]}
    if resp.status_code != 200:
        # Non-5xx, non-200 (e.g. 400 bad query, 403 blocked) is still a provider-side failure,
        # not evidence about the building — bucket with NETWORK_ERROR rather than inventing a new category.
        return {"outcome": "NETWORK_ERROR", "httpStatus": resp.status_code, "elapsedMs": elapsed_ms, "data": None, "errorDetail": resp.text[:200]}

    try:
        data = resp.json()
    except Exception as e:  # noqa: BLE001
        return {"outcome": "NETWORK_ERROR", "httpStatus": resp.status_code, "elapsedMs": elapsed_ms, "data": None, "errorDetail": f"invalid JSON: {e}"}

    ways = [el for el in data.get("elements", []) if el.get("type") == "way" and el.get("tags", {}).get("building")]
    if not ways:
        return {"outcome": "VALID_EMPTY_RESULT", "httpStatus": resp.status_code, "elapsedMs": elapsed_ms, "data": data, "errorDetail": None}
    return {"outcome": "VALID_CANDIDATE_RESULT", "httpStatus": resp.status_code, "elapsedMs": elapsed_ms, "data": data, "errorDetail": None}

def _query_osm_nominatim(lat: float, lon: float, radius: float) -> dict:
    """
    Fallback geometry provider using OpenStreetMap Nominatim.

    This is supplementary OSM geometry, NOT official cadastral data.
    """

    # Nominatim works best with a small local search.
    # We search around the coordinate and request GeoJSON geometry.
    delta = radius / 111320.0

    viewbox = (
        f"{lon - delta},"
        f"{lat + delta},"
        f"{lon + delta},"
        f"{lat - delta}"
    )

    url = "https://nominatim.openstreetmap.org/search"

    params = {
        "q": f"{lat},{lon}",
        "format": "jsonv2",
        "limit": 10,
        "viewbox": viewbox,
        "bounded": 1,
        "polygon_geojson": 1,
        "addressdetails": 1,
    }

    headers = {
        "User-Agent": "ULPIN-Digital-Twin/1.0"
    }

    try:
        start = time.monotonic()

        response = requests.get(
            url,
            params=params,
            headers=headers,
            timeout=REQUEST_TIMEOUT_S,
        )

        elapsed_ms = round(
            (time.monotonic() - start) * 1000,
            1
        )

        if response.status_code != 200:
            return {
                "outcome": "HTTP_ERROR",
                "httpStatus": response.status_code,
                "elapsedMs": elapsed_ms,
                "data": None,
                "errorDetail": response.text[:200],
            }

        data = response.json()

        candidates = []

        for item in data:

            geometry = item.get("geojson")

            if not geometry:
                continue

            # We mainly want building objects.
            osm_type = item.get("type", "")
            osm_class = item.get("class", "")

            if (
                osm_type not in {
                    "house",
                    "building",
                    "residential",
                    "apartments",
                }
                and osm_class != "building"
            ):
                continue

            candidates.append({
                "building": item.get("display_name"),
                "osmType": item.get("osm_type"),
                "osmId": item.get("osm_id"),
                "lat": float(item["lat"]),
                "lon": float(item["lon"]),
                "geometry": geometry,
                "source": "OpenStreetMap Nominatim",
            })

        return {
            "outcome": "VALID_RESULT",
            "httpStatus": response.status_code,
            "elapsedMs": elapsed_ms,
            "data": {
                "elements": candidates
            },
            "errorDetail": None,
        }

    except requests.Timeout:
        return {
            "outcome": "TIMEOUT",
            "httpStatus": None,
            "elapsedMs": None,
            "data": None,
            "errorDetail": "Nominatim request timed out",
        }

    except requests.RequestException as exc:
        return {
            "outcome": "NETWORK_ERROR",
            "httpStatus": None,
            "elapsedMs": None,
            "data": None,
            "errorDetail": str(exc)[:200],
        }

    except Exception as exc:
        return {
            "outcome": "PARSE_ERROR",
            "httpStatus": None,
            "elapsedMs": None,
            "data": None,
            "errorDetail": str(exc)[:200],
        }

def _query_osm_map_api(lat: float, lon: float, radius: float) -> dict:
    """
    Fallback geometry provider using the OpenStreetMap Map API.

    Returns OSM nodes + building ways in the same structure expected by
    _score_candidates().

    This is supplementary OSM geometry, NOT official cadastral data.
    """

    lat_delta = radius / 111320.0

    # Correct longitude distance for latitude.
    lon_delta = radius / (
        111320.0 * max(math.cos(math.radians(lat)), 0.01)
    )

    west = lon - lon_delta
    south = lat - lat_delta
    east = lon + lon_delta
    north = lat + lat_delta

    url = "https://api.openstreetmap.org/api/0.6/map"

    params = {
        "bbox": f"{west},{south},{east},{north}"
    }

    headers = {
        "User-Agent": "ULPIN-Digital-Twin/1.0"
    }

    start = time.monotonic()

    try:
        response = requests.get(
            url,
            params=params,
            headers=headers,
            timeout=REQUEST_TIMEOUT_S,
        )

        elapsed_ms = round(
            (time.monotonic() - start) * 1000,
            1
        )

        if response.status_code != 200:
            return {
                "outcome": "HTTP_ERROR",
                "httpStatus": response.status_code,
                "elapsedMs": elapsed_ms,
                "data": None,
                "errorDetail": response.text[:200],
            }

        root = ET.fromstring(response.content)

        elements = []

        # ---------------------------------------------------------
        # Convert OSM XML nodes to our internal element format.
        # ---------------------------------------------------------
        for node in root.findall("node"):
            element = {
                "type": "node",
                "id": int(node.attrib["id"]),
                "lat": float(node.attrib["lat"]),
                "lon": float(node.attrib["lon"]),
            }

            tags = {}
            for tag in node.findall("tag"):
                tags[tag.attrib["k"]] = tag.attrib["v"]

            if tags:
                element["tags"] = tags

            elements.append(element)

        # ---------------------------------------------------------
        # Convert only building ways.
        # ---------------------------------------------------------
        building_count = 0

        for way in root.findall("way"):
            tags = {
                tag.attrib["k"]: tag.attrib["v"]
                for tag in way.findall("tag")
            }

            if not tags.get("building"):
                continue

            node_refs = [
                int(nd.attrib["ref"])
                for nd in way.findall("nd")
            ]

            if len(node_refs) < 3:
                continue

            elements.append({
                "type": "way",
                "id": int(way.attrib["id"]),
                "nodes": node_refs,
                "tags": tags,
            })

            building_count += 1

        logger.info(
            "OSM Map API returned %d building way(s) radiusM=%s",
            building_count,
            radius,
        )

        return {
            "outcome": (
                "VALID_CANDIDATE_RESULT"
                if building_count > 0
                else "VALID_EMPTY_RESULT"
            ),
            "httpStatus": response.status_code,
            "elapsedMs": elapsed_ms,
            "data": {
                "elements": elements
            },
            "errorDetail": None,
        }

    except requests.Timeout:
        return {
            "outcome": "TIMEOUT",
            "httpStatus": None,
            "elapsedMs": round(
                (time.monotonic() - start) * 1000,
                1
            ),
            "data": None,
            "errorDetail": "OSM Map API request timed out",
        }

    except requests.RequestException as exc:
        return {
            "outcome": "NETWORK_ERROR",
            "httpStatus": None,
            "elapsedMs": round(
                (time.monotonic() - start) * 1000,
                1
            ),
            "data": None,
            "errorDetail": str(exc)[:200],
        }

    except ET.ParseError as exc:
        return {
            "outcome": "PARSE_ERROR",
            "httpStatus": response.status_code if "response" in locals() else None,
            "elapsedMs": round(
                (time.monotonic() - start) * 1000,
                1
            ),
            "data": None,
            "errorDetail": f"Invalid OSM XML: {exc}",
        }

    except Exception as exc:
        return {
            "outcome": "PARSE_ERROR",
            "httpStatus": response.status_code if "response" in locals() else None,
            "elapsedMs": round(
                (time.monotonic() - start) * 1000,
                1
            ),
            "data": None,
            "errorDetail": str(exc)[:200],
        }

def _score_candidates(data: dict, lat: float, lon: float, area_m2: float, radius: float) -> list[dict]:
    nodes = {el["id"]: (el["lon"], el["lat"]) for el in data.get("elements", []) if el["type"] == "node"}
    ways = [el for el in data.get("elements", []) if el["type"] == "way" and el.get("tags", {}).get("building")]

    candidates = []
    for w in ways:
        ring = [nodes[n] for n in w.get("nodes", []) if n in nodes]
        if len(ring) < 3:
            continue
        clat = sum(p[1] for p in ring) / len(ring)
        clon = sum(p[0] for p in ring) / len(ring)

        local_pts = _local_meters_ring(ring, clat)

        try:
            poly = Polygon(local_pts)

            if not poly.is_valid:
                poly = poly.buffer(0)

            cand_area = poly.area

            valid_score = (
                1.0
                if poly.is_valid and cand_area > 0
                else 0.5
            )

            origin_local = _local_meters_ring(
                [(lon, lat)],
                clat
            )[0]

            point = Point(origin_local)

            contained = 1.0 if poly.contains(point) else 0.0

            if contained == 0.0:
              boundary_distance_m = poly.distance(point)
              if boundary_distance_m <= 2.0:
                 contained = 1.0
              elif boundary_distance_m <= 5.0:
                    contained = 0.75
              elif boundary_distance_m <= 10.0:
                 contained = 0.5

            centroid_distance_m = _haversine(
                lat,
                lon,
                clat,
                clon,
            )

            polygon_distance_m = poly.distance(point)

            dist = min(
                centroid_distance_m,
                polygon_distance_m,
            )

        except Exception:
            cand_area = 0.0
            valid_score = 0.0
            contained = 0.0
            dist = _haversine(
                lat,
                lon,
                clat,
                clon,
            )

        area_sim = 0.0
        if cand_area > 0:
            area_sim = max(0.0, 1 - abs(cand_area - area_m2) / max(cand_area, area_m2))
        dist_score = max(0.0, 1 - dist / radius)

        score = (
            dist_score * WEIGHTS["distance"]
            + area_sim * WEIGHTS["area"]
            + contained * WEIGHTS["containment"]
            + valid_score * WEIGHTS["validity"]
        )
        candidates.append({
            "wayId": w["id"],
            "buildingTag": w["tags"].get("building"),
            "ring": ring,
            "distanceM": round(dist, 2),
            "candidateAreaM2": round(cand_area, 2),
            "areaSimilarity": round(area_sim, 3),
            "containment": bool(contained),
            "confidence": round(score, 4),
        })
    candidates.sort(key=lambda c: c["confidence"], reverse=True)
    return candidates


# ---------------------------------------------------------------- public entry point

def match_geometry(ulpin: str, lat: float, lon: float, area_m2: float, use_cache: bool = True) -> dict:
    if use_cache:
        cached = _cache_get(ulpin)
        if cached:
            return cached

    providers = _configured_providers()
    radii = _configured_radii()
    attempts = []
    any_success_this_run = False
    best_overall = None
    radius_used = None

    for radius in radii:
        for provider in providers:
            result = _classify_and_query(provider, lat, lon, radius)

            elapsed = result["elapsedMs"]
            candidate_count = 0
            if result["data"]:
                candidate_count = len([
                    el for el in result["data"].get("elements", [])
                    if el.get("type") == "way" and el.get("tags", {}).get("building")
                ])

            logger.info(
                "provider=%s endpoint=%s httpStatus=%s elapsedMs=%s radiusM=%s outcome=%s candidates=%d",
                provider["name"], provider["url"], result["httpStatus"], elapsed, radius, result["outcome"], candidate_count,
            )

            _PROVIDER_STATE[provider["name"]] = {
                "outcome": result["outcome"], "httpStatus": result["httpStatus"],
                "elapsedMs": elapsed, "timestamp": time.time(),
            }

            attempts.append({
                "provider": provider["name"], "endpoint": provider["url"], "radiusM": radius,
                "outcome": result["outcome"], "httpStatus": result["httpStatus"],
                "elapsedMs": elapsed, "candidateCount": candidate_count,
            })

            if result["outcome"] in ("NETWORK_ERROR", "HTTP_5XX", "TIMEOUT"):
                # This provider failed — move to the NEXT PROVIDER at the SAME radius.
                # We do not retry this same endpoint, and we do not change radius yet.
                continue

            # VALID_EMPTY_RESULT or VALID_CANDIDATE_RESULT: this radius got a real answer.
            any_success_this_run = True

            if result["outcome"] == "VALID_CANDIDATE_RESULT":
                scored = _score_candidates(result["data"], lat, lon, area_m2, radius)
                if scored and (best_overall is None or scored[0]["confidence"] > best_overall["confidence"]):
                    best_overall = scored[0]
                    radius_used = radius
                if scored and scored[0]["confidence"] >= MATCH_THRESHOLD:
                    final = {
                        "source": "OpenStreetMap", "confidence": scored[0]["confidence"],
                        "isOfficial": False, "isEstimated": False,
                        "status": "MATCHED", "message": None,
                        "candidate": scored[0], "allCandidates": scored[:6],
                        "radiusUsedM": radius, "attempts": attempts, "cached": False,
                    }
                    _cache_put(ulpin, final)
                    return final
                # valid result but below threshold -> "no suitable candidate at this radius",
                # which is exactly the documented trigger to escalate to the next radius.
            break  # stop trying other providers at this radius; we got a real (non-failure) answer

    # Exhausted all radii.
    if best_overall is not None:
        result = {
            "source": "OpenStreetMap (unverified)", "confidence": best_overall["confidence"],
            "isOfficial": False, "isEstimated": False,
            "status": "UNVERIFIED",
            "message": "Best candidate across all search radii scored below the match threshold.",
            "candidate": best_overall, "allCandidates": [best_overall],
            "radiusUsedM": radius_used, "attempts": attempts, "cached": False,
        }
        _cache_put(ulpin, result)
        return result
    
    
    if any_success_this_run:
        # At least one radius returned a valid, empty response — providers are working,
        # they simply found no building polygon near this point.
        result = {
            "source": None,
            "confidence": 0.0,
            "isOfficial": False,
            "isEstimated": False,
            "status": "NO_CANDIDATES",
            "message": "All reachable providers returned a valid response with no building polygons in range.",
            "candidate": None,
            "allCandidates": [],
            "radiusUsedM": radii[-1],
            "attempts": attempts,
            "cached": False,
        }
        _cache_put(ulpin, result)
        return result


    # ---------------------------------------------------------
    # OSM NOMINATIM FALLBACK
    # ---------------------------------------------------------
    logger.info(
        "All Overpass providers failed. Trying OpenStreetMap Map API fallback."
    )

    osm_result = _query_osm_map_api(
        lat,
        lon,
        radii[-1],
    )

    osm_candidate_count = 0

    if osm_result.get("data"):
        osm_candidate_count = len([
            el
            for el in osm_result["data"].get("elements", [])
            if (
                el.get("type") == "way"
                and el.get("tags", {}).get("building")
            )
        ])

    attempts.append({
        "provider": "osm-map-api",
        "endpoint": "https://api.openstreetmap.org/api/0.6/map",
        "radiusM": radii[-1],
        "outcome": osm_result["outcome"],
        "httpStatus": osm_result["httpStatus"],
        "elapsedMs": osm_result["elapsedMs"],
        "candidateCount": osm_candidate_count,
    })

    logger.info(
        "OSM Map API fallback returned %d building candidate(s)",
        osm_candidate_count,
    )

    if (
        osm_result["outcome"] == "VALID_CANDIDATE_RESULT"
        and osm_result.get("data")
    ):
        scored = _score_candidates(
            osm_result["data"],
            lat,
            lon,
            area_m2,
            radii[-1],
        )

        if scored:
            best = scored[0]

            if best["confidence"] >= MATCH_THRESHOLD:
                result = {
                    "source": "OpenStreetMap",
                    "confidence": best["confidence"],
                    "isOfficial": False,
                    "isEstimated": False,
                    "status": "MATCHED",
                    "message": (
                        "Building geometry obtained from OpenStreetMap "
                        "as supplementary data; not official cadastral geometry."
                    ),
                    "candidate": best,
                    "allCandidates": scored[:6],
                    "radiusUsedM": radii[-1],
                    "attempts": attempts,
                    "cached": False,
                }

                _cache_put(ulpin, result)
                return result

            result = {
                "source": "OpenStreetMap (unverified)",
                "confidence": best["confidence"],
                "isOfficial": False,
                "isEstimated": False,
                "status": "UNVERIFIED",
                "message": (
                    "OpenStreetMap returned building geometry, but the "
                    "candidate scored below the match threshold."
                ),
                "candidate": best,
                "allCandidates": scored[:6],
                "radiusUsedM": radii[-1],
                "attempts": attempts,
                "cached": False,
            }

            _cache_put(ulpin, result)
            return result

    if osm_result["outcome"] not in (
        "VALID_EMPTY_RESULT",
        "VALID_CANDIDATE_RESULT",
    ):
        logger.warning(
            "OSM Map API fallback failed: %s",
            osm_result.get("errorDetail"),
        )


    # Every single provider, at every radius, failed at the network/HTTP/timeout level.
    result = {
        "source": None,
        "confidence": 0.0,
        "isOfficial": False,
        "isEstimated": False,
        "status": "UNAVAILABLE",
        "message": "All configured geometry providers failed (network/server/timeout errors) — this says nothing about whether a building exists.",
        "candidate": None,
        "allCandidates": [],
        "radiusUsedM": None,
        "attempts": attempts,
        "cached": False,
    }

    _cache_put(ulpin, result)
    return result

    
    