// Where the session token lives.
//
// Two different mechanisms on purpose:
//
//   web    → nothing. The browser holds an HttpOnly `sh_session` cookie that
//            JavaScript deliberately cannot read, which is the point: a token
//            in localStorage is readable by any XSS on the page.
//   native → expo-secure-store (Keychain). There is no cookie jar in a React
//            Native fetch, so the app holds a bearer token itself, and the
//            Keychain is the only appropriate place for it.
//
// Everything else (cached rosters, the last house you opened) goes in
// AsyncStorage, which is not secure and must never hold a credential.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const TOKEN_KEY = "skihaus_session_v1";
const LAST_HOUSE_KEY = "skihaus_last_house_v1";

export const isWeb = Platform.OS === "web";

/**
 * Native modules can be missing from an installed build even when the JS
 * package is present — the classic "it works in Expo Go, crashes in TestFlight"
 * failure. Every call is wrapped so a missing module degrades to "not signed
 * in" rather than a white screen.
 */
async function secureStore() {
  if (isWeb) return null;
  try {
    return await import("expo-secure-store");
  } catch {
    console.warn("[storage] expo-secure-store unavailable — rebuild the app");
    return null;
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (isWeb) return null; // the cookie does this job
  const mod = await secureStore();
  if (!mod) return null;
  try {
    return await mod.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setSessionToken(token: string | null): Promise<void> {
  if (isWeb) return;
  const mod = await secureStore();
  if (!mod) return;
  try {
    if (token) await mod.setItemAsync(TOKEN_KEY, token);
    else await mod.deleteItemAsync(TOKEN_KEY);
  } catch (e) {
    console.warn("[storage] could not persist session", e);
  }
}

/** Which house to reopen on launch. A convenience, never a permission. */
export async function getLastHouseId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_HOUSE_KEY);
  } catch {
    return null;
  }
}

export async function setLastHouseId(houseId: string | null): Promise<void> {
  try {
    if (houseId) await AsyncStorage.setItem(LAST_HOUSE_KEY, houseId);
    else await AsyncStorage.removeItem(LAST_HOUSE_KEY);
  } catch {
    // Losing this just means the house picker opens instead. Not worth a throw.
  }
}
