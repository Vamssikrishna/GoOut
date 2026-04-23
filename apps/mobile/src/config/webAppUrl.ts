import { Platform } from 'react-native';

function fromEnv(): string | undefined {
  const raw = process.env.GOOUT_WEB_APP_URL;
  if (!raw || !String(raw).trim()) return undefined;
  return String(raw).trim().replace(/\/+$/, '');
}

/**
 * Base URL of the Vite web app (`npm run client`). Vite proxies `/api` and `/socket.io` to the API.
 * Override with GOOUT_WEB_APP_URL for staging/production or LAN testing on a physical device.
 */
export function getWebAppUrl(): string {
  const override = fromEnv();
  if (override) return override;
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5173';
  }
  return 'http://localhost:5173';
}
