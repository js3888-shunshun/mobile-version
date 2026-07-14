import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

// Point at our mobile-version server.
// In production, use the deployed URL from BETTER_AUTH_URL env.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export const authClient = createAuthClient({
  baseURL: BASE_URL,
  plugins: [
    expoClient({
      scheme: "mobileversion",
      storagePrefix: "mobileversion",
      storage: SecureStore,
    }),
  ],
});
