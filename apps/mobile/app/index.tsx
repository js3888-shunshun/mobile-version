import { View, Text, ActivityIndicator } from "react-native";
import { router, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { debug } from "../lib/debug";

export default function Index() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    debug.info("Index", "Checking auth session…");
    authClient.getSession()
      .then(({ data }) => {
        const ok = !!data?.session;
        debug.info("Index", ok ? "Session found, routing to tabs" : "No session, routing to sign-in", {
          hasSession: ok,
          userId: data?.session?.userId,
        });
        setHasSession(ok);
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
      </View>
    );
  }

  if (hasSession) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/sign-in" />;
}
