import { Text } from "react-native";
import type { Ticket } from "@mobile/shared";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";

const badgeVariant: Record<string, "warning" | "success" | "destructive"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

export function TicketCard({ ticket }: { ticket: Ticket }) {
  const variant = badgeVariant[ticket.status] ?? "secondary";

  return (
    <Card>
      <Text className="text-base font-medium mb-2" numberOfLines={2}>
        {ticket.description}
      </Text>
      <Badge variant={variant}>{ticket.status}</Badge>
    </Card>
  );
}
