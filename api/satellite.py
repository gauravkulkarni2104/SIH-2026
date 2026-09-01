import os
import httpx
from dotenv import load_dotenv

load_dotenv()

COPERNICUS_CLIENT_ID = os.getenv("COPERNICUS_CLIENT_ID", "")
COPERNICUS_CLIENT_SECRET = os.getenv("COPERNICUS_CLIENT_SECRET", "")

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"


async def get_access_token():
    if not COPERNICUS_CLIENT_ID or not COPERNICUS_CLIENT_SECRET:
        return None

    data = {
        "grant_type": "client_credentials",
        "client_id": COPERNICUS_CLIENT_ID,
        "client_secret": COPERNICUS_CLIENT_SECRET,
    }

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(TOKEN_URL, data=data)
        response.raise_for_status()

        return response.json()["access_token"]


async def check_satellite_service(latitude: float, longitude: float):
    """
    Basic Copernicus/Sentinel service check.

    This does not claim that satellite imagery proves
    an exact cadastral/building boundary.
    """

    token = await get_access_token()

    if not token:
        return {
            "status": "UNAVAILABLE",
            "source": "Copernicus Data Space",
            "reason": "Copernicus OAuth credentials are not configured",
            "latitude": latitude,
            "longitude": longitude,
        }

    return {
        "status": "CONNECTED",
        "source": "Copernicus Data Space / Sentinel-2",
        "latitude": latitude,
        "longitude": longitude,
        "message": "Satellite service authentication successful",
    }
from datetime import datetime, timedelta

CATALOGUE_URL = (
    "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
)


async def search_sentinel2(
    latitude: float,
    longitude: float,
    days_back: int = 90,
    max_cloud_cover: float = 80.0,
):
    """
    Search recent Sentinel-2 Level-2A imagery around the ULPIN.
    """

    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days_back)

    delta = 0.05

    west = longitude - delta
    east = longitude + delta
    south = latitude - delta
    north = latitude + delta

    aoi = (
        f"POLYGON(({west} {south},"
        f"{east} {south},"
        f"{east} {north},"
        f"{west} {north},"
        f"{west} {south}))"
    )

    start_iso = start_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_iso = end_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    filter_query = (
        "Collection/Name eq 'SENTINEL-2' "
        "and Attributes/OData.CSC.StringAttribute/"
        "any(att:att/Name eq 'productType' "
        "and att/OData.CSC.StringAttribute/Value eq 'S2MSI2A') "
        "and Attributes/OData.CSC.DoubleAttribute/"
        "any(att:att/Name eq 'cloudCover' "
        "and att/OData.CSC.DoubleAttribute/Value le "
        f"{max_cloud_cover}) "
        "and OData.CSC.Intersects("
        f"area=geography'SRID=4326;{aoi}') "
        f"and ContentDate/Start gt {start_iso} "
        f"and ContentDate/Start lt {end_iso}"
    )

    params = {
        "$filter": filter_query,
        "$orderby": "ContentDate/Start desc",
        "$top": "5",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(
            CATALOGUE_URL,
            params=params,
        )

        response.raise_for_status()
        data = response.json()

    products = []

    for item in data.get("value", []):
        products.append({
            "id": item.get("Id"),
            "name": item.get("Name"),
            "content_date": item.get("ContentDate"),
            "online": item.get("Online"),
            "s3_path": item.get("S3Path"),
            "footprint": item.get("GeoFootprint"),
        })

    return {
        "status": "AVAILABLE" if products else "NO_IMAGERY_FOUND",
        "source": "Copernicus Data Space / Sentinel-2 L2A",
        "latitude": latitude,
        "longitude": longitude,
        "days_back": days_back,
        "max_cloud_cover": max_cloud_cover,
        "results": products,
    }
async def get_sentinel2_image(
    latitude: float,
    longitude: float,
    size: int = 1024,
):
    """
    Request a small Sentinel-2 RGB image around the ULPIN.
    """

    token = await get_access_token()

    if not token:
        return {
            "status": "UNAVAILABLE",
            "reason": "Copernicus credentials are not configured",
        }

    delta = 0.005

    bbox = [
        longitude - delta,
        latitude - delta,
        longitude + delta,
        latitude + delta,
    ]

    url = "https://sh.dataspace.copernicus.eu/api/v1/process"

    payload = {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/4326"
                },
            },
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
        "from": (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "to": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    },
                       "maxCloudCoverage": 30,
                    "mosaickingOrder": "leastCC"
                 },
                }
            ],
        },
        "output": {
            "width": size,
            "height": size,
            "responses": [
                {
                    "identifier": "default",
                    "format": {
                        "type": "image/png"
                    },
                }
            ],
        },
        "evalscript": """
//VERSION=3

function setup() {
    return {
        input: [
            "B02",
            "B03",
            "B04",
            "dataMask"
        ],
        output: {
            bands: 3,
            sampleType: "AUTO"
        }
    };
}

function evaluatePixel(sample) {

    if (sample.dataMask === 0) {
        return [0, 0, 0];
    }

    // True colour
    let r = sample.B04;
    let g = sample.B03;
    let b = sample.B02;

    // Contrast enhancement
    r = (r - 0.02) / 0.20;
    g = (g - 0.02) / 0.20;
    b = (b - 0.02) / 0.20;

    // Gamma correction
    r = Math.pow(Math.max(0, Math.min(1, r)), 0.85);
    g = Math.pow(Math.max(0, Math.min(1, g)), 0.85);
    b = Math.pow(Math.max(0, Math.min(1, b)), 0.85);

    return [
        r,
        g,
        b
    ];
}
""",
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "image/png",
    }

    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            url,
            headers=headers,
            json=payload,
        )

        response.raise_for_status()

    return {
        "status": "AVAILABLE",
        "content_type": "image/png",
        "latitude": latitude,
        "longitude": longitude,
        "image_bytes": response.content,
    }