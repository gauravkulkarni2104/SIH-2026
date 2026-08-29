"""
Loads the three source CSVs, normalizes column names, joins on ULPIN,
and runs basic data-quality validation. No column names are hard-coded
as exact matches — we match by normalized aliasing so the loader tolerates
reasonable naming variation across CSV exports.
"""
from __future__ import annotations
import os
import re
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional

DATA_DIR = os.environ.get("ULPIN_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data"))

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


def load_dataset():
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

    return unified, report
