# 🚧 Gemini Maps — AI Road Hazard Reporter

Real-time crowdsourced road hazard reporting powered by **Gemini Vision** (today) / **Meta Muse** (tomorrow).

**Live site**: https://vedhrishi.github.io/gemini-maps

## 🎤 Voice-First Flow

1. Say **"report hazard"** → camera opens automatically
2. Camera auto-captures the road → AI analyzes the image
3. A hazard pin appears **instantly on everyone's map** via WebSocket
4. The app reads back a voice summary: *"Large pothole detected. High severity. Avoid right lane."*

## 🚀 Switching to Meta Muse (tomorrow)

1. Add your Muse API key to `backend/.env`:
   ```
   AI_PROVIDER=muse
   MUSE_API_KEY=your_key_here
   ```
2. Restart the backend. Zero other changes needed.

## 🏗 Architecture

```
Frontend (React + Leaflet) → GitHub Pages
         │                    ↕ WebSocket (real-time)
         └──────────────────► FastAPI Backend → Render.com
                                      │
                              Gemini / Muse Vision API
                                      │
                              Supabase (PostgreSQL)
```

## 🛠 Local Development

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # add your keys
uvicorn app:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Deploy
```bash
# Frontend → GitHub Pages
cd frontend && npm run deploy

# Backend → Render.com
# Connect repo to Render, set env vars in dashboard
```

## 🎯 Features

- 📸 Voice-triggered camera capture (`"report hazard"`)
- 🔊 TTS readback of hazard analysis
- 🗺️ Real-time hazard pins via WebSocket (all users see instantly)
- 👍 Upvote system to confirm hazards
- 🌍 8 hazard types: pothole, debris, flood, accident, broken signal, road crack, waterlogging, other
- ⚡ Provider-agnostic AI: Gemini today, Muse tomorrow (one env var)
- 🔄 Auto-reconnecting WebSocket with keepalive
- 🆓 Free hosting: GitHub Pages + Render.com + Supabase free tier

## 🏆 Meta Hackathon

Built for the **Meta AI Developer Hackathon**. Core Muse API integration:
- `muse-spark-1.3` — vision analysis of road hazard images
- `muse-voice-transcribe-1.0` — voice command transcription

## Backend (FastAPI) — run and deploy

**Local:** `cd backend && pip install -r requirements.txt && uvicorn app:app --reload` (reads `backend/.env`, never committed).
**Tests (no keys needed):** `AI_PROVIDER=mock pytest -q`

**What it does:** `POST /api/analyze` (photo → Gemini Vision → hazard report, merged into an upvote if the same hazard is already reported within 60 m / 24 h), `POST /api/transcribe`, `GET /api/reports` (optional `lat,lng,radius_km`), `POST /api/reports/{id}/upvote`, `WS /ws` live feed, `GET /health`. Rate-limited per IP, image/audio size and type checked, AI calls kept off the event loop, Gemini model fallback (`GEMINI_MODEL` → `gemini-flash-latest` → `gemini-2.5-flash`).

**Deploy on Render (free):**
1. Push this repo to GitHub. Render → New → Blueprint → pick the repo (uses `render.yaml`, service `gemini-maps-api`).
2. In the service's Environment tab set `GEMINI_API_KEY` (paste the key there, never in git). Optional: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (run `supabase_schema.sql` first) so reports survive restarts; without them reports live in memory and reset on redeploy.
3. Your API will be `https://gemini-maps-api.onrender.com`, which the frontend already points to. If Render gives another name, build the site with `VITE_API_URL=https://<your-url>` then `npm run deploy`.
4. Free instances sleep after ~15 min idle (first request ~50 s). Ping `/health` every 10 min with a free monitor (UptimeRobot) before the demo.
5. Meta Muse: set `AI_PROVIDER=muse` and `MUSE_API_KEY`.
