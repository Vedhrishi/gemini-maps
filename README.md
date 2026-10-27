# Gemini Maps

A navigation app that warns you about the road, not just the route. Drivers report hazards (potholes, flooding, accidents, broken signals) with a photo or their voice. Everyone nearby sees the report within seconds, and a Guardian agent re-routes you if a serious hazard appears ahead on your trip.

**Live app:** https://vedhrishi.github.io/gemini-maps/
Built for the Meta Global AI Developer Hackathon, 2026.

## What it does

- **Hazard reports:** a photo is analysed by AI (Gemini Vision, or Meta Muse with one setting) and pinned on a shared 3D map. Duplicate reports within 60 m are merged into an upvote.
- **Guardian:** during a trip it watches for new critical or high-severity hazards ahead, compares the safer alternatives, and switches route only when it is clearly better. It explains every decision.
- **Navigation:** routes ranked by time, hazards and fuel cost, with turn-by-turn voice, speed limits and per-vehicle fuel estimates.
- **Traffic:** typical speeds for the hour and city, blended with live TomTom flow along your route. On finalising a trip it tells you out loud how long the drive will take and whether traffic is unusual.
- **Voice control:** say "Hey Gemini" and then things like "navigate to Charminar", "how's the traffic", "any hazards ahead", "nearest petrol pump", "fastest route", "reroute", "zoom in" or "report pothole".
- **Nearby:** one tap or one phrase finds the closest petrol pump, EV charger, restaurant, ATM, hospital, pharmacy and more, and routes to it.
- **Search:** about 4.9 million India places, shops and named buildings plus street names work from files cached on the device. The rest of the world uses live OpenStreetMap services.
- **Your location:** uses GPS, or lets you pick a location on the map when the device only knows its area roughly.

## Stack

React 18, TypeScript, Vite and MapLibre on GitHub Pages. FastAPI on Render. Optional Supabase storage. OSRM routing, OpenFreeMap tiles, TomTom traffic.

## Run it locally

```bash
cd backend && pip install -r requirements.txt && cp .env.example .env && uvicorn app:app --reload
cd frontend && npm install && npm run dev
```

Frontend deploy: `cd frontend && npm run deploy`. Tests: `cd backend && AI_PROVIDER=mock pytest -q`.

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

## Data sources and coverage

- Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap, routing by OSRM, search by Photon and Nominatim.
- Offline place layers: Overture Maps Foundation (release 2026-10-21.0, CDLA-Permissive / ODbL) for India, plus GeoNames (CC BY 4.0).
- Live traffic: TomTom Traffic Flow, sampled along the route. Without a key the app uses a typical-traffic model by city and hour.
- Hazards come only from user reports. There is no national pothole dataset, so coverage grows with reports.
- Worldwide search and routing work through the live services above. Offline street-level layers ship for India only; global offline data would be several hundred GB.
