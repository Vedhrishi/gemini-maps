"""Run: AI_PROVIDER=mock pytest -q  (no API keys needed)"""
import io, os
os.environ["AI_PROVIDER"] = "mock"
from fastapi.testclient import TestClient
from PIL import Image
import app as appmod

c = TestClient(appmod.app)

def img(color=(10, 20, 30)):
    b = io.BytesIO(); Image.new("RGB", (64, 64), color).save(b, "JPEG"); return b.getvalue()

def post(lat=17.4435, lng=78.3772, data=None, ct="image/jpeg"):
    return c.post("/api/analyze", files={"file": ("x.jpg", data or img(), ct)}, data={"lat": lat, "lng": lng, "address": "HITEC City"})

def test_health():
    r = c.get("/health").json(); assert r["status"] == "ok" and r["provider"]

def test_analyze_creates_report_and_lists():
    appmod._reports_store.clear()
    r = post(); j = r.json()
    assert r.status_code == 200 and j["is_road_hazard"] and j["merged"] is False
    assert j["report"]["severity"] in ("low", "medium", "high", "critical")
    got = c.get("/api/reports").json()["reports"]
    assert len(got) == 1 and got[0]["id"] == j["report"]["id"]

def test_duplicate_merges_into_upvote():
    appmod._reports_store.clear(); appmod._hits.clear()
    a = post().json(); b = post(lat=17.44352, lng=78.37722).json()
    assert b["merged"] is True and b["report"]["id"] == a["report"]["id"] and b["report"]["upvotes"] == 1
    assert len(appmod._reports_store) == 1

def test_far_away_is_new_report():
    appmod._reports_store.clear(); appmod._hits.clear()
    post(); post(lat=17.50, lng=78.50)
    assert len(appmod._reports_store) == 2

def test_validation():
    appmod._hits.clear()
    assert post(lat=95).status_code == 422
    assert post(ct="text/plain").status_code == 415
    assert c.post("/api/analyze", files={"file": ("x.jpg", b"", "image/jpeg")}, data={"lat": 1, "lng": 1}).status_code == 422

def test_radius_filter_and_upvote():
    appmod._reports_store.clear(); appmod._hits.clear()
    rid = post().json()["report"]["id"]
    assert len(c.get("/api/reports", params={"lat": 17.44, "lng": 78.37, "radius_km": 5}).json()["reports"]) == 1
    assert len(c.get("/api/reports", params={"lat": 28.6, "lng": 77.2, "radius_km": 5}).json()["reports"]) == 0
    assert c.post(f"/api/reports/{rid}/upvote").json()["upvotes"] == 1

def test_rate_limit():
    appmod._hits.clear()
    codes = [post(lat=10 + i * 0.01).status_code for i in range(12)]
    assert codes.count(429) == 2

def test_transcribe_and_ws():
    appmod._hits.clear()
    assert c.post("/api/transcribe", files={"file": ("v.webm", b"abc", "audio/webm")}).json()["text"]
    with c.websocket_connect("/ws") as ws:
        ws.send_text("ping"); assert ws.receive_text() == "pong"
        appmod._reports_store.clear(); appmod._hits.clear()
        post(lat=1.0, lng=1.0)
        assert '"new_hazard"' in ws.receive_text()


def test_seed_on_empty_start():
    appmod._reports_store.clear()
    appmod._seed_reports()
    got = c.get("/api/reports").json()["reports"]
    assert len(got) == 16 and all(r["id"].startswith("seed-") for r in got)
    assert all(-90 <= r["lat"] <= 90 for r in got)
    appmod._reports_store.clear()


def test_places_index():
    from places import gazetteer, Gazetteer
    g = Gazetteer(); g.load()
    assert g.ready and g.count > 500000
    r = g.search("tirupati")
    assert r and r[0]["name"] == "Tirupati" and 13 < r[0]["lat"] < 14
    assert any("Andhra" in p["sub"] for p in r)
    r = g.search("hyderabad station")
    assert r and 17 < r[0]["lat"] < 18
    assert g.search("a") == []
    # tiny villages exist too
    assert len(g.search("kondapur", near=(17.4, 78.4))) >= 1


def test_detail_and_user_places(tmp_path):
    from places import Detail
    d = Detail(); d.load(); d.user_path = str(tmp_path / "u.json")
    assert len(d.rows) > 100000
    r = d.search("paradise", near=(17.43, 78.45))
    assert r and any("aradise" in p["name"] for p in r)
    d.add_user("Basavakalyan Empire", 17.4350, 78.3860)
    r = d.search("basavakalyan empire")
    assert r[0]["name"] == "Basavakalyan Empire" and abs(r[0]["lat"] - 17.435) < 1e-3


def test_traffic_flow_parse_and_no_key(monkeypatch):
    from app import parse_flow
    assert parse_flow({"flowSegmentData": {"currentSpeed": 20, "freeFlowSpeed": 40}}) == 0.5
    assert parse_flow({"flowSegmentData": {"currentSpeed": 55, "freeFlowSpeed": 40}}) == 1.0
    assert parse_flow({"flowSegmentData": {"roadClosure": True, "freeFlowSpeed": 40}}) == 0.05
    assert parse_flow({}) is None
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    from fastapi.testclient import TestClient
    import app as appmod
    with TestClient(appmod.app) as c:
        r = c.get("/api/traffic/flow", params={"points": "17.4,78.4|17.5,78.5"})
        assert r.status_code == 200 and r.json() == {"live": False, "samples": []}
