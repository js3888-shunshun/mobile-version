import { memo } from "react";
import { View, Text } from "react-native";
import type { Ticket } from "@mobile/shared";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";

const familyBadge: Record<string, "default" | "warning" | "success" | "destructive"> = {
  write_fact: "default",
  supplier_response: "warning",
  chase: "default",
  triage: "destructive",
  delivery_failure: "destructive",
  recommendation: "success",
};

const statusVariant: Record<string, "warning" | "success" | "secondary"> = {
  open: "warning",
  accepted: "success",
  closed: "secondary",
};

export const TicketCard = memo(function TicketCard({ ticket }: { ticket: Ticket }) {
  return (
    <Card className="gap-2">
      <View className="flex-row justify-between items-start">
        <Text className="text-base font-medium flex-1 mr-2" numberOfLines={2}>
          {ticket.title}
        </Text>
        <Badge variant={statusVariant[ticket.status] ?? "secondary"}>
          {ticket.status}
        </Badge>
      </View>

      {ticket.creationReason ? (
        <Text className="text-xs text-gray-500" numberOfLines={1}>
          {ticket.creationReason}
        </Text>
      ) : null}

      <View className="flex-row items-center gap-2 mt-1">
        <Badge variant={familyBadge[ticket.kindKey] ?? "secondary"}>
          {ticket.kindKey.replace(/_/g, " ")}
        </Badge>
        {ticket.supplierCode ? (
          <Text className="text-xs text-gray-400">{ticket.supplierCode}</Text>
        ) : null}
        {ticket.poId ? (
          <Text className="text-xs text-gray-400">
            PO {ticket.poId.slice(0, 8)}...
          </Text>
        ) : null}
        {ticket.expiresAt ? (
          <View className="bg-red-50 rounded-full px-2 py-0.5">
            <Text className="text-xs text-red-600">
              Expires {new Date(ticket.expiresAt).toLocaleDateString()}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="text-xs text-gray-400">
        Created {new Date(ticket.createdAt).toLocaleDateString()}
      </Text>
    </Card>
  );
});
