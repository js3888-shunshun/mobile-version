import { View, Text, TextInput } from "react-native";
import type { TicketStep } from "@mobile/shared";
import { Card } from "../ui/card";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

interface SendStepProps {
  step: TicketStep;
  editable?: boolean;
  onDraftEdit?: (field: string, value: string) => void;
  onSkip?: () => void;
}

export function SendStep({ step, editable = false, onDraftEdit, onSkip }: SendStepProps) {
  const draft = step.draft;
  if (!draft) return null;

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
            value={draft.to.join(", ")}
            onChangeText={(t) => onDraftEdit?.("to", t)}
          />
        ) : (
          <Text className="text-sm text-black py-2">{draft.to.join(", ")}</Text>
        )}
      </View>

      {draft.cc && draft.cc.length > 0 ? (
        <View>
          <Label>CC</Label>
          {editable ? (
            <TextInput
              className="text-sm text-black bg-gray-100 rounded-lg px-3 py-2 border border-gray-200"
              value={draft.cc.join(", ")}
              onChangeText={(t) => onDraftEdit?.("cc", t)}
            />
          ) : (
            <Text className="text-sm text-black py-2">{draft.cc.join(", ")}</Text>
          )}
        </View>
      ) : null}

      <View>
        <Label>Subject</Label>
        {editable ? (
          <TextInput
            className="text-sm text-black bg-gray-100 rounded-lg px-3 py-2 border border-gray-200"
            value={draft.subject}
            onChangeText={(t) => onDraftEdit?.("subject", t)}
          />
        ) : (
          <Text className="text-sm text-black py-2">{draft.subject}</Text>
        )}
      </View>

      <View>
        <Label>Body</Label>
        {editable ? (
          <TextInput
            className="text-sm text-black bg-gray-100 rounded-lg px-3 py-2 border border-gray-200 min-h-[100]"
            value={draft.body}
            onChangeText={(t) => onDraftEdit?.("body", t)}
            multiline
            textAlignVertical="top"
          />
        ) : (
          <Text className="text-sm text-gray-700 py-2" numberOfLines={6}>
            {draft.body}
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
