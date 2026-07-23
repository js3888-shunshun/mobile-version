import { View, Text } from "react-native";
import type { TicketStep, TicketEditTarget } from "@mobile/shared";
import { EditStep } from "./EditStep";
import { SendStep } from "./SendStep";
import { DecisionStep } from "./DecisionStep";
import { TodoStep } from "./TodoStep";
import { cn } from "../../lib/utils";

/** Local state for one edit step's diffs. */
export interface EditDraftState {
  targetIndex: number;
  field: string;
  newValue: string;
}

/** Local state for one send step's draft. */
export interface SendDraftState {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}

export interface StepWalkerState {
  /** Which decision option was chosen (keyed by stepId). */
  decisions: Record<string, string>;
  /** Which optional step IDs were skipped. */
  skipped: Set<string>;
  /** Which todo step IDs are marked done. */
  todosDone: Set<string>;
  /** Edits to edit-step diff "to" values. */
  editDrafts: Record<string, EditDraftState[]>;
  /** Edits to send-step drafts. */
  sendDrafts: Record<string, SendDraftState>;
}

export function createInitialState(steps: TicketStep[]): StepWalkerState {
  const decisions: Record<string, string> = {};
  const todosDone = new Set<string>();
  const editDrafts: Record<string, EditDraftState[]> = {};
  const sendDrafts: Record<string, SendDraftState> = {};

  function walk(s: TicketStep[]) {
    for (const step of s) {
      if (step.kind === "send" && step.draft) {
        sendDrafts[step.id] = {
          to: step.draft.to.join(", "),
          cc: step.draft.cc?.join(", "),
          subject: step.draft.subject,
          body: step.draft.body,
        };
      }
      if (step.kind === "edit" && step.targets) {
        const edits: EditDraftState[] = [];
        step.targets.forEach((t, ti) => {
          t.diff.forEach((d) => {
            edits.push({
              targetIndex: ti,
              field: d.field,
              newValue: d.to === null ? "" : String(d.to),
            });
          });
        });
        editDrafts[step.id] = edits;
      }
      if (step.options) {
        for (const opt of step.options) {
          walk(opt.steps);
        }
      }
    }
  }

  walk(steps);
  return { decisions, skipped: new Set(), todosDone, editDrafts, sendDrafts };
}

/** Count all steps including nested decision-branch steps. */
function flattenSteps(steps: TicketStep[]): TicketStep[] {
  const out: TicketStep[] = [];
  for (const s of steps) {
    out.push(s);
    if (s.options) {
      for (const opt of s.options) {
        out.push(...flattenSteps(opt.steps));
      }
    }
  }
  return out;
}

/** Get the steps that are active given the current decision choices. */
function getActiveSteps(
  steps: TicketStep[],
  decisions: Record<string, string>,
): TicketStep[] {
  const out: TicketStep[] = [];
  for (const s of steps) {
    out.push(s);
    if (s.options) {
      const chosen = decisions[s.id];
      if (chosen) {
        const opt = s.options.find((o) => o.key === chosen);
        if (opt) out.push(...opt.steps);
      }
    }
  }
  return out;
}

interface StepWalkerProps {
  steps: TicketStep[];
  state: StepWalkerState;
  readonly?: boolean;
  /** Pre-filled decisions for readonly mode (from resolution.decisionPath). */
  decisions?: Record<string, string>;
  /** Pre-filled todos for readonly mode (from resolution.todoStepIds). */
  todosDone?: Set<string>;
  onBodyFocus?: () => void;
  onDecisionChange: (stepId: string, optionKey: string) => void;
  onTodoToggle: (stepId: string, done: boolean) => void;
  onSkipToggle: (stepId: string, skip: boolean) => void;
  onEditDraftChange: (
    stepId: string,
    targetIndex: number,
    field: string,
    newValue: string,
  ) => void;
  onSendDraftChange: (stepId: string, field: string, value: string) => void;
}

export function StepWalker({
  steps,
  state,
  readonly = false,
  decisions: decisionsOverride,
  todosDone: todosDoneOverride,
  onBodyFocus,
  onDecisionChange,
  onTodoToggle,
  onSkipToggle,
  onEditDraftChange,
  onSendDraftChange,
}: StepWalkerProps) {
  const effectiveDecisions =
    decisionsOverride && Object.keys(decisionsOverride).length > 0
      ? decisionsOverride
      : state.decisions;
  const activeSteps = getActiveSteps(steps, effectiveDecisions);
  const allSteps = flattenSteps(steps);

  return (
    <View className="gap-4">
      {activeSteps.map((step, idx) => {
        const stepNum = idx + 1;
        const isSkipped = state.skipped.has(step.id);

        return (
          <View key={step.id} className="gap-2">
            <View className="flex-row items-center gap-2">
              <View
                className={cn(
                  "w-6 h-6 rounded-full items-center justify-center",
                  isSkipped ? "bg-gray-200" : "bg-black",
                )}
              >
                <Text
                  className={cn(
                    "text-xs font-bold",
                    isSkipped ? "text-gray-500" : "text-white",
                  )}
                >
                  {stepNum}
                </Text>
              </View>
              <Text className="text-sm font-semibold text-gray-800 capitalize">
                {step.kind === "edit"
                  ? "Review Changes"
                  : step.kind === "send"
                    ? "Send Email"
                    : step.kind === "decision"
                      ? "Make Decision"
                      : step.kind === "todo"
                        ? "ERP Update"
                        : step.kind}
              </Text>
              {step.optional ? (
                <View className="bg-gray-100 rounded-full px-2 py-0.5">
                  <Text className="text-xs text-gray-500">Optional</Text>
                </View>
              ) : null}
              {isSkipped ? (
                <View className="bg-gray-100 rounded-full px-2 py-0.5">
                  <Text className="text-xs text-gray-500">Skipped</Text>
                </View>
              ) : null}
            </View>

            {isSkipped ? null : step.kind === "edit" && step.targets ? (
              <EditStep
                targets={step.targets}
                editable={!readonly}
                onDiffEdit={(ti, field, val) =>
                  onEditDraftChange(step.id, ti, field, val)
                }
              />
            ) : step.kind === "send" ? (
              <SendStep
                step={step}
                editable={!readonly}
                draftValues={readonly ? undefined : state.sendDrafts[step.id]}
                onDraftEdit={(field, val) =>
                  onSendDraftChange(step.id, field, val)
                }
                onSkip={() => onSkipToggle(step.id, true)}
                onBodyFocus={onBodyFocus}
              />
            ) : step.kind === "decision" ? (
              <DecisionStep
                step={step}
                selectedOption={effectiveDecisions[step.id] ?? null}
                readonly={readonly}
                onSelectOption={(key) => onDecisionChange(step.id, key)}
              />
            ) : step.kind === "todo" ? (
              <TodoStep
                step={step}
                done={
                  todosDoneOverride && todosDoneOverride.size > 0
                    ? todosDoneOverride.has(step.id)
                    : state.todosDone.has(step.id)
                }
                readonly={readonly}
                onToggle={(done) => onTodoToggle(step.id, done)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Check if all required steps are satisfied for commit. */
export function canCommit(
  steps: TicketStep[],
  state: StepWalkerState,
): boolean {
  const activeSteps = getActiveSteps(steps, state.decisions);

  for (const step of activeSteps) {
    if (state.skipped.has(step.id)) continue;

    if (step.kind === "decision") {
      if (!state.decisions[step.id]) return false;
    }
    if (step.kind === "todo") {
      if (!state.todosDone.has(step.id)) return false;
    }
    // Non-optional steps without a skip must be completed
    if (!step.optional && step.kind === "send") {
      // Send steps auto-satisfied if draft exists
      if (!state.sendDrafts[step.id]) return false;
    }
  }

  return true;
}
