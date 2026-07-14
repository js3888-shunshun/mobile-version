import { Text, type TextProps } from "react-native";
import { cn } from "../../lib/utils";

export function Label({ className, ...props }: TextProps) {
  return (
    <Text
      className={cn(
        "text-sm font-medium mb-1.5 ml-1 text-gray-700",
        className,
      )}
      {...props}
    />
  );
}
