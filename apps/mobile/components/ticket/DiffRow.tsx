import { View, Text, TextInput } from "react-native";
import type { TicketFieldDiff } from "@mobile/shared";

interface DiffRowProps {
  diff: TicketFieldDiff;
  editable?: boolean;
  onEdit?: (field: string, newValue: string) => void;
}

export function DiffRow({ diff, editable = false, onEdit }: DiffRowProps) {
  const label = diff.field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const fromDisplay = diff.from === null ? "(new)" : String(diff.from);
  const toValue = String(diff.to ?? "");

  return (
    <View className="flex-row items-center py-2 border-b border-gray-100">
      <View className="flex-1 pr-2">
        <Text className="text-xs text-gray-500 mb-0.5">{label}</Text>
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-gray-400 line-through">{fromDisplay}</Text>
          <Text className="text-sm text-gray-400">→</Text>
          {editable ? (
            <TextInput
              className="flex-1 text-sm text-black bg-gray-100 rounded px-2 py-1 border border-gray-300"
              value={toValue}
              onChangeText={(text) => onEdit?.(diff.field, text)}
            />
          ) : (
            <Text className="text-sm text-black font-medium">{toValue}</Text>
          )}
        </View>
      </View>
    </View>
  );
}
