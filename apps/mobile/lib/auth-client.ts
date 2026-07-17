import { createAuthClient } from "better-auth/react";
import { Platform } from "react-native";
import { debug } from "./debug";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://172.105.135.182:4000";

debug.info("AuthClient", `Initializing auth client`, {
  platform: Platform.OS,
  baseUrl: BASE_URL,
});

let authClient: ReturnType<typeof createAuthClient>;

if (Platform.OS === "web") {
  // Web: cookie-based auth with credentials: "include" for cross-origin
  debug.info("AuthClient", "Using web (cookie-based) auth");
  authClient = createAuthClient({
    baseURL: BASE_URL,
    fetchOptions: { credentials: "include" },
  });
} else {
  // Native: use expo plugin with SecureStore
  debug.info("AuthClient", "Using native (SecureStore) auth");
  try {
    const { expoClient } = require("@better-auth/expo/client");
    const SecureStore = require("expo-secure-store");

    debug.info("AuthClient", "Native modules loaded: expoClient=" + typeof expoClient + ", SecureStore=" + typeof SecureStore);

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
    debug.info("AuthClient", "Native auth client created successfully");
  } catch (err: any) {
    debug.error("AuthClient", "FATAL: Failed to load native auth modules", {
      error: err?.message ?? String(err),
      stack: err?.stack ?? "no stack",
    });
    // Fallback: create a minimal auth client (no plugins) so the app
    // doesn't crash on startup. Auth will be broken but at least the
    // error screen will render.
    authClient = createAuthClient({
      baseURL: BASE_URL,
    });
    debug.warn("AuthClient", "Fallback auth client created (auth WILL be broken!)");
  }
}

debug.info("AuthClient", "Auth client created successfully");

export { authClient };
