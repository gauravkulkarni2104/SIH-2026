"""
Comprehensive test suite verifying CORS headers, preflight requests, and route handling.
"""
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_cors_vercel_production_origin():
    response = client.get(
        "/api/health",
        headers={"Origin": "https://sih-2026-1kjn.vercel.app"}
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://sih-2026-1kjn.vercel.app"
    assert response.headers.get("access-control-allow-credentials") == "true"
    data = response.json()
    assert data.get("status") == "ok"


def test_cors_localhost_3000_origin():
    response = client.get(
        "/api/stats",
        headers={"Origin": "http://localhost:3000"}
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_cors_localhost_5173_origin():
    response = client.get(
        "/api/ulpins",
        headers={"Origin": "http://localhost:5173"}
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_cors_vercel_preview_regex():
    response = client.get(
        "/api/health",
        headers={"Origin": "https://sih-2026-preview-abc123.vercel.app"}
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://sih-2026-preview-abc123.vercel.app"
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_cors_options_preflight_post_request():
    response = client.options(
        "/api/overlap/2d",
        headers={
            "Origin": "https://sih-2026-1kjn.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        }
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://sih-2026-1kjn.vercel.app"
    assert "POST" in response.headers.get("access-control-allow-methods", "")
    assert "content-type" in response.headers.get("access-control-allow-headers", "").lower()


def test_direct_options_handler():
    response = client.options("/api/ulpins")
    assert response.status_code == 200


def test_post_overlap_2d_with_cors():
    payload = {
        "parcel_a_ulpin": "444211110001",
        "parcel_b_ulpin": "444211110002"
    }
    response = client.post(
        "/api/overlap/2d",
        json=payload,
        headers={"Origin": "https://sih-2026-1kjn.vercel.app"}
    )
    # Check that CORS header is present even on 404 or 200
    assert response.headers.get("access-control-allow-origin") == "https://sih-2026-1kjn.vercel.app"


if __name__ == "__main__":
    test_cors_vercel_production_origin()
    test_cors_localhost_3000_origin()
    test_cors_localhost_5173_origin()
    test_cors_vercel_preview_regex()
    test_cors_options_preflight_post_request()
    test_direct_options_handler()
    test_post_overlap_2d_with_cors()
    print("ALL CORS AND ROUTE TESTS PASSED!")
