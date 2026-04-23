const trimSlash = (value: string) => value.replace(/\/+$/, '');

const fromProcess = (key: string): string | undefined => {
  const raw = process.env[key];
  if (!raw || !raw.trim()) return undefined;
  return raw.trim();
};

const fallbackApi = 'http://10.0.2.2:5000';
const fallbackSocket = fallbackApi;

const apiBaseRaw = fromProcess('GOOUT_API_BASE_URL') || fallbackApi;
const socketBaseRaw = fromProcess('GOOUT_SOCKET_URL') || fallbackSocket;

export const env = {
  appEnv: fromProcess('GOOUT_APP_ENV') || 'development',
  apiBaseUrl: trimSlash(apiBaseRaw),
  socketUrl: trimSlash(socketBaseRaw),
};

export const apiUrl = `${env.apiBaseUrl}/api`;
