import { TouchableOpacity, View, Text } from "react-native";
import { cn } from "../../lib/utils";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onCheckedChange, label, disabled }: CheckboxProps) {
  return (
    <TouchableOpacity
      onPress={() => !disabled && onCheckedChange(!checked)}
      disabled={disabled}
      activeOpacity={0.7}
      className={cn("flex-row items-center gap-3 py-2", disabled && "opacity-50")}
    >
      <View
        className={cn(
          "w-5 h-5 rounded border-2 items-center justify-center",
          checked ? "bg-black border-black" : "border-gray-300 bg-white",
        )}
      >
        {checked && <Text className="text-white text-xs font-bold">✓</Text>}
      </View>
      {label ? <Text className="text-sm text-gray-800">{label}</Text> : null}
    </TouchableOpacity>
  );
}
