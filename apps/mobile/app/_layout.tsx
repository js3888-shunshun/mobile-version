import { Stack, router } from "expo-router";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { registerForPushNotifications } from "../lib/push";
import { debug } from "../lib/debug";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { authClient } from "../lib/auth-client";
import "./globals.css";

// ── Global error handlers (catch errors outside React tree) ──
if (typeof globalThis !== "undefined") {
  const prevError = (globalThis as any).ErrorUtils?.getGlobalHandler?.();
  if (prevError) {
    (globalThis as any).ErrorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
      console.error("[GlobalHandler] Uncaught error (fatal=" + isFatal + "):", error?.message ?? String(error));
      console.error("[GlobalHandler] Stack:", error?.stack ?? "no stack");
      if (prevError) prevError(error, isFatal);
    });
  }
}

// Catch unhandled promise rejections
if (typeof globalThis !== "undefined" && typeof (globalThis as any).HermesInternal !== "undefined") {
  // Hermes: use ErrorUtils
} else {
  // JSC / others
  require("react-native").NativeModules?.ExceptionsManager?.updateExceptionHandler?.(
    (errorStr: string) => {
      console.error("[ExceptionManager]", errorStr);
    }
  );
}

debug.info("App", "RootLayout initializing…");
debug.info("App", `Platform: ${Platform.OS} v${Platform.Version}, __DEV__=${typeof __DEV__ !== "undefined" ? __DEV__ : "undefined"}`);

const queryClient = new QueryClient();

console.log("[PushSetup] NotificationProvider module loaded");

function NotificationProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);
  const { data: session } = authClient.useSession();
  const lastUserId = useRef<string | null>(null);

  console.log("[PushSetup] NotificationProvider render, session=" + (session?.user?.id ?? "no-session"));

  useEffect(() => {
    console.log("[PushSetup] useEffect fired, platform=" + Platform.OS);

    if (Platform.OS === "web") {
      console.log("[PushSetup] Skipping push on web");
      return;
    }

    let Notifications: any;
    try {
      console.log("[PushSetup] require(expo-notifications)...");
      Notifications = require("expo-notifications");
      console.log("[PushSetup] expo-notifications loaded OK");
    } catch (err: any) {
      console.log("[PushSetup] expo-notifications FAIL: " + (err?.message ?? String(err)));
      debug.error("NotificationProvider", "expo-notifications not available", { error: err?.message ?? String(err) });
      return;
    }

    // --- Set handler (safe to call multiple times) ---
    console.log("[PushSetup] calling setNotificationHandler...");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    console.log("[PushSetup] setNotificationHandler done");

    // --- Register listeners once ---
    if (!notificationListener.current) {
      console.log("[PushSetup] registering listeners...");
      notificationListener.current =
        Notifications.addNotificationReceivedListener((notification: any) => {
          console.log("[PushSetup] Foreground notification received:", notification.request.content.data);
          const data = notification.request.content.data;
          if (data?.type === "ticket_update") {
            console.log("[PushSetup] Invalidating tickets query");
            qc.invalidateQueries({ queryKey: ["tickets"] });
          }
        });

      responseListener.current =
        Notifications.addNotificationResponseReceivedListener((response: any) => {
          console.log("[PushSetup] Notification tapped:", response.notification.request.content.data);
          const data = response.notification.request.content.data;
          if (data?.ticketId) {
            router.push(`/ticket/${data.ticketId}`);
          }
        });

      console.log("[PushSetup] Listeners registered");
    }

    // --- Re-register push token when user changes ---
    const currentUserId = session?.user?.id ?? null;
    console.log("[PushSetup] session check: currentUserId=" + currentUserId + ", lastUserId=" + (lastUserId.current ?? "null"));
    if (currentUserId !== lastUserId.current) {
      console.log("[PushSetup] User changed, re-registering push token...");
      lastUserId.current = currentUserId;
      registerForPushNotifications();
    }

    // --- Cleanup on unmount ---
    return () => {
      console.log("[PushSetup] Cleanup — removing listeners");
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
        notificationListener.current = null;
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
        responseListener.current = null;
      }
    };
  }, [session?.user?.id, qc]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="ticket/new"
            options={{
              headerShown: false,
              title: "New Ticket",
            }}
          />
          <Stack.Screen
            name="ticket/[id]"
            options={{ headerShown: false, title: "Ticket" }}
          />
        </Stack>
      </NotificationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
