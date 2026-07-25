from __future__ import annotations

from fastapi.testclient import TestClient

from phylo_lens_server.main import (
    ENV_CORS_ORIGINS,
    ROUTE_HEALTH,
    create_app,
    parse_cors_origins,
)
from phylo_lens_server.utils.versions import API_VERSION, service_version


def test_health_includes_service_and_api_versions(monkeypatch) -> None:
    monkeypatch.delenv(ENV_CORS_ORIGINS, raising=False)
    client = TestClient(create_app())

    response = client.get(ROUTE_HEALTH)

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service_version": service_version(),
        "api_version": API_VERSION,
    }


def test_default_cors_configuration_allows_no_browser_origins(monkeypatch) -> None:
    monkeypatch.delenv(ENV_CORS_ORIGINS, raising=False)
    client = TestClient(create_app())

    response = cors_preflight(client, "http://localhost:5173")

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-credentials" not in response.headers


def test_configured_single_cors_origin(monkeypatch) -> None:
    monkeypatch.setenv(ENV_CORS_ORIGINS, "http://localhost:5173")
    client = TestClient(create_app())

    response = cors_preflight(client, "http://localhost:5173")

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-credentials" not in response.headers


def test_configured_multiple_cors_origins(monkeypatch) -> None:
    monkeypatch.setenv(
        ENV_CORS_ORIGINS,
        "http://localhost:5173,https://phyloviz.example.org",
    )
    client = TestClient(create_app())

    allowed = cors_preflight(client, "https://phyloviz.example.org")
    denied = cors_preflight(client, "https://other.example.org")

    assert allowed.status_code == 200
    assert (
        allowed.headers["access-control-allow-origin"] == "https://phyloviz.example.org"
    )
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_cors_origin_parser_trims_whitespace_and_ignores_empty_items() -> None:
    assert parse_cors_origins(" http://localhost:5173, ,https://example.org,, ") == [
        "http://localhost:5173",
        "https://example.org",
    ]


def cors_preflight(client: TestClient, origin: str):
    return client.options(
        ROUTE_HEALTH,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
