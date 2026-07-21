import { View, Text } from "react-native";
import type { TicketStep } from "@mobile/shared";
import { Card } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../../lib/utils";

interface TodoStepProps {
  step: TicketStep;
  done: boolean;
  onToggle: (done: boolean) => void;
}

export function TodoStep({ step, done, onToggle }: TodoStepProps) {
  return (
    <Card
      className={cn(
        "gap-2",
        done ? "bg-green-50 border-green-200" : "",
      )}
    >
      <View className="flex-row justify-between items-center">
        <Text className="text-base font-semibold">ERP Update Required</Text>
        {done ? (
          <View className="bg-green-100 rounded-full px-2 py-0.5">
            <Text className="text-xs text-green-700">Done</Text>
          </View>
        ) : (
          <View className="bg-yellow-100 rounded-full px-2 py-0.5">
            <Text className="text-xs text-yellow-700">Pending</Text>
          </View>
        )}
      </View>

      <Text className="text-sm text-gray-700">{step.instruction}</Text>

      <Checkbox
        checked={done}
        onCheckedChange={onToggle}
        label="I have completed this in the ERP"
      />
    </Card>
  );
}
