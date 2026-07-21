import { View, Text, TouchableOpacity, Modal, FlatList } from "react-native";
import { cn } from "../../lib/utils";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder = "Select...",
  className,
}: SelectProps) {
  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? placeholder;

  return (
    <View className={cn("relative", className)}>
      <TouchableOpacity
        className="flex-row items-center justify-between bg-white border border-gray-300 rounded-lg px-3 py-3"
        activeOpacity={0.7}
      >
        <Text
          className={cn(
            "text-base",
            value ? "text-black" : "text-gray-400",
          )}
        >
          {selectedLabel}
        </Text>
        <Text className="text-gray-400">▼</Text>
      </TouchableOpacity>
    </View>
  );
}
