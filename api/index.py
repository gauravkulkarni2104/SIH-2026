from __future__ import annotations
import math
import os
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from shapely.geometry import Polygon

import time
from . import data_loader, geometry, overlap, polygon_overlap, cache
from .elevation import get_open_meteo_elevation, validate_elevation
from .satellite import (
    check_satellite_service,
    search_sentinel2,
    get_sentinel2_image,
)
from fastapi.responses import Response

load_dotenv()

app = FastAPI(title="ULPIN Digital Twin API", version="1.0.0")

# Allowed origins for CORS (Vercel deployment, localhost ports, and local dev)
origins = [
    "https://sih-2026-g6vh.vercel.app",
    "https://sih-2026-chi-eight.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]

env_origins = os.environ.get("ALLOWED_ORIGINS")
if env_origins:
    if env_origins.strip() == "*":
        origins = ["*"]
    else:
        for origin in env_origins.split(","):
            o = origin.strip().rstrip("/")
            if o and o not in origins:
                origins.append(o)

is_wildcard = "*" in origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=None if is_wildcard else r"^https:\/\/[a-zA-Z0-9_-]+\.vercel\.app$",
    allow_credentials=False if is_wildcard else True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)


@app.options("/{full_path:path}")
async def options_preflight_handler(full_path: str):
    """Handle direct and preflight OPTIONS requests gracefully."""
    return Response(status_code=200)

BHUVAN_TOKEN = os.environ.get("BHUVAN_API_TOKEN", "").strip()
OPENTOPO_KEY = os.environ.get("OPENTOPOGRAPHY_API_KEY", "").strip()

_DATASET, _REPORT = data_loader.load_dataset()


def _f(v, default=0.0) -> float:
    try:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _record(row) -> dict:
    dem = _f(row.get("dem_m_asl"))
    dsm = _f(row.get("dsm_m_asl"))
    floors = int(_f(row.get("floors"), 1)) or 1

    floor_h_raw = row.get("floor_height_m")
    floor_h_present = floor_h_raw is not None and not (isinstance(floor_h_raw, float) and math.isnan(floor_h_raw))
    floor_h = _f(floor_h_raw, 3.0) or 3.0
    floor_height_estimated = not floor_h_present  # CSV didn't supply it — we defaulted to 3.0m

    registered_h = _f(row.get("building_height_m"))
    calculated_h = round(dsm - dem, 2) if dsm and dem else None
    height_consistent = None
    if calculated_h is not None and registered_h:
        height_consistent = abs(calculated_h - registered_h) <= 0.5

    if calculated_h is not None and calculated_h > 0:
        used_height, height_source = calculated_h, "calculated (DSM-DEM)"
    elif registered_h:
        used_height, height_source = registered_h, "registered (CSV)"
    else:
        used_height, height_source = round(floors * floor_h, 2), "estimated (floors x floor_height)"

    quality = {
        "ulpinMatched": True,
        "coordinatesValid": row.get("ulpin") not in _REPORT.invalid_coordinates,
        "propertyTypeAvailable": bool(row.get("type")) and str(row.get("type")) != "nan",
        "floorDataAvailable": bool(row.get("floors")) and not (isinstance(row.get("floors"), float) and math.isnan(row.get("floors"))),
        "demAvailable": bool(dem),
        "dsmAvailable": bool(dsm),
        "heightValidated": height_consistent is True,
    }

    return {
        "ulpin": row.get("ulpin"),
        "type": row.get("type"),
        "area_m2": _f(row.get("area_m2")),
        "perimeter_m": _f(row.get("perimeter_m")),
        "latitude": _f(row.get("latitude")),
        "longitude": _f(row.get("longitude")),
        "floors": floors,
        "floor_height_m": floor_h,
        "floor_height_estimated": floor_height_estimated,
        "building_height_m": used_height,
        "height_source": height_source,
        "registered_height_m": registered_h or None,
        "dem_m_asl": dem,
        "dsm_m_asl": dsm or None,
        "calculated_height_m": calculated_h,
        "height_consistent": height_consistent,
        "dataQuality": quality,
    }


def _get_record(ulpin: str) -> dict:
    cached = cache.cache_get(f"ulpin:{ulpin}")
    if cached:
        return cached
    match = _DATASET[_DATASET["ulpin"] == ulpin]
    if match.empty:
        raise HTTPException(status_code=404, detail=f"ULPIN '{ulpin}' not found in dataset")
    rec = _record(match.iloc[0])
    cache.cache_set(f"ulpin:{ulpin}", rec, ttl_seconds=86400)
    return rec


def _all_records() -> list[dict]:
    return [_record(r) for _, r in _DATASET.iterrows()]


def _haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- health/meta

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "csvLoaded": len(_REPORT.files_loaded) == 3 and not _REPORT.errors,
        "filesLoaded": _REPORT.files_loaded,
        "rowCounts": _REPORT.row_counts,
        "errors": _REPORT.errors,
        "optionalServices": {
            "bhuvan": bool(BHUVAN_TOKEN),
            "openTopography": bool(OPENTOPO_KEY),
        },
    }


@app.get("/api/stats")
def stats():
    records = _all_records()
    return {
        "totalParcels": len(records),
        "propertyTypes": sorted({r["type"] for r in records if r["type"]}),
        "totalArea_m2": round(sum(r["area_m2"] for r in records), 2),
        "avgFloors": round(sum(r["floors"] for r in records) / len(records), 2) if records else 0,
        "heightMismatches": sum(1 for r in records if r["height_consistent"] is False),
        "dataQuality": {
            "invalidCoordinates": _REPORT.invalid_coordinates,
            "duplicateUlpins": _REPORT.duplicate_ulpins,
            "unmatchedAcrossFiles": _REPORT.unmatched_ulpins,
            "missingValues": _REPORT.missing_values,
        },
    }


# ---------------------------------------------------------------- ulpins

@app.get("/api/ulpins")
def list_ulpins(q: Optional[str] = Query(None, description="filter by ULPIN substring or property type")):
    records = _all_records()
    if q:
        ql = q.lower()
        records = [r for r in records if ql in str(r["ulpin"]).lower() or ql in str(r["type"]).lower()]
    return {"count": len(records), "results": records}


@app.get("/api/ulpin/{ulpin}")
def get_ulpin(ulpin: str):
    return _get_record(ulpin)

@app.get("/api/ulpin/{ulpin}/elevation-validation")
def elevation_validation(ulpin: str):
    record = _get_record(ulpin)

    if not record:
        raise HTTPException(status_code=404, detail="ULPIN not found")

    latitude = record.get("latitude")
    longitude = record.get("longitude")
    local_dem = record.get("dem_m_asl")

    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=400,
            detail="Latitude or longitude is unavailable for this ULPIN"
        )

    external_elevation = get_open_meteo_elevation(
        float(latitude),
        float(longitude)
    )

    validation = validate_elevation(
        local_dem,
        external_elevation
    )

    return {
        "ulpin": ulpin,
        "latitude": latitude,
        "longitude": longitude,
        "local_dem_m": local_dem,
        "open_meteo_elevation_m": external_elevation,
        **validation
    }
@app.get("/api/ulpin/{ulpin}/satellite")
async def satellite_validation(ulpin: str):
    record = _get_record(ulpin)

    latitude = record.get("latitude")
    longitude = record.get("longitude")

    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=400,
            detail="Latitude or longitude is unavailable for this ULPIN"
        )

    result = await check_satellite_service(
        float(latitude),
        float(longitude)
    )

    return {
        "ulpin": ulpin,
        **result
    }
@app.get("/api/ulpin/{ulpin}/satellite/search")
async def satellite_search(
    ulpin: str,
    days_back: int = 30,
    max_cloud_cover: float = 30.0,
):
    record = _get_record(ulpin)

    latitude = record.get("latitude")
    longitude = record.get("longitude")

    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=400,
            detail="Latitude or longitude is unavailable for this ULPIN"
        )

    result = await search_sentinel2(
        float(latitude),
        float(longitude),
        days_back=days_back,
        max_cloud_cover=max_cloud_cover,
    )

    return {
        "ulpin": ulpin,
        **result
    }
@app.get("/api/ulpin/{ulpin}/satellite/image")
async def satellite_image(ulpin: str):
    record = _get_record(ulpin)

    latitude = record.get("latitude")
    longitude = record.get("longitude")

    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=400,
            detail="Latitude or longitude is unavailable for this ULPIN"
        )

    result = await get_sentinel2_image(
        float(latitude),
        float(longitude),
    )

    if result.get("status") != "AVAILABLE":
        raise HTTPException(
            status_code=503,
            detail=result.get(
                "reason",
                "Satellite imagery unavailable"
            ),
        )

    return Response(
        content=result["image_bytes"],
        media_type="image/png",
    )
@app.get("/api/ulpin/{ulpin}/geometry")
def get_geometry(ulpin: str, refresh: bool = False):
    """
    refresh=true is the RETRY path: it bypasses the cache and walks the full
    provider/radius chain again from scratch (never re-hits a provider that
    just failed without trying its siblings first — see geometry.py).
    """
    rec = _get_record(ulpin)
    result = geometry.match_geometry(
        rec["ulpin"], rec["latitude"], rec["longitude"], rec["area_m2"], use_cache=not refresh
    )
    return result


@app.get("/api/providers/status")
def providers_status():
    """Last known health of each configured geometry provider, independent of any single ULPIN."""
    return {"providers": geometry.provider_health()}


@app.get("/api/ulpin/{ulpin}/nearby")
def get_nearby(ulpin: str, limit: int = 10):
    t0 = time.perf_counter()
    cache_key = f"nearby:{ulpin}"
    cached = cache.cache_get(cache_key)
    if cached:
        return cached

    rec = _get_record(ulpin)
    target_lat, target_lon = rec["latitude"], rec["longitude"]

    # Use spatial KDTree index to query candidate indices in 0ms
    candidate_indices = data_loader.query_spatial_index(target_lat, target_lon, k=min(limit * 3 + 5, len(_DATASET)))

    others = []
    seen = set()
    for idx in candidate_indices:
        row = _DATASET.iloc[idx]
        other_ulpin = str(row.get("ulpin"))
        if other_ulpin == rec["ulpin"] or other_ulpin in seen:
            continue
        seen.add(other_ulpin)
        other_lat, other_lon = _f(row.get("latitude")), _f(row.get("longitude"))
        d = _haversine(target_lat, target_lon, other_lat, other_lon)
        others.append({
            "ulpin": other_ulpin,
            "distanceM": round(d, 2),
            "type": str(row.get("type")),
            "latitude": other_lat,
            "longitude": other_lon,
        })

    others.sort(key=lambda o: o["distanceM"])
    result = {"ulpin": ulpin, "count": len(others), "results": others[:limit]}
    cache.cache_set(cache_key, result, ttl_seconds=86400)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    logging.getLogger("ulpin.main").info("[PERF] Nearby search for %s completed in %s ms", ulpin, elapsed_ms)
    return result


@app.get("/api/ulpin/{ulpin}/3d")
def get_3d(ulpin: str):
    t0 = time.perf_counter()
    cache_key = f"3d:{ulpin}"
    cached = cache.cache_get(cache_key)
    if cached:
        return cached

    rec = _get_record(ulpin)
    geo = geometry.match_geometry(rec["ulpin"], rec["latitude"], rec["longitude"], rec["area_m2"])

    top_elevation = round(rec["dem_m_asl"] + rec["building_height_m"], 2)
    floors = overlap.floor_intervals(rec["dem_m_asl"], rec["floors"], rec["floor_height_m"])
    for f in floors:
        f["isEstimated"] = rec["floor_height_estimated"]

    floors.append({
        "index": len(floors), "label": "ROOF",
        "bottomM": top_elevation, "topM": round(top_elevation + 0.3, 2),
        "isEstimated": True,
    })

    provenance = {"cadastralBoundary": "NOT AVAILABLE"}

    if geo["status"] == "MATCHED":
        raw_ring = geo["candidate"]["ring"]
        local_pts = geometry._local_meters_ring(raw_ring, rec["latitude"])
        try:
            poly = Polygon(local_pts)
            geometry_valid = poly.is_valid
            if not poly.is_valid:
                poly = poly.buffer(0)
            exterior = list(poly.exterior.coords)
            R = 6371000.0
            lat0 = rec["latitude"]
            footprint = [
                [math.degrees(x / (R * math.cos(math.radians(lat0)))), math.degrees(y / R)]
                for x, y in exterior
            ]
        except Exception:
            geometry_valid = False
            footprint = raw_ring

        footprint_source = "OpenStreetMap"
        is_estimated = False
        provenance.update({
            "label": "OPEN-DATA MATCHED FOOTPRINT",
            "source": "OpenStreetMap",
            "confidence": geo["confidence"],
            "distanceM": geo["candidate"]["distanceM"],
            "areaSimilarity": geo["candidate"]["areaSimilarity"],
            "osmWayId": geo["candidate"]["wayId"],
            "geometryValid": geometry_valid,
        })
    else:
        side = math.sqrt(rec["area_m2"])
        r = side / math.sqrt(2)
        footprint = []
        for i in range(4):
            a = (i / 4) * 2 * math.pi + math.pi / 4
            dlat = (r * math.sin(a)) / 111320
            dlon = (r * math.cos(a)) / (111320 * math.cos(math.radians(rec["latitude"])) or 1)
            footprint.append([rec["longitude"] + dlon, rec["latitude"] + dlat])
        footprint_source = "Estimated (area-matched)"
        is_estimated = True
        provenance.update({
            "label": "3D VOLUMETRIC REPRESENTATION",
            "source": "Estimated footprint",
            "confidence": geo.get("confidence", 0.0),
            "geometryStatus": geo["status"],
        })

    result = {
        "ulpin": ulpin,
        "originLatitude": rec["latitude"],
        "originLongitude": rec["longitude"],
        "footprint": footprint,
        "footprintSource": footprint_source,
        "isEstimated": is_estimated,
        "isOfficial": False,
        "geometryConfidence": geo["confidence"],
        "groundElevationM": rec["dem_m_asl"],
        "topElevationM": top_elevation,
        "buildingHeightM": rec["building_height_m"],
        "heightSource": rec["height_source"],
        "floors": floors,
        "provenance": provenance,
        "label": "3D VOLUMETRIC REPRESENTATION" if is_estimated else "3D MODEL (matched OSM footprint)",
    }

    cache.cache_set(cache_key, result, ttl_seconds=86400)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    logging.getLogger("ulpin.main").info("[PERF] 3D payload for %s generated in %s ms", ulpin, elapsed_ms)
    return result


@app.get("/api/ulpin/{ulpin}/overlap")
def get_overlap(ulpin: str, with_: str = Query(..., alias="with")):
    t0 = time.perf_counter()
    sorted_a, sorted_b = sorted([ulpin, with_])
    cache_key = f"overlap:{sorted_a}:{sorted_b}"
    cached = cache.cache_get(cache_key)
    if cached:
        return cached

    recA = _get_record(ulpin)
    recB = _get_record(with_)
    geoA = geometry.match_geometry(recA["ulpin"], recA["latitude"], recA["longitude"], recA["area_m2"])
    geoB = geometry.match_geometry(recB["ulpin"], recB["latitude"], recB["longitude"], recB["area_m2"])
    report = overlap.full_overlap_report(geoA, geoB, recA, recB, recA["latitude"], recA["longitude"])
    result = {"ulpinA": ulpin, "ulpinB": with_, **report}
    cache.cache_set(cache_key, result, ttl_seconds=86400)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    logging.getLogger("ulpin.main").info("[PERF] 3D Overlap %s vs %s completed in %s ms", ulpin, with_, elapsed_ms)
    return result


class Overlap2DRequest(BaseModel):
    parcel_a_ulpin: str
    parcel_b_ulpin: str


@app.post("/api/overlap/2d")
def analyze_overlap_2d(payload: Overlap2DRequest):
    t0 = time.perf_counter()
    sorted_a, sorted_b = sorted([payload.parcel_a_ulpin, payload.parcel_b_ulpin])
    cache_key = f"overlap2d:{sorted_a}:{sorted_b}"
    cached = cache.cache_get(cache_key)
    if cached:
        return cached

    rec_a = _get_record(payload.parcel_a_ulpin)
    rec_b = _get_record(payload.parcel_b_ulpin)
    geo_a = geometry.match_geometry(rec_a["ulpin"], rec_a["latitude"], rec_a["longitude"], rec_a["area_m2"])
    geo_b = geometry.match_geometry(rec_b["ulpin"], rec_b["latitude"], rec_b["longitude"], rec_b["area_m2"])
    result = polygon_overlap.analyze_polygon_overlap_2d(
        payload.parcel_a_ulpin, payload.parcel_b_ulpin, geo_a, geo_b, rec_a, rec_b
    )
    cache.cache_set(cache_key, result, ttl_seconds=86400)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    logging.getLogger("ulpin.main").info("[PERF] 2D Overlap %s vs %s completed in %s ms", sorted_a, sorted_b, elapsed_ms)
    return result


@app.get("/")
def root():
    return {"service": "ULPIN Digital Twin API", "docs": "/docs"}
