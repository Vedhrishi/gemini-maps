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
    assert parse_flow({"flowSegmentData": {"roadClosure": True, "currentSpeed": 0, "freeFlowSpeed": 40}}) is None
    assert parse_flow({"flowSegmentData": {"currentSpeed": 2, "freeFlowSpeed": 40}}) == 0.25
    assert parse_flow({"flowSegmentData": {"currentSpeed": 20, "freeFlowSpeed": 40, "confidence": 0.3}}) is None
    assert parse_flow({}) is None
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    from fastapi.testclient import TestClient
    import app as appmod
    with TestClient(appmod.app) as c:
        r = c.get("/api/traffic/flow", params={"points": "17.4,78.4|17.5,78.5"})
        assert r.status_code == 200 and r.json() == {"live": False, "samples": []}


def test_muse_falls_back_to_gemini(monkeypatch):
    import ai_client
    monkeypatch.setenv("AI_PROVIDER", "muse")
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.setattr(ai_client, "_MUSE_DOWN_UNTIL", 0.0)
    def boom(_): raise RuntimeError("404 model not found")
    monkeypatch.setattr(ai_client, "_muse_analyze", boom)
    monkeypatch.setattr(ai_client, "_gemini_analyze", lambda b: {"is_road_hazard": True, "hazard_type": "pothole", "severity": "high", "description": "d", "confidence": 0.9})
    out = ai_client.analyze_image_sync(b"img")
    assert out["ai_model"] == "gemini"
    st = ai_client.ai_status()
    assert st["serving"] == "gemini" and st["muse_ok"] is False
    # second call skips Muse entirely while it is marked down
    monkeypatch.setattr(ai_client, "_muse_analyze", lambda b: (_ for _ in ()).throw(AssertionError("should not call")))
    assert ai_client.analyze_image_sync(b"img")["ai_model"] == "gemini"


def test_muse_success_labels_model(monkeypatch):
    import ai_client
    monkeypatch.setenv("AI_PROVIDER", "muse")
    monkeypatch.setattr(ai_client, "_MUSE_DOWN_UNTIL", 0.0)
    monkeypatch.setattr(ai_client, "_muse_analyze", lambda b: {"is_road_hazard": False, "confidence": 0.1})
    out = ai_client.analyze_image_sync(b"img")
    assert out["ai_model"] == "muse-spark" and ai_client.ai_status()["serving"] == "muse"


def test_parse_sam_boxes():
    import ai_client
    t = ('<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561;c=0.62|><|mask;x=0;y=0;data=46,101,!abc|>,'
         '1<|box;x1=260;y1=382;x2=340;y2=427;w=537;h=561;c=0.91|><|mask;x=0;y=0;data=46,81,!def|>')
    b = ai_client.parse_sam_boxes(t)
    assert len(b) == 2 and b[0]["c"] == 0.91
    assert abs(b[0]["x1"] - 260 / 537) < 1e-3 and 0 < b[1]["y2"] <= 1
    assert ai_client.parse_sam_boxes("no boxes here") == []
    assert ai_client.parse_sam_boxes("<|box;x1=5;y1=5;x2=1;y2=9;w=10;h=10|>") == []  # degenerate


def test_report_carries_sam_boxes(monkeypatch):
    import app as appmod
    monkeypatch.setattr(appmod, "segment_hazard_sync", lambda b, t: [{"x1": .1, "y1": .2, "x2": .5, "y2": .6, "c": .9}])
    from PIL import Image
    import io as _io
    buf = _io.BytesIO(); Image.new("RGB", (50, 50), (90, 90, 90)).save(buf, format="JPEG")
    r = c.post("/api/analyze", files={"file": ("p.jpg", buf.getvalue(), "image/jpeg")}, data={"lat": "12.9716", "lng": "77.5946"})
    j = r.json()
    assert r.status_code == 200 and j["is_road_hazard"]
    assert j["report"]["segments"][0]["c"] == .9 and j["report"]["ai_model"] == "mock"


def test_probe_marks_muse_down_when_key_has_no_models(monkeypatch):
    import ai_client, httpx
    monkeypatch.setenv("AI_PROVIDER", "muse"); monkeypatch.setenv("MUSE_API_KEY", "k"); monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setattr(ai_client, "_MUSE_DOWN_UNTIL", 0.0)
    class R:  # what Meta returned for this account
        status_code = 200
        def json(self): return {"object": "list", "data": []}
    monkeypatch.setattr(httpx, "get", lambda *a, **k: R())
    ai_client.probe_muse()
    st = ai_client.ai_status()
    assert st["serving"] == "gemini" and st["muse_ok"] is False and "no Muse models" in st["muse_error"]
    class R2(R):
        def json(self): return {"data": [{"id": "muse-spark-1.3"}]}
    monkeypatch.setattr(httpx, "get", lambda *a, **k: R2())
    ai_client.probe_muse()
    assert ai_client.ai_status()["serving"] == "muse"


def test_parse_open_meteo_skips_past_hours():
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    ts = [(now + timedelta(hours=k)).strftime("%Y-%m-%dT%H:%M") for k in (-2, -1, 0, 1, 2)]
    j = {"hourly": {"time": ts, "precipitation_probability": [90, 80, 10, 70, None], "precipitation": [5, 4, 0, 2.5, None]}}
    out = appmod.parse_open_meteo(j)
    assert [o["p"] for o in out] == [10, 70, None] and out[1]["mm"] == 2.5


def test_weather_endpoint_handles_bad_points(monkeypatch):
    r = c.get("/api/weather", params={"points": "abc|999,999"})
    assert r.status_code == 200 and r.json() == {"points": []}


def test_parse_met_no():
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    f = lambda k: (now + timedelta(hours=k)).strftime("%Y-%m-%dT%H:%M:%SZ")
    j = {"properties": {"timeseries": [
        {"time": f(-1), "data": {"next_1_hours": {"details": {"precipitation_amount": 9}}}},
        {"time": f(0), "data": {"next_1_hours": {"details": {"precipitation_amount": 0.0}}}},
        {"time": f(1), "data": {"next_1_hours": {"details": {"precipitation_amount": 2.4}}}},
        {"time": f(7), "data": {"next_6_hours": {"details": {"precipitation_amount": 3}}}},
    ]}}
    out = appmod.parse_met_no(j)
    assert [o["mm"] for o in out] == [0.0, 2.4] and out[0]["p"] is None


def test_to_wav_handles_iphone_mp4(tmp_path):
    import subprocess, imageio_ffmpeg, ai_client
    src = tmp_path / "a.m4a"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-f", "lavfi", "-i", "sine=f=300:d=1", "-c:a", "aac", str(src)], check=True)
    wav = ai_client._to_wav(src.read_bytes(), "audio/mp4")
    assert wav[:4] == b"RIFF" and len(wav) > 20000


def test_live_rooms_two_people_see_each_other():
    appmod._rooms.clear(); appmod._hits.clear()
    a = c.post("/api/live/join", json={"name": "Asha"}).json()
    code = a["room"]
    assert len(code) == 6 and a["members"] == []
    b = c.post("/api/live/join", json={"room": code.lower(), "name": "Ravi <b>"}).json()
    assert b["room"] == code and b["me"] != a["me"] and b["color"] != a["color"]
    r = c.post(f"/api/live/{code}/ping", json={"me": a["me"], "key": a["key"], "lat": 17.44, "lng": 78.38, "speed": 42.4, "heading": 370}).json()
    assert [m["name"] for m in r["members"]] == ["Asha"] and r["members"][0]["speed"] == 42 and r["members"][0]["heading"] == 10
    r = c.post(f"/api/live/{code}/ping", json={"me": b["me"], "key": b["key"], "lat": 17.5, "lng": 78.4}).json()
    assert sorted(m["name"] for m in r["members"]) == ["Asha", "Ravi b"]
    w = c.post(f"/api/live/{code}/watch", json={"me": b["me"], "key": b["key"]}).json()
    assert len(w["members"]) == 2


def test_live_rooms_reject_bad_key_and_unknown_code():
    appmod._rooms.clear(); appmod._hits.clear()
    a = c.post("/api/live/join", json={"name": "A"}).json()
    bad = c.post(f"/api/live/{a['room']}/ping", json={"me": a["me"], "key": "nope", "lat": 1, "lng": 1})
    assert bad.status_code == 404
    assert c.post("/api/live/join", json={"room": "ZZZZZZ"}).status_code == 404
    assert c.post(f"/api/live/{a['room']}/ping", json={"me": a["me"], "key": a["key"], "lat": 99, "lng": 1}).status_code == 422


def test_live_leave_and_stale_members():
    appmod._rooms.clear(); appmod._hits.clear()
    a = c.post("/api/live/join", json={"name": "A"}).json()
    b = c.post("/api/live/join", json={"room": a["room"], "name": "B"}).json()
    for p in (a, b):
        c.post(f"/api/live/{a['room']}/ping", json={"me": p["me"], "key": p["key"], "lat": 17.4, "lng": 78.4})
    appmod._rooms[a["room"]]["members"][b["me"]]["ts"] -= 3600       # B went quiet an hour ago
    r = c.post(f"/api/live/{a['room']}/ping", json={"me": a["me"], "key": a["key"], "lat": 17.41, "lng": 78.4}).json()
    assert [m["name"] for m in r["members"]] == ["A"]
    assert c.post(f"/api/live/{a['room']}/leave", json={"me": a["me"], "key": a["key"]}).json()["ok"]


def test_traffic_tile_without_key_is_empty(monkeypatch):
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    assert c.get("/api/traffic/tile/12/2930/1830.png").status_code == 204
    monkeypatch.setenv("TOMTOM_API_KEY", "k")
    assert c.get("/api/traffic/tile/3/99/1.png").status_code == 204   # tile outside the grid
