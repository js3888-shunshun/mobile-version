import { Platform } from "react-native";
import { authClient } from "./auth-client";
import { debug } from "./debug";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://172.105.135.182:4000";

/**
 * Register for push notifications. No-op on web.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === "web") {
    debug.info("Push", "Skipping push on web");
    return null;
  }

  debug.info("Push", "Requesting notification permissions…");

  const Notifications = require("expo-notifications");
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  debug.info("Push", `Permission status: ${existingStatus}`);

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    debug.info("Push", `Permission requested, result: ${status}`);
  }

  if (finalStatus !== "granted") {
    debug.warn("Push", "Permission not granted, aborting push registration");
    return null;
  }

  debug.info("Push", "Getting Expo push token…");
  const { data: token } = await Notifications.getExpoPushTokenAsync();
  debug.info("Push", `Got push token: ${token}`);

  try {
    debug.info("Push", "Registering push token with server…");
    await authClient.$fetch(`${BASE_URL}/api/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    debug.info("Push", "Push token registered successfully");
  } catch (err: any) {
    debug.error("Push", "Failed to register push token", {
      error: err?.message ?? String(err),
    });
  }

  return token;
}
