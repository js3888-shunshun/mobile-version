import { useState } from "react";
import { View, Text, Alert, ActivityIndicator, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTicket, useUpdateTicket, useDeleteTicket } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { Card } from "../../components/ui/card";
import { debug } from "../../lib/debug";

export default function TicketDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: ticket, isLoading } = useTicket(id!);
  const updateTicket = useUpdateTicket();
  const deleteTicket = useDeleteTicket();
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState("");

  const startEdit = () => {
    if (!ticket) return;
    setDesc(ticket.description);
    setStatus(ticket.status);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!desc.trim()) return Alert.alert("Error", "Description required");
    debug.info("TicketDetail", `Updating ticket ${id}`, { status });
    try {
      await updateTicket.mutateAsync({ id: id!, description: desc.trim(), status });
      debug.info("TicketDetail", `Ticket ${id} updated`);
      setEditing(false);
    } catch (e: any) {
      debug.error("TicketDetail", `Update failed for ticket ${id}`, { error: e?.message });
      Alert.alert("Error", e?.message ?? "Update failed");
    }
  };

  const handleDelete = () => {
    Alert.alert("Delete Ticket", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          debug.info("TicketDetail", `Deleting ticket ${id}`);
          try {
            await deleteTicket.mutateAsync(id!);
            debug.info("TicketDetail", `Ticket ${id} deleted, navigating back`);
            router.back();
          } catch (e: any) {
            debug.error("TicketDetail", `Delete failed for ticket ${id}`, {
              error: e?.message ?? String(e),
            });
            Alert.alert("Error", e?.message ?? "Delete failed");
          }
        },
      },
    ]);
  };

  const handleApprove = async () => {
    try {
      await updateTicket.mutateAsync({ id: id!, status: "approved" });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-gray-500">Ticket not found</Text>
      </View>
    );
  }

  const badgeVariant: Record<string, "warning" | "success" | "destructive"> = {
    pending: "warning",
    approved: "success",
    rejected: "destructive",
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
        <Text className="text-lg font-bold ml-2">Ticket Detail</Text>
      </View>

      {editing ? (
        <Card className="mx-4 mt-4 gap-4">
          <Textarea
            label="Description"
            value={desc}
            onChangeText={setDesc}
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

          <View className="flex-row gap-3">
            <Button
              className="flex-1"
              onPress={handleSave}
              disabled={updateTicket.isPending}
            >
              {updateTicket.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onPress={() => setEditing(false)}
            >
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Card className="mx-4 mt-4 gap-3">
          <View className="flex-row justify-between items-start">
            <Text className="text-lg font-semibold flex-1 mr-3">
              {ticket.description}
            </Text>
            <Badge variant={badgeVariant[ticket.status] ?? "secondary"}>
              {ticket.status}
            </Badge>
          </View>

          <Text className="text-xs text-gray-400">
            Created {new Date(ticket.createdAt).toLocaleDateString()}
          </Text>

          <View className="flex-row gap-3 mt-2">
            {ticket.status !== "approved" && (
              <Button
                className="flex-1"
                variant="secondary"
                onPress={handleApprove}
                disabled={updateTicket.isPending}
              >
                ✓ Approve
              </Button>
            )}
            <Button
              className="flex-1"
              variant="outline"
              onPress={startEdit}
            >
              Edit
            </Button>
            <Button
              className="flex-1"
              variant="destructive"
              onPress={handleDelete}
            >
              Delete
            </Button>
          </View>
        </Card>
      )}
    </View>
  );
}
