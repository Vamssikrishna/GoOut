# GoOut Native App

Shell app for **Android**, **iOS**, and **Windows** (React Native Windows) that loads the **full website** from the Vite dev server or your deployed web URL.

## How it works

- The UI is the same as `client/`: a full-screen **WebView** pointed at your web app URL (defaults below).
- In development, run **both** the web client and Metro, then open the native app:
  - `npm run dev` from repo root (or `cd client && npm run dev` on port **5173**).
  - `npm run mobile:start` and `npm run mobile:android` / `ios` / `windows`.

## Web app URL

Configured in [`src/config/webAppUrl.ts`](src/config/webAppUrl.ts) and optional env `GOOUT_WEB_APP_URL` (see [`.env.example`](.env.example)).

| Target | Default URL |
|--------|-------------|
| Android emulator | `http://10.0.2.2:5173` |
| iOS simulator / Windows / macOS | `http://localhost:5173` |
| Physical device | Set `GOOUT_WEB_APP_URL` to `http://<your-pc-lan-ip>:5173` (same Wi‑Fi). |

Production: set `GOOUT_WEB_APP_URL` to your hosted site (e.g. `https://app.example.com`). The site should serve the same SPA build as `client` and proxy `/api` and `/socket.io` to your API (or use same-origin API).

## Environment (optional)

Copy [`.env.example`](.env.example) to `.env` and wire variables into your build (e.g. Xcode / Gradle env, or a Babel env plugin). Plain Metro does not read `.env` unless you add tooling.

## Run

From repo root:

```bash
npm run mobile:start
npm run mobile:android
npm run mobile:ios
npm run mobile:windows
```

From `apps/mobile`:

```bash
npm run start
npm run android
npm run ios
npm run windows
```

## Release checklist

### iOS / Android / Windows

- Set `GOOUT_WEB_APP_URL` to production HTTPS.
- Ensure ATS / cleartext / network security policies allow your web origin only as needed.
- Store signing, icons, and store listings as for any native app.

## Legacy native screens

Earlier partial React Native screens (`LoginScreen`, `ExplorerScreen`, etc.) remain under `src/screens/` for reference but are **not** mounted; the WebView is the only user-facing experience.
