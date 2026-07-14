import { View, Text, ActivityIndicator } from "react-native";
import { router, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

export default function Index() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    authClient.getSession()
      .then(({ data }) => {
        setHasSession(!!data?.session);
      })
      .catch(() => {
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
