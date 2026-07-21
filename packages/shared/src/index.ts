// ============================================================================
// Shared types — Scout ticket-model v2
// ============================================================================

// ─── Enums / Union Types ──────────────────────────────────────────────────

export type TicketStatus = "draft" | "open" | "accepted" | "closed";

export type TicketClosedKind =
  | "superseded"
  | "withdrawn"
  | "expired"
  | "dismissed";

export type TicketFamily =
  | "write_fact"
  | "supplier_response"
  | "chase"
  | "triage"
  | "delivery_failure"
  | "recommendation";

export type TicketStepKind =
  | "edit"
  | "send"
  | "decision"
  | "todo"
  | "classify";

export type TicketEvidenceType =
  | "email_message"
  | "email_attachment"
  | "erp_event";

export type PoStatus =
  | "unacknowledged"
  | "acknowledged"
  | "rejected"
  | "cancelled";

export type PoLineStatus =
  | "unacknowledged"
  | "acknowledged"
  | "exception"
  | "cancelled"
  | "shipped"
  | "rejected";

// ─── Step types (matching schema-v2.ts TicketStep) ────────────────────────

export interface TicketRecordBinding {
  table: string;
  rowKey: string;
  operation: "insert" | "update";
  version: number | null; // null iff operation === "insert"
}

export interface TicketFieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export interface TicketEditTarget extends TicketRecordBinding {
  diff: TicketFieldDiff[];
}

export interface TicketStep {
  id: string;
  kind: TicketStepKind;
  optional?: boolean;
  /** edit / todo-mirror-write: one step may touch the PO header AND multiple lines */
  targets?: TicketEditTarget[];
  /** send: editable draft + bookkeeping marker */
  draft?: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    marker?: string;
  };
  /** todo: external work the human asserts done */
  instruction?: string;
  /** decision: mutually exclusive branches */
  options?: Array<{
    key: string;
    label: string;
    steps: TicketStep[];
  }>;
  meta?: Record<string, unknown>;
}

export interface TicketResolution {
  decisionPath?: Array<{ stepId: string; chosenOption: string }>;
  skippedStepIds?: string[];
  /** Final step payloads as committed (post human edits). */
  steps?: TicketStep[];
}

// ─── Core ticket ──────────────────────────────────────────────────────────

export interface Ticket {
  ticketId: string;
  orgId: string;
  kindKey: string;
  title: string;
  status: TicketStatus;
  hasWrites: boolean;
  poId: string | null;
  supplierCode: string | null;
  steps: TicketStep[];
  creationReason: string;
  createdByUserId: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  closedKind: TicketClosedKind | null;
  closedReason: string | null;
  closedRefTicketId: string | null;
  resolution: TicketResolution | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Ticket kind ──────────────────────────────────────────────────────────

export interface TicketKind {
  orgId: string;
  key: string;
  family: TicketFamily;
  title: string;
  isWriteBearing: boolean;
  suppressionWindowHours: number | null;
  serializationExempt: boolean;
  isSystem: boolean;
  enabled: boolean;
  definition: string;
}

// ─── Purchase order ───────────────────────────────────────────────────────

export interface PurchaseOrder {
  poId: string;
  orgId: string;
  poCode: string;
  supplierCode: string;
  status: PoStatus;
  statusReason: string | null;
  ownerUserId: string;
  ackRequestedAt: string | null;
  version: number;
  sentAt: string | null;
  orderDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoLine {
  lineId: string;
  orgId: string;
  poId: string;
  reqLineId: string | null;
  quantity: string;
  unitPrice: string;
  status: PoLineStatus;
  exceptionReason: string | null;
  promisedDate: string | null;
  asnRequestedAt: string | null;
  leadtimeConfirmedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Supplier ─────────────────────────────────────────────────────────────

export interface Supplier {
  orgId: string;
  supplierCode: string;
  supplierAbbr: string;
  supplierName: string;
}

// ─── Ticket evidence ──────────────────────────────────────────────────────

export interface TicketEvidence {
  evidenceId: string;
  orgId: string;
  ticketId: string;
  type: TicketEvidenceType;
  emailMessageId: string | null;
  attachmentExtractionId: string | null;
  erpPayload: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
}

// ─── Email message (for evidence display) ─────────────────────────────────

export interface EmailAddress {
  name?: string;
  email?: string;
}

export interface EmailMessage {
  id: string;
  orgId: string;
  threadId: string;
  inboxId: string;
  providerMessageId: string;
  subject: string | null;
  snippet: string | null;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  bodyHtml: string | null;
  bodyText: string | null;
  hasAttachments: boolean;
  receivedAt: string | null;
  direction: string;
}

// ─── Notification ─────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

// ─── Member (existing) ────────────────────────────────────────────────────

export interface Member {
  id: string;
  userId: string;
  role: string;
  name?: string;
  email?: string;
}

// ─── Commit / Close payloads ──────────────────────────────────────────────

export interface CommitTicketPayload {
  /** Final step payloads (with buyer's edits applied). */
  steps: TicketStep[];
  /** Which decision option was chosen at each decision step. */
  decisionPath: Array<{ stepId: string; chosenOption: string }>;
  /** IDs of optional steps the buyer chose to skip. */
  skippedStepIds: string[];
}

export interface CloseTicketPayload {
  closedKind: TicketClosedKind;
  closedReason: string;
}
