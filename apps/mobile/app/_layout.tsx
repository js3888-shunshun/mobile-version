import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import "../globals.css";

const queryClient = new QueryClient();

export default function RootLayout() {
  useEffect(() => {
    // Configure how notifications are handled when app is foregrounded
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="ticket/new"
          options={{ headerShown: true, title: "New Ticket", presentation: "modal" }}
        />
        <Stack.Screen
          name="ticket/[id]"
          options={{ headerShown: true, title: "Ticket" }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
