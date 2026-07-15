import { useState } from "react";
import { View, Alert, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCreateTicket } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { debug } from "../../lib/debug";

export default function NewTicket() {
  const insets = useSafeAreaInsets();
  const createTicket = useCreateTicket();
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");

  const handleCreate = async () => {
    if (!description.trim()) {
      return Alert.alert("Error", "Please enter a description");
    }
    debug.info("NewTicket", "Creating ticket", { status });
    try {
      await createTicket.mutateAsync({
        description: description.trim(),
        status,
      });
      debug.info("NewTicket", "Ticket created successfully");
      router.back();
    } catch (e: any) {
      debug.error("NewTicket", "Create ticket failed", { error: e?.message });
      Alert.alert("Error", e?.message ?? "Failed to create ticket");
    }
  };

  const statuses: Array<{ key: "pending" | "approved" | "rejected"; variant: "warning" | "success" | "destructive" }> = [
    { key: "pending", variant: "warning" },
    { key: "approved", variant: "success" },
    { key: "rejected", variant: "destructive" },
  ];

  return (
    <View className="flex-1 bg-gray-50" style={{ paddingBottom: insets.bottom }}>
      {/* Back button */}
      <View className="flex-row items-center px-2 py-2 bg-white border-b border-gray-200">
        <TouchableOpacity
          onPress={() => router.back()}
          className="px-3 py-2"
        >
          <Text className="text-base text-blue-600 font-semibold">← Back</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold ml-2">New Ticket</Text>
      </View>

      <Card className="mx-4 mt-4 gap-4">
        <Textarea
          label="Description"
          placeholder="What needs to be done?"
          value={description}
          onChangeText={setDescription}
          autoFocus
        />

        <View>
          <Label>Status</Label>
          <View className="flex-row gap-2">
            {statuses.map(({ key, variant }) => (
              <Badge
                key={key}
                variant={status === key ? variant : "outline"}
              >
                {key}
              </Badge>
            ))}
          </View>
        </View>

        <Button
          onPress={handleCreate}
          disabled={createTicket.isPending}
        >
          {createTicket.isPending ? "Creating..." : "Create Ticket"}
        </Button>
      </Card>
    </View>
  );
}
