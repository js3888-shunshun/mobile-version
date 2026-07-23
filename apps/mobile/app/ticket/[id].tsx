import { useState, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Keyboard,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTicket, useCommitTicket, useCloseTicket } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { StepWalker, createInitialState, canCommit } from "../../components/ticket/StepWalker";
import type { StepWalkerState } from "../../components/ticket/StepWalker";
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

  // Track the ticket ID we last initialized state for
  const lastInitIdRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<KeyboardAwareScrollView>(null);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const s1 = Keyboard.addListener("keyboardWillShow", (e) => setKbHeight(e.endCoordinates.height));
    const s2 = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { s1.remove(); s2.remove(); };
  }, []);

  const handleBodyFocus = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        (scrollRef.current as any)?.scrollToEnd?.({ animated: true });
      });
    });
  };

  // Step walker state (all in-memory, per spec §2.3)
  const [stepState, setStepState] = useState<StepWalkerState>(() =>
    createInitialState([]),
  );

  // Re-initialize state when ticket data loads or ticket ID changes
  useEffect(() => {
    if (ticket && ticket.ticketId !== lastInitIdRef.current) {
      lastInitIdRef.current = ticket.ticketId;
      setStepState(createInitialState((ticket.steps as TicketStep[]) ?? []));
    }
  }, [ticket?.ticketId, !!ticket]);

  // Determine if ticket is readonly (already accepted/closed)
  const isReadonly = ticket ? ticket.status !== "open" : true;

  // For accepted tickets, use the committed resolution snapshot as display steps
  const displaySteps: TicketStep[] = useMemo(() => {
    if (!ticket) return [];
    const resolution = ticket.resolution as any;
    if (resolution?.steps?.length > 0) {
      return resolution.steps as TicketStep[];
    }
    return (ticket.steps as TicketStep[]) ?? [];
  }, [ticket?.status, ticket?.resolution, ticket?.steps]);

  // Pre-fill decisions from resolution for readonly display
  const resolutionDecisions: Record<string, string> = useMemo(() => {
    if (!ticket) return {};
    const decisions: Record<string, string> = {};
    const resolution = ticket.resolution as any;
    if (resolution?.decisionPath) {
      for (const d of resolution.decisionPath) {
        decisions[d.stepId] = d.chosenOption;
      }
    }
    return decisions;
  }, [ticket?.resolution]);

  // Pre-fill todos from resolution for readonly display
  const resolutionTodosDone: Set<string> = useMemo(() => {
    if (!ticket) return new Set();
    const resolution = ticket.resolution as any;
    if (resolution?.todoStepIds) {
      return new Set(resolution.todoStepIds as string[]);
    }
    return new Set();
  }, [ticket?.resolution]);

  // Human-readable decision summary for the accepted bar
  const decisionSummary = useMemo(() => {
    if (!ticket) return "";
    const parts: string[] = [];
    const resolution = ticket.resolution as any;
    if (resolution?.decisionPath) {
      for (const d of resolution.decisionPath) {
        const step = (resolution.steps as TicketStep[])?.find(
          (s) => s.id === d.stepId,
        );
        const option = step?.options?.find(
          (o: { key: string; label: string }) => o.key === d.chosenOption,
        );
        if (option) parts.push(option.label);
      }
    }
    return parts.join(" · ");
  }, [ticket?.resolution]);

  // Derived: steps for the walker and whether commit is allowed
  const steps = displaySteps;
  const commitEnabled = useMemo(
    () => canCommit(steps, stepState) && !isReadonly,
    [steps, stepState, isReadonly],
  );

  // Determine if fact ticket (cannot be dismissed)
  const isFactTicket = (ticket as any)?.kind?.family === "write_fact";

  const handleCommit = async () => {
    if (!ticket) return;

    const decisionPath = Object.entries(stepState.decisions).map(
      ([stepId, chosenOption]) => ({ stepId, chosenOption }),
    );
    const skippedStepIds = Array.from(stepState.skipped);
    const todoStepIds = Array.from(stepState.todosDone);

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
        todoStepIds,
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
    <View
      className="flex-1 bg-gray-50"
      style={{ paddingBottom: insets.bottom, paddingTop: insets.top }}
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

      <KeyboardAwareScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + kbHeight * 0.5 }}
        keyboardShouldPersistTaps="handled"
        enableAutomaticScroll={false}
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
              readonly={isReadonly}
              decisions={resolutionDecisions}
              todosDone={resolutionTodosDone}
              onBodyFocus={handleBodyFocus}
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
                  if (idx >= 0) {
                    edits[idx] = { ...edits[idx], newValue: val };
                  } else {
                    edits.push({ targetIndex: ti, field, newValue: val });
                  }
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
      </KeyboardAwareScrollView>

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
          className="absolute bottom-0 left-0 right-0 bg-green-50 border-t border-green-200 px-4 py-3"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <Text className="text-center text-green-700 font-semibold">
            ✓ Accepted{" "}
            {ticket.resolvedAt
              ? `on ${new Date(ticket.resolvedAt).toLocaleDateString()}`
              : ""}
          </Text>
          {decisionSummary ? (
            <Text className="text-center text-green-600 text-xs mt-0.5">
              {decisionSummary}
            </Text>
          ) : null}
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
    </View>
  );
}
