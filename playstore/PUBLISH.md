# Publish Gemini Maps on Google Play (one-time fee US$25)

Your app is a PWA, so the Play Store build is a Trusted Web Activity (TWA): a thin Android shell around https://vedhrishi.github.io/gemini-maps/.

## 0. Before anything: deploy the website
`cd /d R:\gemini-maps\gemini-maps\frontend` then `npm run deploy`. The Play app loads this live site, so the site must have the new manifest, icons and privacy.html.

## 1. Build the .aab (easiest: no Android Studio)
1. Open https://www.pwabuilder.com, enter `https://vedhrishi.github.io/gemini-maps/`, press Start.
2. Package for stores → Android → use the values in `twa-manifest.json` (package id `io.github.vedhrishi.geminimaps`, enable location delegation).
3. Let PWABuilder generate a signing key. Download the zip: it contains the `.aab`, `signing.keystore` and its password. **Keep the keystore + password safe forever** (losing it means you can never update the app).
   Alternative (CLI): `npm i -g @bubblewrap/cli`, `bubblewrap init --manifest=https://vedhrishi.github.io/gemini-maps/manifest.webmanifest`, `bubblewrap build`.

## 2. Play Console
1. Create a developer account at https://play.google.com/console (US$25 one-time, ID verification).
2. Create app → name, language English, App, Free.
3. Fill store listing from `store-listing.md`; upload `assets/play-store-icon-512.png`, `assets/feature-graphic-1024x500.png` and the four `screenshots/*.png` (1080×2160).
4. App content: privacy policy URL, Data safety (answers in the listing file), content rating, target audience, ads = no.
5. Production → Create release → upload the `.aab` → Play App Signing: accept.
   New personal accounts must run a **closed test with 12+ testers for 14 days** before Production is allowed — start this early.

## 3. Remove the browser address bar (Digital Asset Links)
GitHub Pages serves this app under `/gemini-maps/`, but Android verifies the domain root. Do ONE of:
- Create a repo named `vedhrishi.github.io` and publish `/.well-known/assetlinks.json` there (copy `assetlinks.template.json`, paste the SHA-256 from Play Console → Setup → App signing → "App signing key certificate").
- Or use a custom domain (e.g. gemini-maps.app) pointing at the Pages site and put `.well-known/assetlinks.json` in `frontend/public/.well-known/`.
Until verified the app still works but shows a thin URL bar (Chrome Custom Tab fallback).

## 4. Backend note
The live site runs in demo mode (simulated reports) until the FastAPI backend is deployed to Render and `VITE_API_URL` is set. Do that before public release if you want real AI reports.

## Test before publishing
Play Console → Testing → Internal testing → add your Gmail → install on any Android phone. iPhone: open the site in Safari → Share → Add to Home Screen (Apple Store needs the US$99/yr program).
