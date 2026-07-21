import { View, Text, TouchableOpacity, Modal, ScrollView } from "react-native";
import { cn } from "../../lib/utils";
import { Button } from "./button";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, title, children }: DialogProps) {
  if (!open) return null;

  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onRequestClose={() => onOpenChange(false)}
    >
      <View className="flex-1 bg-black/50 justify-center items-center px-4">
        <View className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-lg">
          {title ? (
            <Text className="text-lg font-semibold mb-4">{title}</Text>
          ) : null}
          <ScrollView className="max-h-96">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <View className="flex-row justify-end gap-3 mt-4">{children}</View>;
}
