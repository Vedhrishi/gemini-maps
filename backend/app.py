from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os, uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from typing import List
import json

from ai_client import analyze_image, transcribe_audio

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
    yield

app = FastAPI(title="Gemini Maps API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
            supabase_client.table("hazard_reports").insert({
                k: v for k, v in report.items()
                if k not in ("voice_summary", "suggested_action")  # extra fields
            }).execute()
        except Exception as e:
            print(f"[DB] insert failed: {e}")
    _reports_store.insert(0, report)
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
    }


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    lat: float = Form(...),
    lng: float = Form(...),
    address: str = Form(default=""),
):
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 10MB)")

    try:
        result = await analyze_image(content)
    except Exception as e:
        raise HTTPException(500, f"AI analysis failed: {e}")

    if not result.get("is_road_hazard"):
        return {
            "is_road_hazard": False,
            "confidence": result.get("confidence", 0),
            "voice_summary": "No road hazard detected in this image.",
        }

    report = _make_report(result, lat, lng, address)
    _save_report(report)

    await ws_manager.broadcast({"event": "new_hazard", "report": report})

    return {"is_road_hazard": True, "report": report}


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
):
    """Transcribe voice command audio (WebM/WAV from browser)."""
    content = await file.read()
    mime = file.content_type or "audio/webm"
    try:
        text = await transcribe_audio(content, mime)
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")
    return {"text": text}


@app.get("/api/reports")
async def get_reports(limit: int = 200):
    return {"reports": _get_reports(limit)}


@app.post("/api/reports/{report_id}/upvote")
async def upvote(report_id: str):
    count = _upvote(report_id)
    await ws_manager.broadcast({"event": "upvote", "report_id": report_id, "upvotes": count})
    return {"upvotes": count}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", 8000)), reload=True)
