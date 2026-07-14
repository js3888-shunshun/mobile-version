import { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../../lib/auth-client";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        Alert.alert("Sign In Failed", result.error.message ?? "Unknown error");
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      className="flex-1 justify-center bg-white px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Text className="text-3xl font-bold text-center mb-2">Mobile Tickets</Text>
      <Text className="text-gray-500 text-center mb-8">Sign in to your account</Text>

      <Input
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <Input
        label="Password"
        placeholder="Your password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button
        onPress={handleSignIn}
        disabled={loading}
        className="w-full"
      >
        {loading ? "Signing in..." : "Sign In"}
      </Button>

      <View className="h-4" />

      <TouchableOpacity onPress={() => router.push("/sign-up")}>
        <Text className="text-center text-gray-600">
          Don't have an account?{" "}
          <Text className="text-black font-semibold">Sign Up</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}
