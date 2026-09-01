"""
Stage 6 — real 2D polygon intersection engine between two matched OSM
footprints.

Purely additive: does not alter the existing OSM matching / confidence
scoring in geometry.py, nor the existing 3D volumetric overlap engine in
overlap.py (horizontal_overlap / vertical_overlap / full_overlap_report
keep working exactly as before, still backing /api/ulpin/{ulpin}/overlap).
This module backs the POST /api/overlap/2d endpoint only.

All area/distance/containment math is done in a proper projected metric
CRS (a local UTM zone, chosen from the two footprints' combined centroid)
via pyproj — never computed directly from raw latitude/longitude degrees.
"""
from __future__ import annotations
import os
import math
from typing import Optional

from pyproj import CRS, Transformer
from shapely.geometry import Polygon, mapping
from shapely.geometry.base import BaseGeometry

GEOMETRY_SOURCE = "OpenStreetMap building footprint"
DISCLAIMER = "OSM building footprint is supplementary geometry, not an official cadastral boundary."
VERIFICATION_NOTE = "Verified against matched open building footprints."

# ---------------------------------------------------------------- configurable thresholds
# Kept in one place, overridable via env vars, so nothing below has a magic number baked in.
MIN_INTERSECTION_AREA_M2 = float(os.environ.get("OVERLAP_MIN_INTERSECTION_AREA_M2", 0.01))
HIGH_OVERLAP_PERCENT = float(os.environ.get("OVERLAP_HIGH_OVERLAP_PERCENT", 70.0))
CONTAINMENT_PERCENT = float(os.environ.get("OVERLAP_CONTAINMENT_PERCENT", 95.0))


# ---------------------------------------------------------------- projection helpers

def _utm_crs_for(lon: float, lat: float) -> CRS:
    """Picks the UTM zone containing (lon, lat) — an appropriate local projected CRS for area/distance math."""
    zone = int(math.floor((lon + 180.0) / 6.0) + 1)
    south = lat < 0
    return CRS.from_dict({"proj": "utm", "zone": zone, "south": south, "datum": "WGS84"})


def _project_ring(ring_lonlat, transformer: Transformer) -> list[tuple[float, float]]:
    return [transformer.transform(lon, lat) for lon, lat in ring_lonlat]


def _build_projected_polygons(ring_a_lonlat, ring_b_lonlat):
    """
    Projects both rings into one shared local UTM zone (derived from the
    combined centroid of both footprints), repairs invalid geometry with
    buffer(0), and returns the polygons plus the CRS/transformer used and
    whether each polygon needed repair.
    """
    all_pts = list(ring_a_lonlat) + list(ring_b_lonlat)
    centroid_lon = sum(p[0] for p in all_pts) / len(all_pts)
    centroid_lat = sum(p[1] for p in all_pts) / len(all_pts)

    utm_crs = _utm_crs_for(centroid_lon, centroid_lat)
    transformer = Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True)

    raw_a = Polygon(_project_ring(ring_a_lonlat, transformer))
    raw_b = Polygon(_project_ring(ring_b_lonlat, transformer))

    valid_a_before = raw_a.is_valid
    valid_b_before = raw_b.is_valid

    poly_a = raw_a if valid_a_before else raw_a.buffer(0)
    poly_b = raw_b if valid_b_before else raw_b.buffer(0)

    repaired = {
        "a": not valid_a_before,
        "b": not valid_b_before,
    }
    return poly_a, poly_b, utm_crs, transformer, repaired


def _unproject_geometry(geom: BaseGeometry, transformer: Transformer) -> Optional[dict]:
    """Converts a geometry (in projected metres) back to lon/lat GeoJSON for the map."""
    if geom is None or geom.is_empty:
        return None

    inverse = Transformer.from_crs(transformer.target_crs, transformer.source_crs, always_xy=True)

    def ring_to_lonlat(coords):
        return [list(inverse.transform(x, y)) for x, y in coords]

    if geom.geom_type == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [ring_to_lonlat(geom.exterior.coords)]
            + [ring_to_lonlat(interior.coords) for interior in geom.interiors],
        }
    if geom.geom_type == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [ring_to_lonlat(part.exterior.coords)] + [ring_to_lonlat(i.coords) for i in part.interiors]
                for part in geom.geoms
            ],
        }
    if geom.geom_type == "Point":
        lon, lat = inverse.transform(geom.x, geom.y)
        return {"type": "Point", "coordinates": [lon, lat]}
    if geom.geom_type in ("LineString", "MultiPoint"):
        return {"type": geom.geom_type, "coordinates": ring_to_lonlat(list(geom.coords))}
    # Any other degenerate/collection type — still returned rather than dropped.
    return {"type": geom.geom_type, "coordinates": mapping(geom).get("coordinates")}


def _point_lonlat(point, transformer: Transformer) -> list[float]:
    inverse = Transformer.from_crs(transformer.target_crs, transformer.source_crs, always_xy=True)
    lon, lat = inverse.transform(point.x, point.y)
    return [lon, lat]


# ---------------------------------------------------------------- classification

def _classify(intersection_area: float, touches: bool, intersects: bool,
              contains_a: bool, contains_b: bool, pct_of_smaller: float) -> str:
    if intersection_area <= MIN_INTERSECTION_AREA_M2:
        return "BOUNDARY_TOUCH" if (touches or intersects) else "NO_OVERLAP"
    if contains_a or contains_b or pct_of_smaller >= CONTAINMENT_PERCENT:
        return "CONTAINMENT"
    if pct_of_smaller >= HIGH_OVERLAP_PERCENT:
        return "HIGH_OVERLAP"
    return "PARTIAL_OVERLAP"


def _unverified(parcel_a_ulpin: str, parcel_b_ulpin: str, reason: str,
                 parcel_a: Optional[dict] = None, parcel_b: Optional[dict] = None) -> dict:
    return {
        "status": "UNVERIFIED",
        "verified": False,
        "reason": reason,
        "parcel_a": parcel_a or {"ulpin": parcel_a_ulpin},
        "parcel_b": parcel_b or {"ulpin": parcel_b_ulpin},
        "geometry_source": GEOMETRY_SOURCE,
        "disclaimer": DISCLAIMER,
    }


# ---------------------------------------------------------------- public entry point

def analyze_polygon_overlap_2d(ulpin_a: str, ulpin_b: str, geo_a: dict, geo_b: dict,
                                rec_a: Optional[dict] = None, rec_b: Optional[dict] = None) -> dict:
    """
    geo_a / geo_b: results from geometry.match_geometry() for each ULPIN
    (already-matched geometry only — this function never fabricates a
    footprint). rec_a / rec_b: the parcel's CSV-backed record (ULPIN,
    area, floors, elevations, etc.) — accepted for context/future vertical-
    overlap stages, but this stage only uses their footprint geometry.

    Only ever computes a real intersection when BOTH parcels report
    status == 'MATCHED'; otherwise returns UNVERIFIED with a clear reason
    and never guesses at a footprint.
    """
    parcel_a_stub = {"ulpin": ulpin_a, "osm_id": None, "area_m2": None}
    parcel_b_stub = {"ulpin": ulpin_b, "osm_id": None, "area_m2": None}

    if not geo_a or not geo_b:
        return _unverified(ulpin_a, ulpin_b, "Missing ULPIN or neighbour selection", parcel_a_stub, parcel_b_stub)

    if geo_a.get("status") != "MATCHED" or geo_b.get("status") != "MATCHED":
        return _unverified(ulpin_a, ulpin_b, "Reliable matched footprint unavailable", parcel_a_stub, parcel_b_stub)

    ring_a = (geo_a.get("candidate") or {}).get("ring")
    ring_b = (geo_b.get("candidate") or {}).get("ring")
    way_id_a = (geo_a.get("candidate") or {}).get("wayId")
    way_id_b = (geo_b.get("candidate") or {}).get("wayId")

    if not ring_a or len(ring_a) < 3 or not ring_b or len(ring_b) < 3:
        return _unverified(
            ulpin_a, ulpin_b, "Matched geometry is missing a usable polygon ring",
            {"ulpin": ulpin_a, "osm_id": way_id_a, "area_m2": None},
            {"ulpin": ulpin_b, "osm_id": way_id_b, "area_m2": None},
        )

    try:
        poly_a, poly_b, utm_crs, transformer, repaired = _build_projected_polygons(ring_a, ring_b)
    except Exception as e:  # noqa: BLE001 - CRS/transform failure must not crash the API
        return _unverified(ulpin_a, ulpin_b, f"CRS transformation failed: {e}")

    geometry_valid_a = poly_a.is_valid
    geometry_valid_b = poly_b.is_valid

    if not geometry_valid_a or poly_a.area == 0 or not geometry_valid_b or poly_b.area == 0:
        return _unverified(
            ulpin_a, ulpin_b, "One or both matched footprints are not a valid polygon, even after repair",
            {"ulpin": ulpin_a, "osm_id": way_id_a, "area_m2": None},
            {"ulpin": ulpin_b, "osm_id": way_id_b, "area_m2": None},
        )

    try:
        intersects = bool(poly_a.intersects(poly_b))
        touches = bool(poly_a.touches(poly_b))
        contains_a = bool(poly_a.contains(poly_b))  # A contains B
        contains_b = bool(poly_b.contains(poly_a))  # B contains A
        min_distance_m = float(poly_a.distance(poly_b))

        inter_geom = poly_a.intersection(poly_b) if intersects else None
        inter_area = float(inter_geom.area) if inter_geom is not None and not inter_geom.is_empty else 0.0

        union_geom = poly_a.union(poly_b)
        union_area = float(union_geom.area)
    except Exception as e:  # noqa: BLE001 - an invalid/self-intersecting geometry must not crash the API
        return _unverified(ulpin_a, ulpin_b, f"Polygon intersection failed: {e}")

    area_a = float(poly_a.area)
    area_b = float(poly_b.area)

    pct_a = round(100.0 * inter_area / area_a, 2) if area_a else 0.0
    pct_b = round(100.0 * inter_area / area_b, 2) if area_b else 0.0
    iou_percent = round(100.0 * inter_area / union_area, 2) if union_area else 0.0
    pct_of_smaller = (100.0 * inter_area / min(area_a, area_b)) if min(area_a, area_b) else 0.0

    centroid_distance_m = float(poly_a.centroid.distance(poly_b.centroid))

    status = _classify(inter_area, touches, intersects, contains_a, contains_b, pct_of_smaller)

    intersection_geojson = None
    if inter_geom is not None and not inter_geom.is_empty:
        intersection_geojson = _unproject_geometry(inter_geom, transformer)

    return {
        "status": status,
        "verified": True,
        "message": VERIFICATION_NOTE,
        "geometry_source": GEOMETRY_SOURCE,
        "disclaimer": DISCLAIMER,

        "parcel_a": {"ulpin": ulpin_a, "osm_id": way_id_a, "area_m2": round(area_a, 2)},
        "parcel_b": {"ulpin": ulpin_b, "osm_id": way_id_b, "area_m2": round(area_b, 2)},

        "intersection_area_m2": round(inter_area, 2),
        "union_area_m2": round(union_area, 2),

        "overlap_percent_a": pct_a,
        "overlap_percent_b": pct_b,
        "iou_percent": iou_percent,

        "centroid_distance_m": round(centroid_distance_m, 2),
        "minimum_distance_m": round(min_distance_m, 2),

        "intersects": intersects,
        "touches": touches,
        "contains_a": contains_a,
        "contains_b": contains_b,

        "geometry_valid_a": geometry_valid_a,
        "geometry_valid_b": geometry_valid_b,
        "repair_applied_a": repaired["a"],
        "repair_applied_b": repaired["b"],

        "centroid_a": _point_lonlat(poly_a.centroid, transformer),
        "centroid_b": _point_lonlat(poly_b.centroid, transformer),

        "projection_used": utm_crs.to_string(),
        "crs_used": utm_crs.to_string(),

        "intersection_geometry": intersection_geojson,
    }
