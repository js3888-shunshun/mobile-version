import { Text, View } from "react-native";
import { Tabs } from "expo-router";
import { authClient } from "../../lib/auth-client";
import { Avatar } from "../../components/ui/avatar";

function HeaderAvatar() {
  const { data: session } = authClient.useSession();
  return (
    <View className="mr-4">
      <Avatar name={session?.user?.name ?? "?"} size="sm" />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "#fff" },
        tabBarActiveTintColor: "#000",
        headerRight: () => <HeaderAvatar />,
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#e5e7eb",
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "500",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Tickets",
          tabBarLabel: "Tickets",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarLabel: "Settings",
        }}
      />
    </Tabs>
  );
}
