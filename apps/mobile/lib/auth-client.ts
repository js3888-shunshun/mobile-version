import { createAuthClient } from "better-auth/react";
import { Platform } from "react-native";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://172.105.135.182:4000";

let authClient: ReturnType<typeof createAuthClient>;

if (Platform.OS === "web") {
  // Web: cookie-based auth with credentials: "include" for cross-origin
  authClient = createAuthClient({
    baseURL: BASE_URL,
    fetchOptions: { credentials: "include" },
  });
} else {
  // Native: use expo plugin with SecureStore
  const { expoClient } = require("@better-auth/expo/client");
  const SecureStore = require("expo-secure-store");

  authClient = createAuthClient({
    baseURL: BASE_URL,
    plugins: [
      expoClient({
        scheme: "mobileversion",
        storagePrefix: "mobileversion",
        storage: SecureStore,
      }),
    ],
  });
}

export { authClient };
