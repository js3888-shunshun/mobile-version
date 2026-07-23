import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { authClient } from "../../lib/auth-client";
import { View } from "react-native";
import { Avatar } from "../../components/ui/avatar";

function HeaderAvatar() {
  const { data: session } = authClient.useSession();
  return (
    <View style={{ marginRight: 16 }}>
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
          tabBarIcon: ({ color, size }) => <Ionicons name="ticket-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarLabel: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
