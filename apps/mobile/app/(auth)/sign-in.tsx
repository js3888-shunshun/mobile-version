import { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../../lib/auth-client";
import { ensureActiveOrg } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card } from "../../components/ui/card";
import { Separator } from "../../components/ui/separator";
import { debug } from "../../lib/debug";

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      debug.warn("SignIn", "Form validation: empty fields");
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    debug.info("SignIn", `Attempting sign in for: ${email.trim()}`);
    setLoading(true);
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        debug.error("SignIn", "Sign in failed", {
          code: result.error.code,
          message: result.error.message,
        });
        Alert.alert("Sign In Failed", result.error.message ?? "Unknown error");
      } else {
        debug.info("SignIn", "Sign in successful, setting up workspace…");
        const ok = await ensureActiveOrg();
        debug.info("SignIn", `Org setup: ${ok ? "success" : "no orgs found"}`);
        if (!ok) {
          Alert.alert(
            "No Workspace",
            "You are not a member of any organization. Please ask an admin to invite you.",
          );
        }
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      debug.error("SignIn", "Sign in exception", { error: e?.message ?? String(e) });
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

      <Card className="gap-4">
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
      </Card>

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
