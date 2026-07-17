import { Platform } from "react-native";
import { authClient } from "./auth-client";
import { debug } from "./debug";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://172.105.135.182:4000";

/**
 * Register for push notifications. No-op on web.
 * All wrapped in a single try/catch so any failure is graceful.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  console.log("[PushSetup] registerForPushNotifications() called");

  try {
    if (Platform.OS === "web") {
      console.log("[PushSetup] Skipping push on web");
      return null;
    }

    console.log("[PushSetup] Requesting notification permissions…");
    debug.info("Push", "Requesting notification permissions…");

    let Notifications: any;
    try {
      Notifications = require("expo-notifications");
    } catch (e: any) {
      console.log("[PushSetup] expo-notifications require FAILED: " + (e?.message ?? String(e)));
      return null;
    }

    // Verify module loaded correctly
    if (!Notifications || typeof Notifications.getPermissionsAsync !== "function") {
      console.log("[PushSetup] expo-notifications module incomplete — missing getPermissionsAsync");
      return null;
    }

    const permResult = await Notifications.getPermissionsAsync();
    let finalStatus = permResult.status;

    console.log("[PushSetup] Permission status: " + finalStatus);
    debug.info("Push", `Permission status: ${finalStatus}`);

    if (finalStatus !== "granted") {
      if (typeof Notifications.requestPermissionsAsync === "function") {
        const reqResult = await Notifications.requestPermissionsAsync();
        finalStatus = reqResult.status;
        console.log("[PushSetup] Permission requested, result: " + finalStatus);
        debug.info("Push", `Permission requested, result: ${finalStatus}`);
      }
    }

    if (finalStatus !== "granted") {
      console.log("[PushSetup] Permission not granted, aborting");
      debug.warn("Push", "Permission not granted, aborting push registration");
      return null;
    }

    console.log("[PushSetup] Getting Expo push token…");
    debug.info("Push", "Getting Expo push token…");
    const tokenResult = await Notifications.getExpoPushTokenAsync();
    const token = tokenResult.data;
    console.log("[PushSetup] Got push token: " + token);
    debug.info("Push", `Got push token: ${token}`);

    try {
      console.log("[PushSetup] Registering push token with server at " + BASE_URL + "/api/push-token");
      debug.info("Push", "Registering push token with server…");
      await authClient.$fetch(`${BASE_URL}/api/push-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, platform: Platform.OS }),
      });
      console.log("[PushSetup] Push token registered successfully on server");
      debug.info("Push", "Push token registered successfully");
    } catch (err: any) {
      console.log("[PushSetup] Failed to register push token on server: " + (err?.message ?? String(err)));
      debug.error("Push", "Failed to register push token", {
        error: err?.message ?? String(err),
      });
    }

    return token;
  } catch (e: any) {
    console.log("[PushSetup] push registration crashed: " + (e?.message ?? String(e)));
    debug.error("Push", "push registration exception", { error: e?.message ?? String(e) });
    return null;
  }
}
