"""
AI Client — provider-agnostic wrapper.

TODAY  → provider="gemini"  uses google-generativeai
TOMORROW → provider="muse"  uses Meta Muse API (OpenAI-SDK compatible)

Swap by changing PROVIDER in .env. Zero other code changes needed.
"""

import os, io, json, re, base64, time
from enum import Enum
from PIL import Image

PROVIDER = os.getenv("AI_PROVIDER", "auto")  # "auto" | "muse" | "gemini" | "mock"


def active_provider() -> str:
    """auto = Meta Muse whenever a Meta key is configured, otherwise Gemini."""
    p = os.getenv("AI_PROVIDER", PROVIDER)
    if p == "auto":
        return "muse" if (os.getenv("MUSE_API_KEY") or os.getenv("MODEL_API_KEY")) else "gemini"
    return p


# ── Shared output schema ──────────────────────────────────────────────────────

ANALYSIS_PROMPT = """You are a road safety AI. Analyze the image for road hazards.
Respond ONLY with valid JSON (no markdown fences):
{
  "is_road_hazard": true/false,
  "hazard_type": "pothole"|"debris"|"flood"|"accident"|"broken_signal"|"road_crack"|"waterlogging"|"other",
  "severity": "low"|"medium"|"high"|"critical",
  "description": "1-2 sentence description",
  "confidence": 0.0-1.0,
  "suggested_action": "brief driver action",
  "voice_summary": "10-word spoken summary for TTS e.g. 'Large pothole detected. High severity. Avoid right lane.'"
}
Severity: low=slow down, medium=avoid if possible, high=dangerous, critical=road impassable.
If no road hazard: is_road_hazard=false, confidence<0.3."""


def _parse_json(text: str) -> dict:
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    return json.loads(text)


# ── Gemini provider ───────────────────────────────────────────────────────────

GEMINI_MODELS = list(dict.fromkeys(
    [m for m in [os.getenv("GEMINI_MODEL")] if m]
    + ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"]
))
_GEMINI_SKIP_UNTIL: dict = {}  # model -> time; models that just failed are skipped for a while


def _gemini_call(parts: list, json_out: bool) -> str:
    """Call the Gemini REST API directly, falling back across models.

    Google retires and rate-limits model names, so a model that answers 404 / 429 / 5xx
    is skipped for 15 minutes and the next one is tried at once (no sleeping), keeping
    a report's analysis to a few seconds.
    """
    import httpx
    key = os.environ["GEMINI_API_KEY"]
    last = ""
    now = time.time()
    models = [m for m in GEMINI_MODELS if _GEMINI_SKIP_UNTIL.get(m, 0) <= now] or GEMINI_MODELS
    for model in models:
        cfg: dict = {}
        if json_out:
            cfg.update({"responseMimeType": "application/json", "temperature": 0.2})
        if model.startswith("gemini-3"):
            cfg["thinkingConfig"] = {"thinkingLevel": "low"}  # classification needs little reasoning
        body = {"contents": [{"parts": parts}]}
        if cfg:
            body["generationConfig"] = cfg
        try:
            r = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": key}, json=body, timeout=25,
            )
        except httpx.HTTPError as e:
            last = f"{model}: {type(e).__name__}"
            _GEMINI_SKIP_UNTIL[model] = time.time() + 300
            continue
        if r.status_code == 200:
            try:
                return "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
            except (KeyError, IndexError):
                last = f"{model}: empty response"
                continue
        last = f"{model}: HTTP {r.status_code}"
        _GEMINI_SKIP_UNTIL[model] = time.time() + 900
    raise RuntimeError(f"Gemini unavailable ({last})")


def _gemini_analyze(image_bytes: bytes) -> dict:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if max(img.size) > 1024:
        r = 1024 / max(img.size)
        img = img.resize((int(img.size[0] * r), int(img.size[1] * r)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    text = _gemini_call(
        [{"text": ANALYSIS_PROMPT}, {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}],
        json_out=True,
    )
    return _parse_json(text)


def _gemini_transcribe(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """Transcribe audio using Gemini (today). Swap to Muse Voice tomorrow."""
    return _gemini_call(
        [{"text": "Transcribe this audio exactly. Return only the transcribed text, nothing else."},
         {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(audio_bytes).decode()}}],
        json_out=False,
    ).strip()


# ── Meta Model API (Muse) provider ───────────────────────────────────────────
# Verified against https://dev.meta.ai/docs : OpenAI-compatible Chat Completions
# at https://api.meta.ai/v1, vision via image_url data URIs, and a separate
# /asr/transcribe route for Muse Voice Transcribe (WAV only, multipart).

MUSE_BASE = "https://api.meta.ai/v1"
MUSE_MODEL = os.getenv("MUSE_MODEL", "muse-wonder-1.0")
MUSE_ASR_MODEL = os.getenv("MUSE_ASR_MODEL", "muse-voice-transcribe-1.0")


def _muse_key() -> str:
    return os.environ.get("MUSE_API_KEY") or os.environ["MODEL_API_KEY"]


def _muse_analyze(image_bytes: bytes) -> dict:
    """Muse Spark vision: classify a road photo into the hazard schema."""
    from openai import OpenAI
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if max(img.size) > 1280:
        r = 1280 / max(img.size)
        img = img.resize((int(img.size[0] * r), int(img.size[1] * r)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode()
    client = OpenAI(api_key=_muse_key(), base_url=MUSE_BASE, timeout=30, max_retries=0)
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": ANALYSIS_PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ],
    }]
    last = None
    response = None
    for model in dict.fromkeys([MUSE_MODEL, "muse-wonder-1.0", "muse-spark-1.3", "muse-spark-1.2"]):
        try:
            response = client.chat.completions.create(
                model=model, messages=messages,
                max_completion_tokens=2048,  # Muse Spark always reasons; leave room for the answer
            )
            break
        except Exception as e:  # model not enabled for this key: try the next version
            last = ((last + " | ") if last else "") + f"{model}: {type(e).__name__}: {str(e)[:160]}"
    if response is None:
        raise RuntimeError(last)
    text = response.choices[0].message.content or ""
    m = re.search(r"\{.*\}", text, re.S)
    return _parse_json(m.group(0) if m else text)


def _to_wav(audio_bytes: bytes, mime_type: str) -> bytes:
    """Muse Voice Transcribe accepts WAV only; browsers record WebM/MP4."""
    if "wav" in mime_type:
        return audio_bytes
    import subprocess, imageio_ffmpeg
    p = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", "pipe:0",
         "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
        input=audio_bytes, capture_output=True, timeout=30,
    )
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError("audio conversion failed")
    return p.stdout


def _muse_transcribe(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """Muse Voice Transcribe 1.0 via POST /v1/asr/transcribe."""
    import httpx
    wav = _to_wav(audio_bytes, mime_type)
    req = json.dumps({"model": MUSE_ASR_MODEL, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"})
    r = httpx.post(
        f"{MUSE_BASE}/asr/transcribe",
        headers={"Authorization": f"Bearer {_muse_key()}", "Accept": "application/json"},
        files={"request": (None, req, "application/json"), "audio": ("audio.wav", wav, "audio/wav")},
        timeout=40,
    )
    r.raise_for_status()
    return (r.json().get("transcript") or "").strip()


# ── Public API ────────────────────────────────────────────────────────────────

def _mock_analyze(image_bytes: bytes) -> dict:
    """Deterministic stand-in so the whole stack can be tested without an API key."""
    k = sum(image_bytes[:64]) % 3
    kind = ["pothole", "waterlogging", "debris"][k]
    return {
        "is_road_hazard": True, "hazard_type": kind,
        "severity": ["medium", "high", "low"][k],
        "description": f"Mock analysis: {kind} detected on the road.",
        "confidence": 0.9, "suggested_action": "Slow down and keep left",
        "voice_summary": f"{kind.title()} detected. Slow down.",
    }


# Muse health: after a Muse failure, serve from Gemini for a while instead of
# paying the failed-call latency on every request. Re-tried automatically.
_MUSE_DOWN_UNTIL = 0.0
_MUSE_LAST_ERROR = ""
_MUSE_LAST_OK = 0.0
_LAST_MODEL = ""


def _gemini_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def ai_status() -> dict:
    """What /health reports: configured provider, what is actually serving, and Muse state."""
    p = active_provider()
    serving = p
    if p == "muse" and time.time() < _MUSE_DOWN_UNTIL and _gemini_available():
        serving = "gemini"
    return {
        "provider": p,
        "serving": serving,
        "muse_ok": (None if not _MUSE_LAST_OK and not _MUSE_LAST_ERROR else time.time() >= _MUSE_DOWN_UNTIL),
        "muse_error": _MUSE_LAST_ERROR[:160] if time.time() < _MUSE_DOWN_UNTIL else "",
        "last_model": _LAST_MODEL,
    }


def _with_fallback(muse_fn, gemini_fn, label: str):
    global _MUSE_DOWN_UNTIL, _MUSE_LAST_ERROR, _MUSE_LAST_OK, _LAST_MODEL
    if time.time() >= _MUSE_DOWN_UNTIL or not _gemini_available():
        try:
            out = muse_fn()
            _MUSE_LAST_OK = time.time()
            _MUSE_LAST_ERROR = ""
            _LAST_MODEL = label
            return out, label
        except Exception as e:
            _MUSE_LAST_ERROR = f"{type(e).__name__}: {e}"
            _MUSE_DOWN_UNTIL = time.time() + (1800 if "not found" in str(e).lower() else 300)
            print(f"[AI] Muse failed, falling back to Gemini for 10 min: {_MUSE_LAST_ERROR[:300]}")
            if not _gemini_available():
                raise
    out = gemini_fn()
    _LAST_MODEL = "gemini"
    return out, "gemini"


def analyze_image_sync(image_bytes: bytes) -> dict:
    p = active_provider()
    if p == "mock":
        out, model = _mock_analyze(image_bytes), "mock"
    elif p == "muse":
        out, model = _with_fallback(lambda: _muse_analyze(image_bytes), lambda: _gemini_analyze(image_bytes), "muse-spark")
    else:
        out, model = _gemini_analyze(image_bytes), "gemini"
    out["ai_model"] = model
    return out


def transcribe_audio_sync(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    p = active_provider()
    if p == "mock":
        return "navigate to Charminar"
    if p == "muse":
        out, _ = _with_fallback(lambda: _muse_transcribe(audio_bytes, mime_type), lambda: _gemini_transcribe(audio_bytes, mime_type), "muse-voice")
        return out
    return _gemini_transcribe(audio_bytes, mime_type)
