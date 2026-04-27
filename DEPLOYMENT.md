# GoOut Deployment

GoOut is deployed as two services:

- Vercel hosts the Vite React app from `client/`.
- Render hosts the Express and Socket.IO API from `server/`.

## Vercel

- Root Directory: `client`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

Required environment variables:

- `VITE_API_BASE_URL=https://your-render-service.onrender.com/api`
- `VITE_SOCKET_URL=https://your-render-service.onrender.com`
- `VITE_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key`

`client/vercel.json` rewrites all routes to `index.html` so React Router deep links work.

## Render

- Service type: Web Service
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

Required environment variables:

- `MONGODB_URI`
- `JWT_SECRET`
- `CLIENT_URL=https://your-vercel-site.vercel.app`
- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY` or `GEMINI_API_KEY_MERCHANT`

Optional variables are listed in `server/.env.example`.

## Uploads

The current API stores uploads on local server disk under `server/uploads/`. This is fine for demos, but Render disk is ephemeral on common plans. For long-term production use, move avatars, chat media, and merchant documents to object storage.
