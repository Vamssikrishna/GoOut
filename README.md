# GoOut – AI-Integrated Hyper-Local Discovery & Social Exploration Platform

A location-based web ecosystem that promotes local commerce, physical activity, and social interaction. GoOut helps users discover nearby "hidden gems," plan outings, save money vs delivery, and connect with like-minded explorers.

**All data is entered by users**—no predefined data. Users register, merchants add their businesses, and explorers create buddy groups.

## Features

### User Module (The Explorer)
- **Interactive Discovery Map** – Geospatial visualization of nearby businesses (Leaflet + OpenStreetMap)
- **Budget Planner** – Itinerary suggestions (Cafe + Park) based on user-defined budget
- **Cost-Benefit Comparator** – Real-time comparison of GoOut savings vs Online Delivery costs
- **Green Mode** – Track calories burned and CO₂ saved by walking

### Social Module (GoOut Buddies)
- **Interest-Based Matching** – Connect users via shared tags and location
- **Safety Suite** – Verified badges, real-time group chat, emergency SOS location ping

### Merchant Module (Local Business)
- **Live Offer Feed** – Flash deals pushed instantly to the map
- **Business Analytics** – Profile views, offer clicks, peak hours
- **Crowd Indicator** – Real-time busy-ness status

### AI Integration
- **City Concierge** – Natural language City Guide (Gemini API)
- **Smart Onboarding** – LLM extracts business details from a single-sentence description
- **Heuristic Recommendations** – Weighted ranking by rating, price, distance

## Tech Stack

- **Frontend:** React, Tailwind CSS, Leaflet, Socket.io-client
- **Backend:** Node.js, Express.js
- **Database:** MongoDB (2dsphere geospatial indexes)
- **Real-time:** Socket.io
- **Maps:** Leaflet.js, OpenStreetMap
- **AI:** Google Gemini API

## Setup

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment

Copy `server/.env.example` to `server/.env`:

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:
- `MONGODB_URI` – MongoDB connection string
- `JWT_SECRET` – Secret for JWT signing
- `GEMINI_API_KEY` – [Get from Google AI Studio](https://makersuite.google.com/app/apikey)

### 3. Run the app

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000

### 4. Run native apps (React Native)

```bash
npm run mobile:start
npm run mobile:android
npm run mobile:ios
npm run mobile:windows
```

Native app source lives in `apps/mobile`.
Read platform-specific setup and release notes in `apps/mobile/README.md`.

## Project Structure

```
Go/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI
│   │   ├── pages/          # Route pages
│   │   ├── context/        # Auth context
│   │   └── api/            # API client
├── apps/
│   └── mobile/             # React Native (iOS/Android/Windows)
│       ├── src/
│       ├── android/
│       ├── ios/
│       └── windows/
├── server/                 # Express backend
│   ├── models/             # Mongoose models
│   ├── routes/             # API routes
│   └── socket/             # Socket.io handlers
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Current user |
| GET | /api/businesses/nearby | Nearby businesses (geospatial) |
| GET | /api/businesses/recommend | Smart recommendations |
| GET | /api/offers/live | Live flash deals |
| GET | /api/buddies/match | Find buddy groups |
| POST | /api/buddies/groups | Create group |

## License

MIT
# GoOut
# GoOut
