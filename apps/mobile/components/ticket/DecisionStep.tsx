import { View, Text, TouchableOpacity } from "react-native";
import type { TicketStep } from "@mobile/shared";
import { Card } from "../ui/card";
import { cn } from "../../lib/utils";

interface DecisionStepProps {
  step: TicketStep;
  selectedOption: string | null;
  onSelectOption: (optionKey: string) => void;
}

export function DecisionStep({
  step,
  selectedOption,
  onSelectOption,
}: DecisionStepProps) {
  const options = step.options ?? [];

  return (
    <Card className="gap-3">
      <Text className="text-base font-semibold">Decision Required</Text>

      {options.map((option) => {
        const isSelected = selectedOption === option.key;

        return (
          <TouchableOpacity
            key={option.key}
            onPress={() => onSelectOption(option.key)}
            activeOpacity={0.7}
          >
            <View
              className={cn(
                "border-2 rounded-xl p-4",
                isSelected
                  ? "border-black bg-gray-50"
                  : "border-gray-200 bg-white",
              )}
            >
              <View className="flex-row items-center gap-2 mb-1">
                <View
                  className={cn(
                    "w-4 h-4 rounded-full border-2 items-center justify-center",
                    isSelected
                      ? "border-black bg-black"
                      : "border-gray-300",
                  )}
                >
                  {isSelected && (
                    <View className="w-2 h-2 rounded-full bg-white" />
                  )}
                </View>
                <Text className="text-base font-semibold text-black">
                  {option.label}
                </Text>
              </View>
              {option.steps && option.steps.length > 0 ? (
                <Text className="text-xs text-gray-500 ml-6">
                  {option.steps.length} step{option.steps.length > 1 ? "s" : ""}:{" "}
                  {option.steps.map((s) => s.kind).join(" → ")}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </Card>
  );
}
