import { useState } from "react";
import { View, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCreateTicket } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";

export default function NewTicket() {
  const insets = useSafeAreaInsets();
  const createTicket = useCreateTicket();
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");

  const handleCreate = async () => {
    if (!description.trim()) {
      return Alert.alert("Error", "Please enter a description");
    }
    try {
      await createTicket.mutateAsync({
        description: description.trim(),
        status,
      });
      router.back();
    } catch (e: any) {
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
