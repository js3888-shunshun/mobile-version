import { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { EmailMessage } from "@mobile/shared";
import { Card } from "../ui/card";

interface EvidencePanelProps {
  emails: EmailMessage[];
}

export function EvidencePanel({ emails }: EvidencePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!emails.length) {
    return (
      <Card className="gap-2">
        <Text className="text-sm text-gray-500 italic">No evidence emails attached</Text>
      </Card>
    );
  }

  return (
    <Card className="gap-2">
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="flex-row justify-between items-center"
        activeOpacity={0.7}
      >
        <Text className="text-base font-semibold">
          Evidence ({emails.length} email{emails.length > 1 ? "s" : ""})
        </Text>
        <Text className="text-gray-400">{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {expanded ? (
        <View className="gap-2 mt-1">
          {emails.map((email) => (
            <View
              key={email.id}
              className="bg-gray-50 rounded-lg p-3 gap-1"
            >
              <Text className="text-xs text-gray-500">
                From: {email.from?.[0]?.email ?? "unknown"}
              </Text>
              <Text className="text-sm font-medium text-black">
                {email.subject ?? "(no subject)"}
              </Text>
              {email.snippet ? (
                <Text className="text-xs text-gray-600" numberOfLines={2}>
                  {email.snippet}
                </Text>
              ) : null}
              {email.receivedAt ? (
                <Text className="text-xs text-gray-400">
                  {new Date(email.receivedAt).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
