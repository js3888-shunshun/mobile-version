import { TextInput, View, Text, type TextInputProps } from "react-native";
import { cn } from "../../lib/utils";

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({
  className,
  label,
  error,
  ...props
}: InputProps) {
  return (
    <View className="mb-4">
      {label && (
        <Text className="text-sm font-medium mb-1.5 ml-1 text-gray-700">
          {label}
        </Text>
      )}
      <TextInput
        className={cn(
          "border border-gray-300 rounded-lg px-4 py-3 text-base bg-white",
          error && "border-red-500",
          props.editable === false && "bg-gray-100 text-gray-500",
          className,
        )}
        placeholderTextColor="#9CA3AF"
        {...props}
      />
      {error && (
        <Text className="text-red-500 text-xs mt-1 ml-1">{error}</Text>
      )}
    </View>
  );
}
