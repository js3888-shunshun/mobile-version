import { Stack, router } from "expo-router";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { registerForPushNotifications } from "../lib/push";
import "./globals.css";

const queryClient = new QueryClient();

function NotificationProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  useEffect(() => {
    if (Platform.OS === "web") return;

    const Notifications = require("expo-notifications");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    registerForPushNotifications();

    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification: any) => {
        const data = notification.request.content.data;
        if (data?.type === "ticket_update") {
          qc.invalidateQueries({ queryKey: ["tickets"] });
        }
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response: any) => {
        const data = response.notification.request.content.data;
        if (data?.ticketId) {
          router.push(`/ticket/${data.ticketId}`);
        }
      });

    return () => {
      if (notificationListener.current)
        Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current)
        Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, [qc]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="ticket/new"
            options={{
              headerShown: true,
              title: "New Ticket",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="ticket/[id]"
            options={{ headerShown: true, title: "Ticket" }}
          />
        </Stack>
      </NotificationProvider>
    </QueryClientProvider>
  );
}
