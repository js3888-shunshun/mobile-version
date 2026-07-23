import { View, Text, TextInput } from "react-native";
import type { TicketStep } from "@mobile/shared";
import type { SendDraftState } from "./StepWalker";
import { Card } from "../ui/card";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

interface SendStepProps {
  step: TicketStep;
  editable?: boolean;
  draftValues?: SendDraftState;
  onDraftEdit?: (field: string, value: string) => void;
  onSkip?: () => void;
  onBodyFocus?: () => void;
}

export function SendStep({
  step,
  editable = false,
  draftValues,
  onDraftEdit,
  onSkip,
  onBodyFocus,
}: SendStepProps) {
  const draft = step.draft;

  if (!draft) return null;

  // Use state draft values for editable fields, falling back to original step draft
  const to = draftValues?.to ?? draft.to.join(", ");
  const cc = draftValues?.cc ?? draft.cc?.join(", ");
  const subject = draftValues?.subject ?? draft.subject;
  const body = draftValues?.body ?? draft.body;

  return (
    <Card className="gap-3">
      <View className="flex-row justify-between items-center">
        <Text className="text-base font-semibold">Send Email</Text>
        {step.optional && editable && (
          <Button variant="ghost" size="sm" onPress={onSkip}>
            Skip
          </Button>
        )}
      </View>

      <View>
        <Label>To</Label>
        {editable ? (
          <TextInput
            className="text-sm text-black bg-gray-100 rounded-lg px-3 py-2 border border-gray-200"
            value={to}
            onChangeText={(t) => onDraftEdit?.("to", t)}
          />
        ) : (
          <Text className="text-sm text-black py-2">{to}</Text>
        )}
      </View>

      {(cc || editable) ? (
        <View>
          <Label>CC</Label>
          {editable ? (
            <TextInput
              className="text-sm text-black bg-gray-100 rounded-lg px-3 py-2 border border-gray-200"
              value={cc}
              onChangeText={(t) => onDraftEdit?.("cc", t)}
            />
          ) : (
            <Text className="text-sm text-black py-2">{cc}</Text>
          )}
        </View>
      ) : null}

      <View>
        <Label>Subject</Label>
        {editable ? (
          <TextInput
            className="text-sm text-black bg-gray-100 rounded-lg px-3 py-2 border border-gray-200"
            value={subject}
            onChangeText={(t) => onDraftEdit?.("subject", t)}
          />
        ) : (
          <Text className="text-sm text-black py-2">{subject}</Text>
        )}
      </View>

      <View>
        <Label>Body</Label>
        {editable ? (
          <TextInput
            className="text-sm text-black bg-gray-100 rounded-lg px-3 py-2 border border-gray-200 min-h-[120]"
            value={body}
            onChangeText={(t) => onDraftEdit?.("body", t)}
            onFocus={onBodyFocus}
            multiline
            textAlignVertical="top"
          />
        ) : (
          <Text className="text-sm text-gray-700 py-2" numberOfLines={6}>
            {body}
          </Text>
        )}
      </View>

      {draft.marker ? (
        <View className="flex-row items-center gap-2">
          <View className="bg-blue-100 rounded-full px-2 py-0.5">
            <Text className="text-xs text-blue-700">{draft.marker}</Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}
