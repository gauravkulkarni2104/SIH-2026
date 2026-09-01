"""
Deterministic geometric overlap engine. Uses Shapely for polygon intersection
and plain arithmetic for vertical (elevation) intervals. No model inference
is involved in computing any overlap result.

No-false-positive rule (enforced by construction, not by a special case):
horizontal polygons that don't intersect can never produce a 3D overlap,
regardless of how their vertical ranges compare — see full_overlap_report.
"""
from __future__ import annotations
import math
from shapely.geometry import Polygon


def _local_ring(ring_lonlat, origin_lat, origin_lon):
    R = 6371000
    pts = []
    for lon, lat in ring_lonlat:
        x = math.radians(lon - origin_lon) * R * math.cos(math.radians(origin_lat))
        y = math.radians(lat - origin_lat) * R
        pts.append((x, y))
    return pts


def horizontal_overlap(geomA: dict, geomB: dict, origin_lat: float, origin_lon: float) -> dict:
    """
    geomA / geomB: geometry match results from geometry.match_geometry().
    Only ever computes a real intersection when BOTH parcels have a MATCHED
    footprint — otherwise it says so explicitly rather than guessing.
    """
    verified = geomA.get("status") == "MATCHED" and geomB.get("status") == "MATCHED"
    if not verified:
        return {
            "verified": False,
            "intersects": None,
            "intersectionAreaM2": None,
            "pctOfA": None,
            "pctOfB": None,
            "intersectionRingLocalXY": None,
            "label": "2D OVERLAP: UNVERIFIED",
        }

    ringA = geomA["candidate"]["ring"]
    ringB = geomB["candidate"]["ring"]
    polyA = Polygon(_local_ring(ringA, origin_lat, origin_lon))
    polyB = Polygon(_local_ring(ringB, origin_lat, origin_lon))
    if not polyA.is_valid:
        polyA = polyA.buffer(0)
    if not polyB.is_valid:
        polyB = polyB.buffer(0)

    intersects = polyA.intersects(polyB)
    inter_geom = polyA.intersection(polyB) if intersects else None
    inter_area = inter_geom.area if inter_geom is not None else 0.0

    ring_xy = None
    if inter_geom is not None and not inter_geom.is_empty and inter_geom.geom_type == "Polygon":
        ring_xy = [[round(x, 3), round(y, 3)] for x, y in inter_geom.exterior.coords]

    return {
        "verified": True,
        "intersects": bool(intersects) and inter_area > 0,
        "intersectionAreaM2": round(inter_area, 2),
        "pctOfA": round(100 * inter_area / polyA.area, 1) if polyA.area else 0.0,
        "pctOfB": round(100 * inter_area / polyB.area, 1) if polyB.area else 0.0,
        "intersectionRingLocalXY": ring_xy,  # local meters, origin = ULPIN A's coordinate — for 3D visualization
        "label": ("2D OVERLAP: YES" if intersects and inter_area > 0 else "2D OVERLAP: NO"),
    }


def floor_intervals(dem_m: float, floors: int, floor_height_m: float) -> list:
    intervals = []
    for i in range(int(floors)):
        bottom = dem_m + i * floor_height_m
        top = bottom + floor_height_m
        label = "GROUND" if i == 0 else f"FLOOR {i}"
        intervals.append({"index": i, "label": label, "bottomM": round(bottom, 2), "topM": round(top, 2)})
    return intervals


def vertical_overlap(recordA: dict, recordB: dict) -> dict:
    demA, hA = recordA["dem_m_asl"], recordA["building_height_m"]
    demB, hB = recordB["dem_m_asl"], recordB["building_height_m"]
    bottomA, topA = demA, demA + hA
    bottomB, topB = demB, demB + hB

    overlap_bottom = max(bottomA, bottomB)
    overlap_top = min(topA, topB)
    overlap = max(0.0, overlap_top - overlap_bottom)
    intersects = overlap > 0

    floorsA = floor_intervals(demA, recordA["floors"], recordA["floor_height_m"])
    floorsB = floor_intervals(demB, recordB["floors"], recordB["floor_height_m"])

    # Floor-level overlap is checked against the ACTUAL computed overlap interval
    # (not the other building's full range) — a floor only counts as affected if
    # it intersects the specific band the two buildings share.
    if intersects:
        affectedA = [f["label"] for f in floorsA if min(f["topM"], overlap_top) - max(f["bottomM"], overlap_bottom) > 0]
        affectedB = [f["label"] for f in floorsB if min(f["topM"], overlap_top) - max(f["bottomM"], overlap_bottom) > 0]
    else:
        affectedA, affectedB = [], []

    return {
        "intersects": bool(intersects),
        "overlapM": round(overlap, 2) if intersects else 0.0,
        "overlapRangeM": [round(overlap_bottom, 2), round(overlap_top, 2)] if intersects else None,
        "buildingARange": [round(bottomA, 2), round(topA, 2)],
        "buildingBRange": [round(bottomB, 2), round(topB, 2)],
        "floorsA": floorsA,
        "floorsB": floorsB,
        "affectedFloorsA": affectedA,
        "affectedFloorsB": affectedB,
    }


def full_overlap_report(geomA, geomB, recordA, recordB, origin_lat, origin_lon) -> dict:
    h = horizontal_overlap(geomA, geomB, origin_lat, origin_lon)
    v = vertical_overlap(recordA, recordB)

    volume_m3 = None

    if not h["verified"]:
        status = "UNVERIFIED"
        headline = "⚠ 3D OVERLAP: UNVERIFIED — geometry not matched to a reliable open source for one or both parcels."
    elif not h["intersects"]:
        # No-false-positive rule: horizontal miss always wins, regardless of vertical ranges.
        status = "NONE"
        headline = "3D OVERLAP: NO"
    elif h["intersects"] and v["intersects"]:
        status = "DETECTED"
        volume_m3 = round(h["intersectionAreaM2"] * v["overlapM"], 2)
        headline = f"🔴 3D OVERLAP DETECTED — {h['intersectionAreaM2']} m² x {v['overlapM']} m = {volume_m3} m³"
    else:
        status = "HORIZONTAL_ONLY"
        headline = "⚠ 2D FOOTPRINT OVERLAP: YES · 3D VOLUME OVERLAP: NO (vertical ranges do not intersect)"

    return {
        "status": status,
        "headline": headline,
        "horizontal": h,
        "vertical": v,
        "volumeM3": volume_m3,
    }
