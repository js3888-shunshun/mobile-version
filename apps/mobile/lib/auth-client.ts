import { createAuthClient } from "better-auth/react";
import { Platform } from "react-native";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
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
}

debug.info("AuthClient", "Auth client created successfully");

export { authClient };
