import { View, Text, TouchableOpacity, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../../lib/auth-client";
import { debug } from "../../lib/debug";

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { data: session } = authClient.useSession();

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          debug.info("Settings", "Logging out…");
          await authClient.signOut();
          debug.info("Settings", "Logged out, routing to sign-in");
          router.replace("/sign-in");
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-gray-50" style={{ paddingBottom: insets.bottom }}>
      {/* Profile */}
      <View className="bg-white p-4 mx-4 mt-4 rounded-xl">
        <Text className="text-lg font-bold mb-1">
          {session?.user?.name ?? "User"}
        </Text>
        <Text className="text-gray-500">{session?.user?.email ?? ""}</Text>
      </View>

      {/* Session info */}
      <View className="bg-white p-4 mx-4 mt-4 rounded-xl">
        <Text className="text-sm text-gray-500 mb-1">Active Organization</Text>
        <Text className="text-base font-medium">
          {(session?.session as any)?.activeOrganizationId
            ? "Connected"
            : "No organization selected"}
        </Text>
      </View>

      {/* Logout */}
      <View className="mx-4 mt-8">
        <TouchableOpacity
          className="bg-red-500 rounded-lg py-3.5 items-center"
          onPress={handleLogout}
        >
          <Text className="text-white font-semibold text-base">Logout</Text>
        </TouchableOpacity>
      </View>

      <Text className="text-center text-gray-400 text-xs mt-8">
        Mobile Tickets v1.0.0
      </Text>
    </View>
  );
}
