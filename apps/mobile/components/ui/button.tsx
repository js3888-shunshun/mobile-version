import { type VariantProps, cva } from "class-variance-authority";
import { TouchableOpacity, Text, type TouchableOpacityProps } from "react-native";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "rounded-lg items-center justify-center py-3.5 px-4",
  {
    variants: {
      variant: {
        default: "bg-black",
        destructive: "bg-red-500",
        outline: "bg-white border border-gray-300",
        ghost: "bg-transparent",
        secondary: "bg-gray-200",
      },
      size: {
        default: "py-3.5 px-4",
        sm: "py-2 px-3",
        lg: "py-4 px-6",
        icon: "w-10 h-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonTextVariants = cva("text-base font-semibold text-center", {
  variants: {
    variant: {
      default: "text-white",
      destructive: "text-white",
      outline: "text-black",
      ghost: "text-black",
      secondary: "text-black",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface ButtonProps
  extends TouchableOpacityProps,
    VariantProps<typeof buttonVariants> {
  children: React.ReactNode;
}

export function Button({
  className,
  variant,
  size,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <TouchableOpacity
      className={cn(
        buttonVariants({ variant, size }),
        disabled && "opacity-50",
        className,
      )}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      {typeof children === "string" ? (
        <Text className={cn(buttonTextVariants({ variant }))}>{children}</Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}
