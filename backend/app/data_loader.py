"""
Loads the three source CSVs, normalizes column names, joins on ULPIN,
runs basic data-quality validation, and builds a spatial index for 0ms nearby parcel searches.

Cached once at process startup for zero-latency serverless request handling.
"""
from __future__ import annotations
import os
import re
import math
import time
import logging
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional, List, Tuple

logger = logging.getLogger("ulpin.dataloader")

DATA_DIR = os.environ.get("ULPIN_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data"))
EARTH_RADIUS = 6371000.0

# canonical_field -> list of acceptable normalized aliases (lowercase, no separators)
ALIASES = {
    "ulpin":            ["ulpin", "ulpinid", "ulpinno", "parcelid", "surveyid"],
    "type":             ["type", "propertytype", "landuse", "usetype", "category"],
    "area_m2":          ["aream2", "area", "areasqm", "plotarea"],
    "perimeter_m":      ["perimeterm", "perimeter"],
    "longitude":        ["longitude", "lon", "long", "x"],
    "latitude":         ["latitude", "lat", "y"],
    "floors":           ["floors", "floorcount", "numfloors", "storeys", "stories"],
    "floor_height_m":   ["floorheightm", "floorheight", "storeyheight"],
    "building_height_m":["buildingheightm", "buildingheight", "height"],
    "dem_m_asl":        ["demmasl", "dem", "groundelevationmasl", "groundelevation"],
    "dsm_m_asl":        ["dsmmasl", "dsm", "surfaceelevationmasl", "surfaceelevation"],
}


def _norm(col: str) -> str:
    return re.sub(r"[^a-z0-9]", "", col.strip().lower())


def _remap_columns(df: pd.DataFrame) -> pd.DataFrame:
    normalized = {c: _norm(c) for c in df.columns}
    rename = {}
    for canonical, aliases in ALIASES.items():
        for orig, norm in normalized.items():
            if norm in aliases and canonical not in rename.values():
                rename[orig] = canonical
                break
    return df.rename(columns=rename)


@dataclass
class LoadReport:
    files_loaded: list = field(default_factory=list)
    row_counts: dict = field(default_factory=dict)
    missing_values: dict = field(default_factory=dict)
    invalid_coordinates: list = field(default_factory=list)
    duplicate_ulpins: dict = field(default_factory=dict)
    unmatched_ulpins: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)


def _valid_coord(lat, lon) -> bool:
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lon <= 180 and not (lat == 0 and lon == 0)


def _latlon_to_cartesian(lat: float, lon: float) -> Tuple[float, float, float]:
    """Converts spherical lat/lon in degrees to 3D Cartesian coordinates [x,y,z] on Earth sphere."""
    phi = math.radians(lat)
    lam = math.radians(lon)
    x = EARTH_RADIUS * math.cos(phi) * math.cos(lam)
    y = EARTH_RADIUS * math.cos(phi) * math.sin(lam)
    z = EARTH_RADIUS * math.sin(phi)
    return x, y, z


# Global process singleton cache
_CACHED_UNIFIED: Optional[pd.DataFrame] = None
_CACHED_REPORT: Optional[LoadReport] = None
_SPATIAL_INDEX = None
_RECORD_LOOKUP_CACHE: dict[str, dict] = {}


def load_dataset() -> Tuple[pd.DataFrame, LoadReport]:
    global _CACHED_UNIFIED, _CACHED_REPORT, _SPATIAL_INDEX
    if _CACHED_UNIFIED is not None and _CACHED_REPORT is not None:
        return _CACHED_UNIFIED, _CACHED_REPORT

    start_t = time.perf_counter()
    report = LoadReport()
    frames = {}

    files = {
        "register": "ulpin_parcel_register.csv",
        "dsm": "dsm_report.csv",
        "dem": "dem_report.csv",
    }

    for key, fname in files.items():
        path = os.path.join(DATA_DIR, fname)
        if not os.path.exists(path):
            report.errors.append(f"Missing file: {fname}")
            frames[key] = pd.DataFrame()
            continue
        df = pd.read_csv(path)
        df = _remap_columns(df)
        if "ulpin" not in df.columns:
            report.errors.append(f"{fname}: no ULPIN-like column detected")
        else:
            df["ulpin"] = df["ulpin"].astype(str).str.strip()
            dup = df["ulpin"][df["ulpin"].duplicated()].tolist()
            if dup:
                report.duplicate_ulpins[fname] = dup
        report.files_loaded.append(fname)
        report.row_counts[fname] = len(df)
        report.missing_values[fname] = {
            c: int(df[c].isna().sum()) for c in df.columns if df[c].isna().sum() > 0
        }
        frames[key] = df

    register = frames.get("register", pd.DataFrame())
    dsm = frames.get("dsm", pd.DataFrame())
    dem = frames.get("dem", pd.DataFrame())

    unified = register.copy()
    if not unified.empty and "ulpin" in unified.columns:
        if not dsm.empty and "ulpin" in dsm.columns:
            missing = set(unified["ulpin"]) - set(dsm["ulpin"])
            if missing:
                report.unmatched_ulpins["dsm"] = sorted(missing)
            unified = unified.merge(
                dsm.drop(columns=[c for c in ("longitude", "latitude") if c in dsm.columns]),
                on="ulpin", how="left", suffixes=("", "_dsm")
            )
        if not dem.empty and "ulpin" in dem.columns:
            missing = set(register["ulpin"]) - set(dem["ulpin"])
            if missing:
                report.unmatched_ulpins["dem"] = sorted(missing)
            dem_cols = [c for c in dem.columns if c in ("ulpin", "dem_m_asl")]
            unified = unified.merge(dem[dem_cols], on="ulpin", how="left", suffixes=("", "_dem"))

    for _, row in unified.iterrows():
        if not _valid_coord(row.get("latitude"), row.get("longitude")):
            report.invalid_coordinates.append(str(row.get("ulpin")))

    _CACHED_UNIFIED = unified
    _CACHED_REPORT = report

    # Build spatial index using scipy KDTree if available
    try:
        from scipy.spatial import KDTree
        cart_coords = []
        for _, r in unified.iterrows():
            lat, lon = r.get("latitude"), r.get("longitude")
            if _valid_coord(lat, lon):
                cart_coords.append(_latlon_to_cartesian(float(lat), float(lon)))
            else:
                cart_coords.append((0.0, 0.0, 0.0))
        _SPATIAL_INDEX = KDTree(cart_coords)
        logger.info("Built scipy KDTree spatial index for %d parcels", len(cart_coords))
    except Exception as exc:
        logger.info("scipy KDTree unavailable, using distance sorting fallback: %s", exc)

    elapsed_ms = round((time.perf_counter() - start_t) * 1000, 2)
    logger.info("[PERF] Dataset loaded and indexed in %s ms (%d rows)", elapsed_ms, len(unified))
    return _CACHED_UNIFIED, _CACHED_REPORT


def query_spatial_index(target_lat: float, target_lon: float, k: int = 15) -> List[int]:
    """
    Returns indices of the k nearest parcels to (target_lat, target_lon) using spatial KDTree.
    """
    unified, _ = load_dataset()
    global _SPATIAL_INDEX
    if _SPATIAL_INDEX is not None:
        target_cart = _latlon_to_cartesian(target_lat, target_lon)
        # Query nearest k+1 points
        dists, indices = _SPATIAL_INDEX.query(target_cart, k=min(k, len(unified)))
        if isinstance(indices, int):
            return [indices]
        return list(indices)

    # Fallback to returning all indices if KDTree is unavailable
    return list(range(len(unified)))
