import { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../../lib/auth-client";
import { ensureActiveOrg } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card } from "../../components/ui/card";
import { debug } from "../../lib/debug";

export default function SignUp() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      debug.warn("SignUp", "Form validation: empty fields");
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    if (password.length < 6) {
      debug.warn("SignUp", "Password too short");
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    debug.info("SignUp", `Attempting sign up for: ${email.trim()}`);
    setLoading(true);
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (result.error) {
        debug.error("SignUp", "Sign up failed", {
          code: result.error.code,
          message: result.error.message,
        });
        Alert.alert("Sign Up Failed", result.error.message ?? "Unknown error");
      } else {
        debug.info("SignUp", "Sign up successful, setting up workspace…");
        const ok = await ensureActiveOrg();
        debug.info("SignUp", `Org setup: ${ok ? "success" : "no orgs found"}`);
        if (!ok) {
          Alert.alert(
            "No Workspace",
            "Account created! However, you are not a member of any organization. Please ask an admin to invite you.",
          );
        }
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      debug.error("SignUp", "Sign up exception", { error: e?.message ?? String(e) });
      Alert.alert("Error", e?.message ?? "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      className="flex-1 justify-center bg-white px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Text className="text-3xl font-bold text-center mb-2">Create Account</Text>
      <Text className="text-gray-500 text-center mb-8">Join your organization</Text>

      <Card className="gap-4">
        <Input
          label="Name"
          placeholder="Your name"
          value={name}
          onChangeText={setName}
        />

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
          placeholder="At least 6 characters"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Button
          onPress={handleSignUp}
          disabled={loading}
          className="w-full"
        >
          {loading ? "Creating account..." : "Sign Up"}
        </Button>
      </Card>

      <View className="h-4" />

      <TouchableOpacity onPress={() => router.back()}>
        <Text className="text-center text-gray-600">
          Already have an account?{" "}
          <Text className="text-black font-semibold">Sign In</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}
