"""
AI Client — provider-agnostic wrapper.

TODAY  → provider="gemini"  uses google-generativeai
TOMORROW → provider="muse"  uses Meta Muse API (OpenAI-SDK compatible)

Swap by changing PROVIDER in .env. Zero other code changes needed.
"""

import os, io, json, re, base64
from enum import Enum
from PIL import Image

PROVIDER = os.getenv("AI_PROVIDER", "gemini")  # "gemini" | "muse"


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

def _gemini_analyze(image_bytes: bytes) -> dict:
    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.0-flash")

    img = Image.open(io.BytesIO(image_bytes))
    if max(img.size) > 1024:
        r = 1024 / max(img.size)
        img = img.resize((int(img.size[0]*r), int(img.size[1]*r)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    response = model.generate_content([
        ANALYSIS_PROMPT,
        {"mime_type": "image/jpeg", "data": buf.read()}
    ])
    return _parse_json(response.text)


def _gemini_transcribe(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """Transcribe audio using Gemini (today). Swap to Muse Voice tomorrow."""
    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.0-flash")
    response = model.generate_content([
        "Transcribe this audio exactly. Return only the transcribed text, nothing else.",
        {"mime_type": mime_type, "data": audio_bytes}
    ])
    return response.text.strip()


# ── Muse provider (ready for tomorrow) ───────────────────────────────────────

def _muse_analyze(image_bytes: bytes) -> dict:
    """
    Meta Muse Spark 1.3 — vision analysis.
    Activated when AI_PROVIDER=muse and MUSE_API_KEY is set.
    """
    from openai import OpenAI
    client = OpenAI(
        api_key=os.environ["MUSE_API_KEY"],
        base_url="https://api.meta.ai/v1"
    )
    b64 = base64.b64encode(image_bytes).decode()
    response = client.chat.completions.create(
        model="muse-spark-1.3",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": ANALYSIS_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
            ]
        }],
        max_tokens=512,
    )
    return _parse_json(response.choices[0].message.content)


def _muse_transcribe(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """
    Meta Muse Voice Transcribe 1.0
    Activated when AI_PROVIDER=muse.
    """
    from openai import OpenAI
    client = OpenAI(
        api_key=os.environ["MUSE_API_KEY"],
        base_url="https://api.meta.ai/v1"
    )
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = "audio.webm"
    response = client.audio.transcriptions.create(
        model="muse-voice-transcribe-1.0",
        file=audio_file,
    )
    return response.text.strip()


# ── Public API ────────────────────────────────────────────────────────────────

async def analyze_image(image_bytes: bytes) -> dict:
    if PROVIDER == "muse":
        return _muse_analyze(image_bytes)
    return _gemini_analyze(image_bytes)


async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    if PROVIDER == "muse":
        return _muse_transcribe(audio_bytes, mime_type)
    return _gemini_transcribe(audio_bytes, mime_type)
