import { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../../lib/auth-client";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export default function SignUp() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (result.error) {
        Alert.alert("Sign Up Failed", result.error.message ?? "Unknown error");
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: any) {
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
