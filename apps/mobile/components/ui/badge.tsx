import { type VariantProps, cva } from "class-variance-authority";
import { View, Text } from "react-native";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "px-2.5 py-1 rounded-full items-center justify-center self-start",
  {
    variants: {
      variant: {
        default: "bg-black",
        secondary: "bg-gray-200",
        destructive: "bg-red-100",
        success: "bg-green-100",
        warning: "bg-yellow-100",
        outline: "bg-transparent border border-gray-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const textVariants = cva("text-xs font-semibold capitalize", {
  variants: {
    variant: {
      default: "text-white",
      secondary: "text-gray-800",
      destructive: "text-red-800",
      success: "text-green-800",
      warning: "text-yellow-800",
      outline: "text-gray-700",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string;
  children: React.ReactNode;
}

export function Badge({ className, variant, children }: BadgeProps) {
  return (
    <View className={cn(badgeVariants({ variant }), className)}>
      <Text className={cn(textVariants({ variant }))}>{children}</Text>
    </View>
  );
}
