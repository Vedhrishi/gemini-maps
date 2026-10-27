from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from fastapi.concurrency import run_in_threadpool
import os, uuid, math, time, asyncio
import httpx
from collections import defaultdict, deque
from datetime import datetime, timezone
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from typing import List
import json

from places import gazetteer, detail, load_in_background
from ai_client import analyze_image_sync, transcribe_audio_sync

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
supabase_client = None

# In-memory store fallback (when Supabase not configured)
_reports_store: list = []


# ── WebSocket manager ─────────────────────────────────────────────────────────

class WSManager:
    def __init__(self):
        self.connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        self.connections = [c for c in self.connections if c != ws]

    async def broadcast(self, data: dict):
        dead = []
        for c in self.connections:
            try:
                await c.send_text(json.dumps(data))
            except Exception:
                dead.append(c)
        for d in dead:
            self.disconnect(d)

ws_manager = WSManager()



# ── Sample reports ────────────────────────────────────────────────────────────
# Sample reports are OFF by default: the map only shows real reports. Set SEED_DEMO=1 to seed samples for local testing,
# an empty store starts with clearly-labelled sample reports across the world.
# They are in-memory only (never written to Supabase) and never expire.

_SEEDS = [
    ("pothole", "high", 17.4435, 78.3772, "HITEC City, Hyderabad"),
    ("waterlogging", "critical", 17.3616, 78.4747, "Charminar, Hyderabad"),
    ("accident", "critical", 12.9716, 77.5946, "MG Road, Bengaluru"),
    ("debris", "medium", 19.0760, 72.8777, "Bandra, Mumbai"),
    ("road_crack", "low", 28.6139, 77.2090, "Connaught Place, Delhi"),
    ("flood", "high", 13.0827, 80.2707, "Marina, Chennai"),
    ("pothole", "medium", 22.5726, 88.3639, "Park Street, Kolkata"),
    ("broken_signal", "high", 18.5204, 73.8567, "FC Road, Pune"),
    ("pothole", "high", 51.5074, -0.1278, "Westminster, London"),
    ("debris", "medium", 40.7580, -73.9855, "Times Square, New York"),
    ("waterlogging", "high", 35.6762, 139.6503, "Shibuya, Tokyo"),
    ("accident", "high", 25.2048, 55.2708, "Sheikh Zayed Rd, Dubai"),
    ("road_crack", "low", -33.8688, 151.2093, "George St, Sydney"),
    ("flood", "critical", -23.5505, -46.6333, "Av. Paulista, Sao Paulo"),
    ("pothole", "medium", 48.8566, 2.3522, "Rue de Rivoli, Paris"),
    ("debris", "low", 1.3521, 103.8198, "Orchard Rd, Singapore"),
]
_DESC = {
    "pothole": "Deep pothole across the lane.", "waterlogging": "Standing water covers the carriageway.",
    "accident": "Vehicle collision blocking part of the road.", "debris": "Debris on the road surface.",
    "road_crack": "Long crack in the road surface.", "flood": "Road flooded — depth unknown.",
    "broken_signal": "Traffic signal not working.",
}
_ACTION = {"critical": "Avoid this road if possible", "high": "Slow down and take care", "medium": "Slow down", "low": "Be aware"}


def _seed_reports():
    base = datetime.now(timezone.utc)
    for i, (t, sev, lat, lng, addr) in enumerate(_SEEDS):
        _reports_store.append({
            "id": f"seed-{i:02d}", "hazard_type": t, "severity": sev,
            "description": _DESC[t] + " (sample report)",
            "voice_summary": f"{t.replace('_', ' ').title()}. {sev.title()} severity.",
            "suggested_action": _ACTION[sev], "confidence": 0.9, "lat": lat, "lng": lng,
            "address": addr, "upvotes": (i * 7) % 23,
            "created_at": (base.replace(microsecond=0)).isoformat(),
        })


# ── App startup ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global supabase_client
    if SUPABASE_URL and SUPABASE_ANON_KEY:
        try:
            from supabase import create_client
            supabase_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
            print("[DB] Supabase connected")
        except Exception as e:
            print(f"[DB] Supabase failed: {e}")
    else:
        print("[DB] No Supabase config — using in-memory store")
    load_in_background()
    if os.getenv("SEED_DEMO", "0") == "1" and not supabase_client and not _reports_store:
        _seed_reports()
        print(f"[seed] {len(_reports_store)} sample reports")
    yield

app = FastAPI(title="Gemini Maps API", version="2.0.0", lifespan=lifespan)

_origins = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "https://vedhrishi.github.io,http://localhost:5173,http://localhost:4173,http://127.0.0.1:4173",
).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if "*" in _origins else _origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



# ── Abuse protection ──────────────────────────────────────────────────────────

_hits: dict = defaultdict(deque)


def _limit(request: Request, bucket: str, max_calls: int, per_seconds: int = 60):
    """Tiny in-memory sliding-window rate limit, per client IP and bucket."""
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?"))
    q = _hits[(ip, bucket)]
    now = time.monotonic()
    while q and now - q[0] > per_seconds:
        q.popleft()
    if len(q) >= max_calls:
        raise HTTPException(429, "Too many requests — slow down a little")
    q.append(now)
    if len(_hits) > 5000:  # keep memory bounded
        for k in [k for k, v in _hits.items() if not v][:1000]:
            _hits.pop(k, None)


def _metres(lat1, lng1, lat2, lng2) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


MAX_STORE = 2000
MERGE_RADIUS_M = 60
MERGE_WINDOW_H = 24


def _find_duplicate(hazard_type: str, lat: float, lng: float):
    """Same kind of hazard within 60 m in the last 24 h is one hazard seen twice."""
    cutoff = datetime.now(timezone.utc).timestamp() - MERGE_WINDOW_H * 3600
    for r in _reports_store:
        try:
            ts = datetime.fromisoformat(r["created_at"]).timestamp()
        except Exception:
            continue
        if ts >= cutoff and r["hazard_type"] == hazard_type and _metres(lat, lng, r["lat"], r["lng"]) <= MERGE_RADIUS_M:
            return r
    return None


# ── DB helpers ────────────────────────────────────────────────────────────────

def _make_report(analysis: dict, lat: float, lng: float, address: str = "") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "hazard_type": analysis["hazard_type"],
        "severity": analysis["severity"],
        "description": analysis["description"],
        "voice_summary": analysis.get("voice_summary", analysis["description"]),
        "suggested_action": analysis.get("suggested_action", "Exercise caution"),
        "confidence": analysis["confidence"],
        "lat": lat,
        "lng": lng,
        "address": address or None,
        "upvotes": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _save_report(report: dict) -> dict:
    if supabase_client:
        try:
            try:
                supabase_client.table("hazard_reports").insert(report).execute()
            except Exception:
                # older table without the voice_summary / suggested_action columns
                supabase_client.table("hazard_reports").insert({
                    k: v for k, v in report.items() if k not in ("voice_summary", "suggested_action")
                }).execute()
        except Exception as e:
            print(f"[DB] insert failed: {e}")
    _reports_store.insert(0, report)
    del _reports_store[MAX_STORE:]
    return report


def _get_reports(limit: int = 200) -> list:
    if supabase_client:
        try:
            res = supabase_client.table("hazard_reports").select("*").order("created_at", desc=True).limit(limit).execute()
            return res.data or []
        except Exception as e:
            print(f"[DB] fetch failed: {e}")
    return _reports_store[:limit]


def _upvote(report_id: str) -> int:
    if supabase_client:
        try:
            row = supabase_client.table("hazard_reports").select("upvotes").eq("id", report_id).single().execute()
            new_count = (row.data.get("upvotes", 0) if row.data else 0) + 1
            supabase_client.table("hazard_reports").update({"upvotes": new_count}).eq("id", report_id).execute()
            return new_count
        except Exception as e:
            print(f"[DB] upvote failed: {e}")
    for r in _reports_store:
        if r["id"] == report_id:
            r["upvotes"] += 1
            return r["upvotes"]
    return 0


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "provider": os.getenv("AI_PROVIDER", "gemini"),
        "supabase": bool(supabase_client),
        "connections": len(ws_manager.connections),
        "reports": len(_reports_store),
        "places": gazetteer.count,
    }


@app.get("/api/places")
async def places(request: Request, q: str, limit: int = 8, lat: float | None = None, lng: float | None = None):
    """Search the full India place index (every town, village, station, airport)."""
    _limit(request, "places", 120)
    near = (lat, lng) if lat is not None and lng is not None else None
    lim = max(1, min(limit, 15))
    d = await run_in_threadpool(detail.search, q[:80], near, lim)
    g = await run_in_threadpool(gazetteer.search, q[:80], near, lim)
    return {"places": (d[:4] + g)[:lim] if d else g, "ready": gazetteer.ready}


# ── Live traffic (TomTom Flow Segment Data; free tier ~2,500 requests/day) ─────
_flow_cache: dict = {}


def parse_flow(j: dict):
    """TomTom flowSegmentData -> speed ratio (current / free-flow), or None."""
    d = (j or {}).get("flowSegmentData") or {}
    cur, free = d.get("currentSpeed"), d.get("freeFlowSpeed")
    if not cur and not d.get("roadClosure"):
        return None
    if not free:
        return None
    return 0.05 if d.get("roadClosure") else max(0.05, min(1.0, cur / free))


@app.get("/api/traffic/flow")
async def traffic_flow(request: Request, points: str):
    """Measured traffic at up to 8 points ("lat,lng|lat,lng"). live=false when no key is configured."""
    _limit(request, "traffic", 60)
    key = os.getenv("TOMTOM_API_KEY", "").strip()
    if not key:
        return {"live": False, "samples": []}
    pts = []
    for p in points.split("|")[:8]:
        try:
            la, ln = (float(x) for x in p.split(","))
            if -90 <= la <= 90 and -180 <= ln <= 180:
                pts.append((round(la, 3), round(ln, 3)))
        except ValueError:
            continue
    now = time.time()

    async def one(client, la, ln):
        hit = _flow_cache.get((la, ln))
        if hit and now - hit[0] < 180:
            return hit[1]
        try:
            r = await client.get(
                "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json",
                params={"key": key, "point": f"{la},{ln}", "unit": "KMPH"},
            )
            ratio = parse_flow(r.json()) if r.status_code == 200 else None
        except Exception:
            ratio = None
        _flow_cache[(la, ln)] = (now, ratio)
        if len(_flow_cache) > 5000:
            for k in list(_flow_cache)[:1000]:
                _flow_cache.pop(k, None)
        return ratio

    async with httpx.AsyncClient(timeout=5) as client:
        ratios = await asyncio.gather(*(one(client, la, ln) for la, ln in pts))
    samples = [{"lat": la, "lng": ln, "ratio": r} for (la, ln), r in zip(pts, ratios) if r is not None]
    return {"live": bool(samples), "samples": samples}


class NewPlace(BaseModel):
    name: str
    lat: float
    lng: float
    category: str = ""


@app.post("/api/places/add")
async def add_place(request: Request, body: NewPlace):
    """Let people add a place the map is missing (saved at the position they report)."""
    _limit(request, "placeadd", 20)
    nm = body.name.strip()
    if not (2 <= len(nm) <= 80) or not (6 < body.lat < 37 and 68 < body.lng < 98):
        raise HTTPException(status_code=422, detail="Name must be 2-80 characters and the position inside India")
    return {"ok": True, "place": detail.add_user(nm, body.lat, body.lng, body.category)}


@app.post("/api/analyze")
async def analyze(
    request: Request,
    file: UploadFile = File(...),
    lat: float = Form(...),
    lng: float = Form(...),
    address: str = Form(default=""),
):
    _limit(request, "analyze", 10)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "lat/lng out of range")
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(415, "Please upload an image")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 10MB)")
    if not content:
        raise HTTPException(422, "Empty image")

    try:
        # AI SDKs are blocking: keep them off the event loop so WebSockets stay live
        result = await run_in_threadpool(analyze_image_sync, content)
    except Exception as e:
        print(f"[AI] analysis failed: {e}")
        raise HTTPException(502, "AI analysis is unavailable right now")

    if not result.get("is_road_hazard") or float(result.get("confidence", 0)) < 0.3:
        return {
            "is_road_hazard": False,
            "confidence": result.get("confidence", 0),
            "voice_summary": "No road hazard detected in this image.",
        }

    for key, allowed in (("severity", {"low", "medium", "high", "critical"}),):
        if result.get(key) not in allowed:
            result[key] = "medium"
    result.setdefault("hazard_type", "other")
    result.setdefault("description", "Road hazard reported")
    result["confidence"] = max(0.0, min(1.0, float(result.get("confidence", 0.5))))
    result["address"] = address[:200]

    dup = _find_duplicate(result["hazard_type"], lat, lng)
    if dup:
        dup["upvotes"] = _upvote(dup["id"]) or dup["upvotes"] + 1
        await ws_manager.broadcast({"event": "upvote", "report_id": dup["id"], "upvotes": dup["upvotes"]})
        return {"is_road_hazard": True, "report": dup, "merged": True}

    report = _make_report(result, lat, lng, address[:200])
    _save_report(report)
    await ws_manager.broadcast({"event": "new_hazard", "report": report})
    return {"is_road_hazard": True, "report": report, "merged": False}


@app.post("/api/transcribe")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
):
    """Transcribe voice command audio (WebM/WAV from browser)."""
    _limit(request, "transcribe", 20)
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "Audio too large (max 5MB)")
    mime = file.content_type or "audio/webm"
    try:
        text = await run_in_threadpool(transcribe_audio_sync, content, mime)
    except Exception as e:
        print(f"[AI] transcription failed: {e}")
        raise HTTPException(502, "Transcription is unavailable right now")
    return {"text": text}


@app.get("/api/reports")
async def get_reports(limit: int = 200, lat: float | None = None, lng: float | None = None, radius_km: float = 0, max_age_hours: int = 72):
    """Recent reports, newest first. Optional radius filter keeps payloads small worldwide."""
    limit = max(1, min(limit, 500))
    out = _get_reports(500)
    cutoff = datetime.now(timezone.utc).timestamp() - max_age_hours * 3600
    def fresh(r):
        if str(r.get("id", "")).startswith("seed-"):
            return True
        try:
            return datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00")).timestamp() >= cutoff
        except Exception:
            return True
    out = [r for r in out if fresh(r)]
    if lat is not None and lng is not None and radius_km > 0:
        out = [r for r in out if _metres(lat, lng, r["lat"], r["lng"]) <= radius_km * 1000]
    return {"reports": out[:limit]}


@app.post("/api/reports/{report_id}/upvote")
async def upvote(request: Request, report_id: str):
    _limit(request, "upvote", 30)
    count = _upvote(report_id)
    if count:
        await ws_manager.broadcast({"event": "upvote", "report_id": report_id, "upvotes": count})
    return {"upvotes": count}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    if len(ws_manager.connections) >= 500:
        await ws.close(code=1013)
        return
    await ws_manager.connect(ws)
    try:
        while True:
            msg = await ws.receive_text()
            if len(msg) > 64:
                continue
            if msg == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", 8000)), reload=True)
