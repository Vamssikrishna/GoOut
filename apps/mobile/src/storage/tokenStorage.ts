import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'goout_token';
const USER_KEY = 'goout_user';

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function removeToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function getCachedUser() {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedUser(user: unknown) {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user ?? null));
}

export async function clearSessionStorage() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}
