import { View, Text } from "react-native";
import { cn } from "../../lib/utils";

export function Avatar({
  className,
  name,
  size = "default",
}: {
  className?: string;
  name?: string;
  size?: "sm" | "default" | "lg";
}) {
  const initials = (name ?? "?").slice(0, 2).toUpperCase();

  const sizeClasses = {
    sm: "w-8 h-8",
    default: "w-10 h-10",
    lg: "w-16 h-16",
  };

  const textSizeClasses = {
    sm: "text-xs",
    default: "text-sm",
    lg: "text-xl",
  };

  return (
    <View
      className={cn(
        "rounded-full bg-gray-800 items-center justify-center",
        sizeClasses[size],
        className,
      )}
    >
      <Text
        className={cn("font-semibold text-white", textSizeClasses[size])}
      >
        {initials}
      </Text>
    </View>
  );
}

export function AvatarImage() {
  // Not implemented yet - would show actual image
  return null;
}

export function AvatarFallback({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      className={cn(
        "rounded-full bg-gray-800 items-center justify-center",
        className,
      )}
    >
      {typeof children === "string" ? (
        <Text className="font-semibold text-white text-sm">{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}
