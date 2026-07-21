import { View, Text } from "react-native";
import type { TicketEditTarget } from "@mobile/shared";
import { Card } from "../ui/card";
import { DiffRow } from "./DiffRow";

interface EditStepProps {
  targets: TicketEditTarget[];
  editable?: boolean;
  onDiffEdit?: (targetIndex: number, field: string, newValue: string) => void;
}

export function EditStep({ targets, editable = false, onDiffEdit }: EditStepProps) {
  const grouped = targets.reduce(
    (acc, t) => {
      const label = t.table
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      if (!acc[label]) acc[label] = [];
      acc[label].push(t);
      return acc;
    },
    {} as Record<string, TicketEditTarget[]>,
  );

  return (
    <View className="gap-3">
      {Object.entries(grouped).map(([tableLabel, groupTargets]) => (
        <View key={tableLabel}>
          <Text className="text-xs font-semibold text-gray-500 uppercase mb-1">
            {tableLabel}{" "}
            <Text className="text-gray-400 font-normal lowercase">
              ({groupTargets[0].operation})
            </Text>
          </Text>
          <Card className="p-0 divide-y divide-gray-100">
            {groupTargets.map((target, ti) => (
              <View key={ti} className="px-4 py-3">
                {target.diff.map((d, di) => (
                  <DiffRow
                    key={`${ti}-${di}`}
                    diff={d}
                    editable={editable}
                    onEdit={(field, val) => onDiffEdit?.(
                      targets.indexOf(groupTargets[ti]),
                      field,
                      val,
                    )}
                  />
                ))}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </View>
  );
}
