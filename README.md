# 🚧 Gemini Maps — AI Road Hazard Reporter

Real-time crowdsourced road hazard reporting powered by **Gemini Vision** (today) / **Meta Muse** (tomorrow).

**Live demo**: https://vedhrishi.github.io/gemini-maps

## 🎤 Voice-First Demo Flow

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
