import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { authClient } from "./auth-client";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Request notification permissions and register the Expo push token
 * with our server.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[push] permission not granted");
    return null;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync();
  console.log("[push] token:", token);

  try {
    await authClient.$fetch(`${BASE_URL}/api/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    console.log("[push] token registered");
  } catch (err) {
    console.error("[push] failed to register token:", err);
  }

  return token;
}
