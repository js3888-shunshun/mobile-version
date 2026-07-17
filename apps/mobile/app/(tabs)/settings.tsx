import { View, Text, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../../lib/auth-client";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Separator } from "../../components/ui/separator";
import { useOrgName } from "../../lib/api";
import { useOrgStore } from "../../lib/org-store";
import { debug } from "../../lib/debug";

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { data: session } = authClient.useSession();
  const { data: orgName } = useOrgName();
  const storedOrg = useOrgStore((s) => s.activeOrg);

  const user = session?.user;
  const activeOrgId = (session?.session as any)?.activeOrganizationId as string | undefined || storedOrg?.id;

  const handleLogout = () => {
    const doLogout = async () => {
      debug.info("Settings", "Logging out…");
      await authClient.signOut();
      debug.info("Settings", "Logged out, routing to sign-in");
      router.replace("/sign-in");
    };
    if (typeof window !== "undefined" && window.confirm) {
      if (window.confirm("Are you sure you want to logout?")) doLogout();
      return;
    }
    Alert.alert("Logout", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: doLogout },
    ]);
  };

  return (
    <View className="flex-1 bg-gray-50" style={{ paddingBottom: insets.bottom }}>
      {/* Profile */}
      <Card className="mx-4 mt-4 flex-row items-center gap-3">
        <Avatar name={user?.name ?? "?"} size="lg" />
        <View className="flex-1">
          <Text className="text-lg font-bold mb-1">
            {user?.name ?? "User"}
          </Text>
          <Text className="text-gray-500">{user?.email ?? ""}</Text>
        </View>
      </Card>

      {/* Organization */}
      <Card className="mx-4 mt-3">
        <Text className="text-sm text-gray-500 mb-1">Active Organization</Text>
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold">
            {orgName ?? "Loading…"}
          </Text>
          {activeOrgId ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="warning">None</Badge>
          )}
        </View>
      </Card>

      <Separator className="mx-4 mt-6" />

      {/* Logout */}
      <View className="mx-4 mt-6">
        <Button
          variant="destructive"
          className="w-full"
          onPress={handleLogout}
        >
          Logout
        </Button>
      </View>

      <Text className="text-center text-gray-400 text-xs mt-8">
        Mobile Tickets v1.0.0
      </Text>
    </View>
  );
}
