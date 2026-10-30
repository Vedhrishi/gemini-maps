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


def _gemini_call(parts: list, json_out: bool, prefer: list | None = None) -> str:
    """Call the Gemini REST API directly, falling back across models.

    Google retires and rate-limits model names, so a model that answers 404 / 429 / 5xx
    is skipped for 15 minutes and the next one is tried at once (no sleeping), keeping
    a report's analysis to a few seconds.
    """
    import httpx
    key = os.environ["GEMINI_API_KEY"]
    last = ""
    now = time.time()
    order = list(dict.fromkeys((prefer or []) + GEMINI_MODELS))
    models = [m for m in order if _GEMINI_SKIP_UNTIL.get(m, 0) <= now] or order
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
                parts_out = r.json()["candidates"][0]["content"]["parts"]
                return "".join(p.get("text", "") for p in parts_out if not p.get("thought"))
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


GEMINI_AUDIO = ("audio/wav", "audio/x-wav", "audio/mp3", "audio/mpeg", "audio/flac", "audio/ogg", "audio/aac")

VOICE_PROMPT = (
    "This is a short voice command spoken to a navigation app in India (English, possibly with an Indian accent "
    "and Indian place names). Commands often start with the wake phrase \"Hey Meta\" and include words like "
    "navigate to, nearest, petrol pump, reroute, traffic, report pothole, share my location. "
    "Transcribe exactly what was said. Return only the words, no quotes, no notes. "
    "If nothing intelligible was said, return an empty string."
)


def _gemini_transcribe(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """Transcribe a voice command with Gemini. Browsers record WebM (Chrome) or MP4/AAC (iPhone),
    which Gemini does not take directly, so anything else is converted to 16 kHz WAV first."""
    mt = (mime_type or "").split(";")[0].strip().lower()
    if mt not in GEMINI_AUDIO:
        audio_bytes, mt = _to_wav(audio_bytes, mt or "audio/webm"), "audio/wav"
    text = _gemini_call(
        [{"text": VOICE_PROMPT},
         {"inline_data": {"mime_type": mt, "data": base64.b64encode(audio_bytes).decode()}}],
        json_out=False,
        prefer=["gemini-3.5-flash-lite", "gemini-flash-lite-latest"],  # short phrases: the fast model is enough
    ).strip()
    return text.strip('"').strip()


# ── Meta Model API (Muse) provider ───────────────────────────────────────────
# Verified against https://dev.meta.ai/docs : OpenAI-compatible Chat Completions
# at https://api.meta.ai/v1, vision via image_url data URIs, and a separate
# /asr/transcribe route for Muse Voice Transcribe (WAV only, multipart).

MUSE_BASE = "https://api.meta.ai/v1"
MUSE_MODEL = os.getenv("MUSE_MODEL", "muse-spark-1.3")
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
    for model in dict.fromkeys([MUSE_MODEL, "muse-spark-1.2", "muse-wonder-1.0"]):
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
    out = _parse_json(m.group(0) if m else text)
    out["_muse_model"] = model
    return out


def _to_wav(audio_bytes: bytes, mime_type: str) -> bytes:
    """16 kHz mono WAV for the speech APIs. Browsers record WebM (Chrome) or MP4/AAC (iPhone).
    Files, not pipes: MP4 keeps its index at the end, so ffmpeg must be able to seek."""
    if "wav" in mime_type:
        return audio_bytes
    import subprocess, tempfile, imageio_ffmpeg
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "in"), os.path.join(d, "out.wav")
        with open(src, "wb") as f:
            f.write(audio_bytes)
        p = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-i", src, "-ac", "1", "-ar", "16000", dst],
            capture_output=True, timeout=30,
        )
        if p.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) < 1000:
            raise RuntimeError("audio conversion failed")
        with open(dst, "rb") as f:
            return f.read()


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


# ── SAM 3.1: outline the hazard in the photo ───────────────────────────────
# Response format (dev.meta.ai/docs/sam/reading-segmentation): one text line of
# records like <|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561;c=0.91|><|mask;...|>
# Box coordinates are source-image pixels; we return them normalised to 0..1.

SAM_MODEL = os.getenv("SAM_MODEL", "sam-3.1")
_SAM_DOWN_UNTIL = 0.0
SAM_NOUNS = {
    "pothole": "pothole", "road_crack": "road crack", "debris": "debris on road",
    "flood": "flood water", "waterlogging": "water puddle", "accident": "crashed vehicle",
    "broken_signal": "traffic light", "other": "road damage",
}
_BOX = re.compile(r"<\|box;([^|]*)\|>")


def parse_sam_boxes(text: str, limit: int = 6) -> list:
    out = []
    for m in _BOX.finditer(text or ""):
        kv = dict(part.split("=", 1) for part in m.group(1).split(";") if "=" in part)
        try:
            w, h = float(kv["w"]), float(kv["h"])
            x1, y1, x2, y2 = (float(kv[k]) for k in ("x1", "y1", "x2", "y2"))
        except (KeyError, ValueError):
            continue
        if w <= 0 or h <= 0 or x2 <= x1 or y2 <= y1:
            continue
        box = {"x1": round(x1 / w, 4), "y1": round(y1 / h, 4), "x2": round(x2 / w, 4), "y2": round(y2 / h, 4)}
        if "c" in kv:
            try:
                box["c"] = round(float(kv["c"]), 3)
            except ValueError:
                pass
        out.append(box)
    out.sort(key=lambda b: -b.get("c", 0))
    return out[:limit]


def segment_hazard_sync(image_bytes: bytes, hazard_type: str):
    """Ask SAM 3.1 where the hazard is. Returns normalised boxes, or None when SAM is unavailable."""
    global _SAM_DOWN_UNTIL
    if active_provider() != "muse" or not (os.getenv("MUSE_API_KEY") or os.getenv("MODEL_API_KEY")):
        return None
    if time.time() < _SAM_DOWN_UNTIL:
        return None
    import httpx
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if max(img.size) > 1280:
        r = 1280 / max(img.size)
        img = img.resize((int(img.size[0] * r), int(img.size[1] * r)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    body = {
        "model": SAM_MODEL,
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": SAM_NOUNS.get(hazard_type, "road damage")},
            {"type": "input_image", "image_url": url},
        ]}],
        "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
    }
    try:
        r = httpx.post(f"{MUSE_BASE}/responses", headers={"Authorization": f"Bearer {_muse_key()}"}, json=body, timeout=20)
    except httpx.HTTPError as e:
        print(f"[SAM] {type(e).__name__}")
        _SAM_DOWN_UNTIL = time.time() + 300
        return None
    if r.status_code != 200:
        print(f"[SAM] HTTP {r.status_code}: {r.text[:200]}")
        _SAM_DOWN_UNTIL = time.time() + (1800 if r.status_code in (401, 403, 404) else 300)
        return None
    return parse_sam_boxes(r.text)


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


def probe_muse() -> None:
    """At startup, ask Meta Model API which models this key can use, so /health is
    accurate before the first report instead of claiming Muse is serving."""
    global _MUSE_DOWN_UNTIL, _MUSE_LAST_ERROR, _MUSE_LAST_OK
    if active_provider() != "muse":
        return
    import httpx
    try:
        r = httpx.get(f"{MUSE_BASE}/models", headers={"Authorization": f"Bearer {_muse_key()}"}, timeout=15)
    except Exception as e:
        print(f"[AI] Muse probe failed: {type(e).__name__}")
        return
    if r.status_code != 200:
        _MUSE_LAST_ERROR = f"model list HTTP {r.status_code}"
        _MUSE_DOWN_UNTIL = time.time() + 600
        return
    try:
        ids = {m.get("id") for m in r.json().get("data", [])}
    except Exception:
        return
    if ids & {MUSE_MODEL, "muse-spark-1.2", "muse-wonder-1.0"}:
        _MUSE_LAST_OK = time.time()
        _MUSE_DOWN_UNTIL = 0.0
        _MUSE_LAST_ERROR = ""
    elif not ids:
        # An empty /models list does not prove chat is blocked (the dashboard can show
        # models as available while this endpoint is empty). Don't trust it: leave Muse
        # enabled and let the first real call decide; failures still fall back to Gemini.
        print("[AI] Muse probe: model list empty; trying real calls anyway")
        return
    else:
        _MUSE_LAST_ERROR = "this Meta Model API key has no Muse models enabled (model list is empty)" if not ids else \
            f"Muse models not in this key's model list ({len(ids)} other models)"
        _MUSE_DOWN_UNTIL = time.time() + 1800
    print(f"[AI] Muse probe: {len(ids)} models; muse ok={_MUSE_DOWN_UNTIL == 0.0}")


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
        used = str(out.pop("_muse_model", ""))
        if model != "gemini" and used.startswith("muse-wonder"):
            model = "muse-wonder"
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
