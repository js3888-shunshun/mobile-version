import { View, Text, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../lib/auth-client";
import { Sheet } from "./ui/sheet";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Avatar } from "./ui/avatar";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { debug } from "../lib/debug";
import { useOrgName } from "../lib/api";
import { useOrgStore } from "../lib/org-store";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const insets = useSafeAreaInsets();
  const { data: session } = authClient.useSession();
  const { data: orgName } = useOrgName();
  const storedOrg = useOrgStore((s) => s.activeOrg);

  const user = session?.user;
  const activeOrgId = (session?.session as any)?.activeOrganizationId as string | undefined || storedOrg?.id;

  const handleLogout = () => {
    onClose();
    const doLogout = async () => {
      debug.info("Sidebar", "Logging out…");
      await authClient.signOut();
      debug.info("Sidebar", "Logged out, routing to sign-in");
      router.replace("/sign-in");
    };
    // Use window.confirm on web, Alert.alert on native
    if (typeof window !== "undefined" && window.confirm) {
      if (window.confirm("Are you sure you want to logout?")) doLogout();
      return;
    }
    Alert.alert("Logout", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: doLogout },
    ]);
  };

  const navigateTo = (path: string) => {
    onClose();
    router.push(path as any);
  };

  return (
    <Sheet open={open} onClose={onClose} side="left">
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="px-4 py-4">
          <Text className="text-xl font-bold text-gray-900">Mobile Tickets</Text>
        </View>

        <Separator />

        {/* User info */}
        <Card className="mx-4 mt-4">
          <View className="flex-row items-center gap-3">
            <Avatar name={user?.name ?? "?"} size="default" />
            <View className="flex-1">
              <Text className="text-base font-semibold text-gray-900">
                {user?.name ?? "User"}
              </Text>
              <Text className="text-sm text-gray-500" numberOfLines={1}>
                {user?.email ?? ""}
              </Text>
            </View>
          </View>
        </Card>

        {/* Organization info */}
        <Card className="mx-4 mt-3">
          <Text className="text-sm text-gray-500 mb-1">Organization</Text>
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-gray-900">
              {orgName ?? "Loading…"}
            </Text>
            {activeOrgId ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="warning">None</Badge>
            )}
          </View>
        </Card>

        <Separator className="mt-4" />

        {/* Navigation */}
        <View className="px-4 mt-4 gap-2">
          <Button
            variant="ghost"
            className="justify-start"
            onPress={() => navigateTo("/(tabs)")}
          >
            📋  Tickets
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onPress={() => navigateTo("/(tabs)/settings")}
          >
            ⚙️  Settings
          </Button>
        </View>

        {/* Spacer */}
        <View className="flex-1" />

        <Separator />

        {/* Logout */}
        <View className="px-4 py-4" style={{ paddingBottom: insets.bottom + 16 }}>
          <Button
            variant="destructive"
            className="w-full"
            onPress={handleLogout}
          >
            Logout
          </Button>
        </View>
      </View>
    </Sheet>
  );
}
