"""
Stage 6 — deterministic local test cases for the 2D polygon overlap engine.

These build synthetic square footprints directly (no network / no Overpass
call) so the classification logic can be checked in isolation. Squares are
defined in local metres and converted to lon/lat around a fixed origin in
Maharashtra using the same small-angle approximation the rest of the app
uses for local geometry — precise enough to validate topology/classification,
which is all these tests check.

Run with pytest:
    pytest backend/tests/test_polygon_overlap.py -v
or directly:
    python backend/tests/test_polygon_overlap.py
"""
import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import polygon_overlap  # noqa: E402

ORIGIN_LON = 73.85
ORIGIN_LAT = 18.52
_M_PER_DEG_LAT = 111320.0
_M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))


def _to_lonlat(x_m: float, y_m: float) -> list[float]:
    return [ORIGIN_LON + x_m / _M_PER_DEG_LON, ORIGIN_LAT + y_m / _M_PER_DEG_LAT]


def square_ring(x0: float, y0: float, size: float) -> list[list[float]]:
    """Axis-aligned square, corners in local metres (x0,y0) = bottom-left, converted to lon/lat."""
    corners_m = [(x0, y0), (x0 + size, y0), (x0 + size, y0 + size), (x0, y0 + size)]
    return [_to_lonlat(x, y) for x, y in corners_m]


def matched_geo(ring, way_id=1):
    return {"status": "MATCHED", "confidence": 0.95, "candidate": {"wayId": way_id, "ring": ring}}


def unverified_geo():
    return {"status": "UNVERIFIED", "confidence": 0.4, "candidate": None}


# ---------------------------------------------------------------- Test A: NO_OVERLAP

def test_a_no_overlap():
    geo_a = matched_geo(square_ring(0, 0, 10), way_id=101)
    geo_b = matched_geo(square_ring(100, 100, 10), way_id=102)
    result = polygon_overlap.analyze_polygon_overlap_2d("PARCEL_A", "PARCEL_B", geo_a, geo_b)
    assert result["status"] == "NO_OVERLAP", result
    assert result["verified"] is True
    assert result["intersection_area_m2"] == 0.0
    assert result["intersects"] is False


# ---------------------------------------------------------------- Test B: PARTIAL_OVERLAP

def test_b_partial_overlap():
    geo_a = matched_geo(square_ring(0, 0, 20), way_id=201)
    geo_b = matched_geo(square_ring(10, 10, 20), way_id=202)
    result = polygon_overlap.analyze_polygon_overlap_2d("PARCEL_A", "PARCEL_B", geo_a, geo_b)
    assert result["status"] == "PARTIAL_OVERLAP", result
    assert result["verified"] is True
    assert result["intersection_area_m2"] > 0
    assert result["contains_a"] is False and result["contains_b"] is False


# ---------------------------------------------------------------- Test C: CONTAINMENT

def test_c_containment():
    geo_a = matched_geo(square_ring(0, 0, 30), way_id=301)   # big outer square
    geo_b = matched_geo(square_ring(10, 10, 10), way_id=302)  # fully inside A
    result = polygon_overlap.analyze_polygon_overlap_2d("PARCEL_A", "PARCEL_B", geo_a, geo_b)
    assert result["status"] == "CONTAINMENT", result
    assert result["contains_a"] is True
    assert result["contains_b"] is False


# ---------------------------------------------------------------- Test D: BOUNDARY_TOUCH

def test_d_boundary_touch():
    geo_a = matched_geo(square_ring(0, 0, 10), way_id=401)
    geo_b = matched_geo(square_ring(10, 0, 10), way_id=402)  # shares the x=10 edge only
    result = polygon_overlap.analyze_polygon_overlap_2d("PARCEL_A", "PARCEL_B", geo_a, geo_b)
    assert result["status"] == "BOUNDARY_TOUCH", result
    assert result["touches"] is True
    assert result["intersection_area_m2"] == 0.0


# ---------------------------------------------------------------- Test E: UNVERIFIED (missing geometry)

def test_e_missing_geometry():
    geo_a = matched_geo(square_ring(0, 0, 10), way_id=501)
    geo_b = unverified_geo()  # neighbour has no reliable matched footprint
    result = polygon_overlap.analyze_polygon_overlap_2d("PARCEL_A", "PARCEL_B", geo_a, geo_b)
    assert result["status"] == "UNVERIFIED", result
    assert result["verified"] is False
    assert result["reason"]


if __name__ == "__main__":
    tests = [
        test_a_no_overlap,
        test_b_partial_overlap,
        test_c_containment,
        test_d_boundary_touch,
        test_e_missing_geometry,
    ]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"PASS: {t.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL: {t.__name__} — {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR: {t.__name__} — {e}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
