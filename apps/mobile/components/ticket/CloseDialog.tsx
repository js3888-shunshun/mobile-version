import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import type { TicketClosedKind } from "@mobile/shared";
import { Dialog, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

interface CloseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (kind: TicketClosedKind, reason: string) => void;
  isPending?: boolean;
  isFactTicket: boolean;
}

const CLOSE_OPTIONS: Array<{
  kind: TicketClosedKind;
  label: string;
  description: string;
}> = [
  {
    kind: "dismissed",
    label: "Dismiss",
    description: "Nothing should happen here — spam, off-topic, or unnecessary",
  },
  {
    kind: "expired",
    label: "Expired",
    description: "The deadline for this ticket has passed",
  },
];

export function CloseDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  isFactTicket,
}: CloseDialogProps) {
  const [selectedKind, setSelectedKind] = useState<TicketClosedKind | null>(null);
  const [reason, setReason] = useState("");

  const options = isFactTicket
    ? [] // Fact tickets cannot be dismissed
    : CLOSE_OPTIONS;

  const handleConfirm = () => {
    if (!selectedKind) return;
    onConfirm(selectedKind, reason.trim());
    setSelectedKind(null);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Close Ticket">
      {isFactTicket ? (
        <View className="gap-2 py-2">
          <Text className="text-sm text-red-600 font-medium">
            This is a fact ticket and cannot be dismissed.
          </Text>
          <Text className="text-sm text-gray-600">
            ERP-fact tickets must be accepted. If the data is wrong, correct the values and accept.
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          <Text className="text-sm text-gray-600">
            Why are you closing this ticket? This will be recorded so the system won't re-raise the same event.
          </Text>

          {options.map((opt) => (
            <TouchableOpacity
              key={opt.kind}
              onPress={() => setSelectedKind(opt.kind)}
              activeOpacity={0.7}
            >
              <View
                className={cn(
                  "border-2 rounded-xl p-3",
                  selectedKind === opt.kind
                    ? "border-black bg-gray-50"
                    : "border-gray-200",
                )}
              >
                <Text className="text-sm font-semibold">{opt.label}</Text>
                <Text className="text-xs text-gray-500 mt-0.5">
                  {opt.description}
                </Text>
              </View>
            </TouchableOpacity>
          ))}

          {selectedKind ? (
            <View>
              <Text className="text-sm font-medium mb-1">Note (optional)</Text>
              <TextInput
                className="text-sm bg-gray-100 rounded-lg px-3 py-2 border border-gray-200 min-h-[60]"
                value={reason}
                onChangeText={setReason}
                placeholder="e.g., off-topic newsletter, spam"
                multiline
                textAlignVertical="top"
              />
            </View>
          ) : null}
        </View>
      )}

      <DialogFooter>
        <Button variant="outline" onPress={() => onOpenChange(false)}>
          Cancel
        </Button>
        {!isFactTicket && selectedKind ? (
          <Button
            variant="destructive"
            onPress={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Closing..." : `Close as ${selectedKind}`}
          </Button>
        ) : null}
        {isFactTicket ? (
          <Button onPress={() => onOpenChange(false)}>OK</Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}
