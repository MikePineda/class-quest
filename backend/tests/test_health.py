def test_health_reports_fixture_mode_without_key(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert body["llm"] == "fixtures"
    assert body["version"]


def test_openapi_is_served(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert "/health" in r.json()["paths"]
