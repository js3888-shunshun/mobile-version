import { View, Text, ActivityIndicator } from "react-native";
import { router, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { ensureActiveOrg } from "../lib/api";
import { registerForPushNotifications } from "../lib/push";
import { debug } from "../lib/debug";

export default function Index() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [orgReady, setOrgReady] = useState(false);

  useEffect(() => {
    debug.info("Index", "Checking auth session…");
    authClient.getSession()
      .then(async ({ data }) => {
        const ok = !!data?.session;
        debug.info("Index", ok ? "Session found, ensuring active org…" : "No session, routing to sign-in", {
          hasSession: ok,
          userId: data?.session?.userId,
          activeOrgId: (data?.session as any)?.activeOrganizationId,
        });
        setHasSession(ok);

        if (ok) {
          // Auto-select an organization if none is active
          const ready = await ensureActiveOrg();
          setOrgReady(ready);
          // Register push token on cold start with existing session
          if (ready) registerForPushNotifications();
        }
      })
      .catch((err) => {
        debug.error("Index", "Session check failed, routing to sign-in", {
          error: err?.message ?? String(err),
        });
        setHasSession(false);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#000" />
        <Text className="text-gray-500 mt-4">Loading…</Text>
      </View>
    );
  }

  if (hasSession && !orgReady) {
    // Session exists but we haven't confirmed an active org yet
    // Show a brief loading; if orgReady stays false, show error
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <ActivityIndicator size="large" color="#000" />
        <Text className="text-gray-500 mt-4 text-center">
          Setting up your workspace…
        </Text>
      </View>
    );
  }

  if (hasSession) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/sign-in" />;
}
