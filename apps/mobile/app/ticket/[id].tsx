import { useState, useMemo } from "react";
import {
  View,
  Text,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  Keyboard,
  ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTicket, useCommitTicket, useCloseTicket } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { StepWalker, createInitialState, canCommit } from "../../components/ticket/StepWalker";
import { EvidencePanel } from "../../components/ticket/EvidencePanel";
import { CloseDialog } from "../../components/ticket/CloseDialog";
import { debug } from "../../lib/debug";
import type { TicketStep, TicketClosedKind } from "@mobile/shared";

export default function TicketDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: ticket, isLoading } = useTicket(id!);
  const commitTicket = useCommitTicket();
  const closeTicket = useCloseTicket();
  const [closeOpen, setCloseOpen] = useState(false);

  // Step walker state (all in-memory, per spec §2.3)
  const [stepState, setStepState] = useState(() =>
    createInitialState((ticket?.steps as TicketStep[]) ?? []),
  );

  // Reset state when ticket loads
  const steps = (ticket?.steps as TicketStep[]) ?? [];
  const commitEnabled = useMemo(
    () => canCommit(steps, stepState),
    [steps, stepState],
  );

  // Determine if fact ticket (cannot be dismissed)
  const isFactTicket = (ticket as any)?.kind?.family === "write_fact";

  const handleCommit = async () => {
    if (!ticket) return;

    const decisionPath = Object.entries(stepState.decisions).map(
      ([stepId, chosenOption]) => ({ stepId, chosenOption }),
    );
    const skippedStepIds = Array.from(stepState.skipped);

    // Assemble final step payloads
    const finalSteps = steps.map((s) => {
      const step: any = { ...s };
      if (s.kind === "edit" && stepState.editDrafts[s.id]) {
        step.targets = s.targets?.map((t: any, ti: number) => {
          const diffs = stepState.editDrafts[s.id]
            .filter((e) => e.targetIndex === ti)
            .map((e) => ({
              field: e.field,
              from: t.diff.find((d: any) => d.field === e.field)?.from ?? null,
              to: e.newValue,
            }));
          return { ...t, diff: diffs };
        });
      }
      if (s.kind === "send" && stepState.sendDrafts[s.id]) {
        const d = stepState.sendDrafts[s.id];
        step.draft = {
          to: d.to.split(",").map((x: string) => x.trim()),
          cc: d.cc ? d.cc.split(",").map((x: string) => x.trim()) : undefined,
          subject: d.subject,
          body: d.body,
          marker: (s.draft as any)?.marker,
        };
      }
      return step;
    });

    debug.info("TicketDetail", `Committing ticket ${id}`);
    try {
      await commitTicket.mutateAsync({
        ticketId: id!,
        steps: finalSteps,
        decisionPath,
        skippedStepIds,
      });
      debug.info("TicketDetail", `Ticket ${id} committed`);
      Alert.alert("Accepted", "Ticket has been committed successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      debug.error("TicketDetail", "Commit failed", { error: e?.message });
      Alert.alert(
        "Commit Failed",
        e?.message ?? "The ticket may have been superseded or the data changed.",
        [{ text: "Reload", onPress: () => router.replace(`/ticket/${id}`) }],
      );
    }
  };

  const handleClose = async (kind: TicketClosedKind, reason: string) => {
    if (!ticket) return;
    debug.info("TicketDetail", `Closing ticket ${id} as ${kind}`);
    try {
      await closeTicket.mutateAsync({
        ticketId: id!,
        closedKind: kind,
        closedReason: `${kind}:${reason}`,
      });
      setCloseOpen(false);
      Alert.alert("Closed", "Ticket has been closed.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      debug.error("TicketDetail", "Close failed", { error: e?.message });
      Alert.alert("Error", e?.message ?? "Failed to close ticket");
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-gray-500">Ticket not found</Text>
      </View>
    );
  }

  const statusVariant: Record<string, "warning" | "success" | "destructive" | "secondary"> = {
    open: "warning",
    accepted: "success",
    closed: "secondary",
    draft: "secondary",
  };

  return (
    <Pressable
      className="flex-1 bg-gray-50"
      style={{ paddingBottom: insets.bottom, paddingTop: insets.top }}
      onPress={Keyboard.dismiss}
    >
      {/* Header */}
      <View className="flex-row items-center px-2 py-3 bg-white border-b border-gray-200">
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
          className="px-3 py-2"
        >
          <Text className="text-base text-blue-600 font-semibold">← Back</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold ml-2 flex-1" numberOfLines={1}>
          {ticket.title}
        </Text>
        <Badge variant={statusVariant[ticket.status] ?? "secondary"}>
          {ticket.status}
        </Badge>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info card */}
        <Card className="mx-4 mt-4 gap-2">
          <Text className="text-sm text-gray-600">{ticket.creationReason}</Text>
          <View className="flex-row flex-wrap gap-2">
            {(ticket as any)?.kind ? (
              <Badge variant="secondary">
                {(ticket as any).kind.title ?? ticket.kindKey}
              </Badge>
            ) : null}
            {ticket.poId ? (
              <Badge variant="outline">PO {ticket.poId.slice(0, 8)}...</Badge>
            ) : null}
            {ticket.supplierCode ? (
              <Badge variant="outline">{ticket.supplierCode}</Badge>
            ) : null}
            {ticket.expiresAt ? (
              <Badge variant="destructive">
                Expires {new Date(ticket.expiresAt).toLocaleDateString()}
              </Badge>
            ) : null}
          </View>
        </Card>

        {/* Evidence */}
        <View className="mx-4 mt-4">
          <EvidencePanel emails={(ticket as any)?.emails ?? []} />
        </View>

        {/* Steps */}
        {steps.length > 0 ? (
          <View className="mx-4 mt-4">
            <StepWalker
              steps={steps}
              state={stepState}
              onDecisionChange={(stepId, key) =>
                setStepState((s) => ({
                  ...s,
                  decisions: { ...s.decisions, [stepId]: key },
                }))
              }
              onTodoToggle={(stepId, done) =>
                setStepState((s) => {
                  const next = new Set(s.todosDone);
                  done ? next.add(stepId) : next.delete(stepId);
                  return { ...s, todosDone: next };
                })
              }
              onSkipToggle={(stepId, skip) =>
                setStepState((s) => {
                  const next = new Set(s.skipped);
                  skip ? next.add(stepId) : next.delete(stepId);
                  return { ...s, skipped: next };
                })
              }
              onEditDraftChange={(stepId, ti, field, val) =>
                setStepState((s) => {
                  const edits = [...(s.editDrafts[stepId] ?? [])];
                  const idx = edits.findIndex(
                    (e) => e.targetIndex === ti && e.field === field,
                  );
                  if (idx >= 0) edits[idx] = { ...edits[idx], newValue: val };
                  return {
                    ...s,
                    editDrafts: { ...s.editDrafts, [stepId]: edits },
                  };
                })
              }
              onSendDraftChange={(stepId, field, value) =>
                setStepState((s) => ({
                  ...s,
                  sendDrafts: {
                    ...s.sendDrafts,
                    [stepId]: {
                      ...s.sendDrafts[stepId],
                      [field]: value,
                    },
                  },
                }))
              }
            />
          </View>
        ) : (
          <Card className="mx-4 mt-4">
            <Text className="text-sm text-gray-500 italic">No steps defined</Text>
          </Card>
        )}
      </ScrollView>

      {/* Bottom bar — only for open tickets */}
      {ticket.status === "open" ? (
        <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex-row gap-3" style={{ paddingBottom: insets.bottom + 8 }}>
          <Button
            className="flex-1"
            onPress={handleCommit}
            disabled={!commitEnabled || commitTicket.isPending}
          >
            {commitTicket.isPending
              ? "Committing..."
              : commitEnabled
                ? "Accept & Commit"
                : "Complete All Steps"}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onPress={() => setCloseOpen(true)}
            disabled={closeTicket.isPending}
          >
            Close
          </Button>
        </View>
      ) : ticket.status === "accepted" ? (
        <View
          className="absolute bottom-0 left-0 right-0 bg-green-50 border-t border-green-200 px-4 py-4"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <Text className="text-center text-green-700 font-semibold">
            ✓ Accepted{" "}
            {ticket.resolvedAt
              ? `on ${new Date(ticket.resolvedAt).toLocaleDateString()}`
              : ""}
          </Text>
        </View>
      ) : ticket.status === "closed" ? (
        <View
          className="absolute bottom-0 left-0 right-0 bg-gray-50 border-t border-gray-200 px-4 py-4"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <Text className="text-center text-gray-500 font-semibold">
            Closed: {(ticket as any).closedKind ?? "unknown"}
          </Text>
        </View>
      ) : null}

      {/* Close dialog */}
      <CloseDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onConfirm={handleClose}
        isPending={closeTicket.isPending}
        isFactTicket={isFactTicket}
      />
    </Pressable>
  );
}
