import requests
from typing import Optional, Dict, Any


OPEN_METEO_URL = "https://api.open-meteo.com/v1/elevation"


def get_open_meteo_elevation(
    latitude: float,
    longitude: float
) -> Optional[float]:
    """
    Get elevation for a latitude/longitude from Open-Meteo.

    Returns:
        Elevation in meters, or None if the request fails.
    """

    try:
        response = requests.get(
            OPEN_METEO_URL,
            params={
                "latitude": latitude,
                "longitude": longitude,
            },
            timeout=10,
        )

        response.raise_for_status()

        data = response.json()

        elevations = data.get("elevation")

        if not elevations or elevations[0] is None:
            return None

        return float(elevations[0])

    except (requests.RequestException, ValueError, TypeError, KeyError):
        return None


def validate_elevation(
    local_dem: Optional[float],
    external_elevation: Optional[float],
    tolerance_m: float = 10.0,
) -> Dict[str, Any]:
    """
    Compare local DEM elevation with Open-Meteo elevation.
    """

    if local_dem is None:
        return {
            "status": "LOCAL_DEM_UNAVAILABLE",
            "difference_m": None,
        }

    if external_elevation is None:
        return {
            "status": "EXTERNAL_SOURCE_UNAVAILABLE",
            "difference_m": None,
        }

    difference = abs(float(local_dem) - float(external_elevation))

    if difference <= tolerance_m:
        status = "CONSISTENT"
    else:
        status = "DIFFERENCE_DETECTED"

    return {
        "status": status,
        "difference_m": round(difference, 2),
        "tolerance_m": tolerance_m,
    }