import { Stack, router } from "expo-router";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { Platform, AppState } from "react-native";
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

/**
 * Provides push notification handlers and token registration.
 * Does NOT use authClient.useSession() to avoid Proxy/Hermes compatibility issues.
 * Instead, registers on mount and re-registers when app returns to foreground.
 */
function NotificationProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);
  const hasSetup = useRef(false);

  const setupNotifications = useCallback(() => {
    if (Platform.OS === "web") {
      console.log("[PushSetup] Skipping push on web");
      return () => {};
    }

    let Notifications: any;
    try {
      Notifications = require("expo-notifications");
    } catch (err: any) {
      console.log("[PushSetup] expo-notifications FAIL: " + (err?.message ?? String(err)));
      return () => {};
    }

    // Verify module loaded correctly
    if (!Notifications || typeof Notifications.setNotificationHandler !== "function") {
      console.log("[PushSetup] expo-notifications module incomplete");
      return () => {};
    }

    // Set notification handler (controls how notifications appear when app is foregrounded)
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

    // Register listeners once
    if (!hasSetup.current) {
      hasSetup.current = true;
      console.log("[PushSetup] registering listeners...");

      notificationListener.current =
        Notifications.addNotificationReceivedListener((notification: any) => {
          console.log("[PushSetup] Foreground notification received:", JSON.stringify(notification.request.content.data));
          const data = notification.request.content.data;
          if (data?.type === "ticket_update") {
            console.log("[PushSetup] Invalidating tickets query");
            qc.invalidateQueries({ queryKey: ["tickets"] });
          }
        });

      responseListener.current =
        Notifications.addNotificationResponseReceivedListener((response: any) => {
          console.log("[PushSetup] Notification tapped:", JSON.stringify(response.notification.request.content.data));
          const data = response.notification.request.content.data;
          if (data?.ticketId) {
            router.push(`/ticket/${data.ticketId}`);
          }
        });

      console.log("[PushSetup] Listeners registered");
    }

    // Register push token (don't block the effect)
    console.log("[PushSetup] Registering push token...");
    registerForPushNotifications();

    return () => {
      // Cleanup not needed here — handled by the useEffect cleanup
    };
  }, [qc]);

  useEffect(() => {
    console.log("[PushSetup] useEffect fired, platform=" + Platform.OS);

    const cleanup = setupNotifications();

    // Re-register push token when app returns to foreground
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        console.log("[PushSetup] App became active, re-registering push token...");
        registerForPushNotifications();
      }
    });

    return () => {
      console.log("[PushSetup] Cleanup — removing listeners");
      cleanup?.();
      appStateSub.remove();
      if (notificationListener.current) {
        try {
          const Notifications = require("expo-notifications");
          Notifications.removeNotificationSubscription(notificationListener.current);
        } catch {}
        notificationListener.current = null;
      }
      if (responseListener.current) {
        try {
          const Notifications = require("expo-notifications");
          Notifications.removeNotificationSubscription(responseListener.current);
        } catch {}
        responseListener.current = null;
      }
    };
  }, [setupNotifications]);

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
