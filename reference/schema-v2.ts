/**
 * schema-v2.ts — Scout ticket-model redesign.
 *
 * Changes vs. v1 (per ticket-model.md):
 *  - Ticket lifecycle: draft → open → accepted | closed (§3), with normalized
 *    close kinds (superseded / withdrawn / expired / dismissed) + free-text reason
 *    + a self-referencing link to the successor/dominating ticket.
 *  - Steps: the proposed pipeline is a typed jsonb column (§2). No durable
 *    mid-flight state (§2.3) — step progress and edited drafts are session-local;
 *    only the agent-computed proposal and the committed outcome persist.
 *  - Org-extensible ticket kinds: `ticket_kinds` registry with a stable coarse
 *    `family` enum for system code, structured policy columns for concurrency
 *    behavior, and a skill.md-style `definition` body for the agent.
 *  - Domain linkage: tickets carry poId (nullable — triage/#13/#16) + supplierCode.
 *  - Per-PO serialization (§4 rule 4): partial unique index — at most one open
 *    write-bearing ticket per PO. `hasWrites` is snapshotted at ticket creation.
 *  - Evidence: many-to-many `ticket_evidence` (§5 fan-out / dedup).
 *  - Optimistic locking (§4 rule 1): `version` on purchase_orders, po_lines,
 *    supplier_contacts (the ticket-writable targets).
 *  - Audit invariant (§1): audit_log.ticketId — every SOR write traces to its
 *    granting ticket (null only for adapter-layer syncs, §7 footnote).
 *  - Ownership & notification (§6): purchase_orders.ownerUserId (always set),
 *    org_settings.defaultOwnerUserId fallback, grow-only po_subscribers.
 *  - Ingestion (§5): `ingestion_events` records semantic-hash dedup, open-ticket
 *    suppression, and dismissed-memory. `processed_messages` remains the raw
 *    message-id idempotency guard.
 *  - SOR vocabulary: PO status column (partial ack is derived from lines);
 *    line status gains cancelled/shipped; chase bookkeeping timestamps;
 *    ASNs allow multiple per line with quantityShipped.
 *  - purchase_orders.isApproved removed — creation/approval now happens via
 *    ticket commit.
 *
 * Migration notes (not handled here): ticket_status enum values change;
 * po_line_status "pending_ack" → "unacknowledged"; asns unique(org,line) dropped.
 *
 * v2.1 (review feedback):
 *  - Edit targets support inserts: operation "insert" | "update"; inserts bind
 *    version: null and re-check natural-key uniqueness (not version) at commit.
 *  - Per-PO serialization moved to `ticket_write_pos`: one row per PO a
 *    write-bearing ticket touches, partial-unique on (orgId, poId) while open —
 *    closes the multi-PO hole (#13 log, #16 multi-PO bounce).
 *    `ticket_kinds.serializationExempt` exempts bookkeeping-only kinds.
 *  - po_line_status gains "rejected" (#5/#15: PO *and lines* turn rejected).
 *  - CHECK constraints enforce the closed-state contract structurally.
 *  - tickets.resolution snapshots the accepted outcome (chosen branches,
 *    skipped steps, final diffs) — post-commit, so §2.3 still holds.
 *  - tickets.expiresAt + supporting indexes for watchdog scans (§4 expiry, #12).
 *  - po_lines.reqLineId nullable — email-parsed POs (#1) have no requisition.
 *
 * OPERATIONAL NOTE (supersession ordering): the partial unique index on
 * ticket_write_pos is non-deferrable, so a supersession must close the original
 * ticket (and mark its write-pos rows closed) BEFORE opening the successor,
 * within one transaction — the reverse order fails on the index.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const orgIdColumn = () =>
  text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const createdAtColumn = () => timestamp("created_at", { mode: "date" }).defaultNow().notNull();
const updatedAtColumn = () =>
  timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/** Optimistic-locking version (§4 rule 1). Incremented by every committed write. */
const versionColumn = () => integer("version").default(1).notNull();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** PO header status. "Partially acknowledged" is derived from lines, not stored. */
export const poStatusEnum = pgEnum("po_status", [
  "unacknowledged",
  "acknowledged",
  "rejected",
  "cancelled",
]);

export const poLineStatusEnum = pgEnum("po_line_status", [
  "unacknowledged", // v1 "pending_ack"
  "acknowledged",
  "exception",
  "cancelled",
  "shipped",
  "rejected", // #5 accept-branch / #15 whole-PO case: PO *and lines* turn rejected
]);

/** §3: two terminal states only. No "rejected" — wrong proposals are corrected in place. */
export const ticketStatusEnum = pgEnum("ticket_status", [
  "draft", // agent still assembling the pipeline; not visible as work
  "open", // in queue; abandonment keeps it open and recomputes (§2.3)
  "accepted", // human carried it to a successful commit; effects applied
  "closed", // ended without acceptance; closedKind + closedReason required
]);

/** §3 close kinds. New variations go in closedReason, not new enum values. */
export const ticketClosedKindEnum = pgEnum("ticket_closed_kind", [
  "superseded", // (agent) same job recomputed → closedRefTicketId = successor
  "withdrawn", // (agent) dominated by another event → closedRefTicketId = dominator
  "expired", // (agent) watchdog deadline lapsed with nothing left to do (§4)
  "dismissed", // (human) nothing should happen; recorded so ingestion won't re-raise (§5)
]);

/**
 * Coarse event family — what SYSTEM CODE branches on (suppression, serialization,
 * dedup). Small and stable. Fine-grained, org-extensible behavior lives in
 * ticket_kinds rows keyed by text `key`, so new scenarios never need a migration.
 */
export const ticketFamilyEnum = pgEnum("ticket_family", [
  "write_fact", // ERP-originated PO facts: #1, #6, #7, #8
  "supplier_response", // ack/partial/modification/rejection/exception/ASN: #2–#5, #9, #10, #15
  "chase", // proactive sends: #11, #12, #13
  "triage", // #14 — pipeline unknown until classified
  "delivery_failure", // #16 — bounces / NDR
  "recommendation", // #17 — MRP reschedule and future advisory kinds
]);

export const ticketStepKindEnum = pgEnum("ticket_step_kind", [
  "edit",
  "send",
  "decision",
  "todo",
  "classify", // triage's initial step (§2.6)
]);

export const evidenceTypeEnum = pgEnum("ticket_evidence_type", [
  "email_message",
  "email_attachment",
  "erp_event",
]);

export const ingestionChannelEnum = pgEnum("ingestion_channel", [
  "buyer_cc", // buyer inbox webhook
  "scout_cc", // Scout inbox CC
  "supplier_direct", // supplier reply into a watched inbox
  "erp_api", // authoritative structured channel (§5 dedup winner)
  "scheduled_scan", // watchdog / chase scans (#11–#13, expiry events)
  "ndr", // bounce / auto-reply (#16)
  "csv_drop", // interim MRP CSV (#17)
]);

export const ingestionOutcomeEnum = pgEnum("ingestion_outcome", [
  "ticket_created",
  "attached_as_evidence", // semantic duplicate folded into an existing ticket (§5.2)
  "duplicate_dropped", // exact message-level duplicate (§5.1)
  "suppressed_open_ticket", // job already granted by an open ticket (§5.3)
  "suppressed_dismissed", // same fact previously dismissed by a human (§3, §5)
  "triage_created", // unmatchable fallback (§5.5)
]);

export const poSubscriberSourceEnum = pgEnum("po_subscriber_source", [
  "cc", // CC'd on a PO email (§6)
  "inbox_origin", // ticket originated from their buyer inbox
  "ticket_resolution", // they accepted/closed a ticket on the PO
]);

// ---------------------------------------------------------------------------
// Ticket step payload types (stored in tickets.steps jsonb)
// ---------------------------------------------------------------------------

export type TicketStepKind = "edit" | "send" | "decision" | "todo" | "classify";

/**
 * §4 rule 1: every edit target is bound to the record version it was computed
 * against. Inserts (#1 PO creation, #10 ASN rows) have no existing row: they
 * carry operation "insert", a client-generated rowKey (uuid), version: null,
 * and diffs with from: null. At commit, the re-lock for an insert re-checks
 * natural-key uniqueness (e.g. po_code) instead of a version.
 */
export type TicketRecordBinding = {
  table: string; // e.g. "purchase_orders" | "po_lines" | "supplier_contacts" | "asns"
  rowKey: string; // existing PK for updates; client-generated uuid for inserts
  operation: "insert" | "update";
  version: number | null; // null iff operation === "insert"
};

export type TicketFieldDiff = { field: string; from: unknown; to: unknown }; // from: null on inserts

export type TicketEditTarget = TicketRecordBinding & { diff: TicketFieldDiff[] };

export type TicketStep = {
  id: string;
  kind: TicketStepKind;
  optional?: boolean; // e.g. the send in [edit, send?]
  /** edit / todo-mirror-write: one step may touch the PO header AND multiple lines */
  targets?: TicketEditTarget[];
  /** send: editable draft + bookkeeping marker (e.g. "ack_requested") */
  draft?: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    marker?: string;
  };
  /** todo: external work the human asserts done (§2.1) */
  instruction?: string;
  /** decision: branches; choosing one determines the downstream steps (§2.1) */
  options?: Array<{ key: string; label: string; steps: TicketStep[] }>;
  meta?: Record<string, unknown>;
};

/**
 * Snapshot of what was ACTUALLY accepted (the human may edit diffs, choose
 * branches, and skip optional steps before commit — §2.1). Written once at
 * accept, so §2.3's "no durable mid-flight state" still holds. Closes the loop
 * for the PO timeline without joining audit_log + outbound_log.
 */
export type TicketResolution = {
  decisionPath?: Array<{ stepId: string; chosenOption: string }>;
  skippedStepIds?: string[];
  /** Final step payloads as committed (post human edits). */
  steps?: TicketStep[];
};

// ---------------------------------------------------------------------------
// Procurement SOR
// ---------------------------------------------------------------------------

export const suppliers = pgTable(
  "suppliers",
  {
    orgId: orgIdColumn(),
    supplierCode: text("supplier_code").notNull(),
    supplierAbbr: text("supplier_abbr").notNull(),
    supplierName: text("supplier_name").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.supplierCode] }),
    index("suppliers_org_id_idx").on(table.orgId),
    index("suppliers_org_supplier_code_idx").on(table.orgId, table.supplierCode),
  ],
);

export const parts = pgTable(
  "parts",
  {
    orgId: orgIdColumn(),
    partCode: text("part_code").notNull(),
    partName: text("part_name").notNull(),
    partSpec: text("part_spec"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.partCode] }),
    index("parts_org_id_idx").on(table.orgId),
    index("parts_org_part_code_idx").on(table.orgId, table.partCode),
  ],
);

export const partsSuppliers = pgTable(
  "parts_suppliers",
  {
    orgId: orgIdColumn(),
    partCode: text("part_code").notNull(),
    supplierCode: text("supplier_code").notNull(),
    unitPrice: numeric("unit_price").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.partCode, table.supplierCode] }),
    index("parts_suppliers_org_id_idx").on(table.orgId),
    index("parts_suppliers_org_part_code_idx").on(table.orgId, table.partCode),
    index("parts_suppliers_org_supplier_code_idx").on(table.orgId, table.supplierCode),
    foreignKey({
      columns: [table.orgId, table.partCode],
      foreignColumns: [parts.orgId, parts.partCode],
      name: "parts_suppliers_part_fk",
    }).onUpdate("cascade").onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.supplierCode],
      foreignColumns: [suppliers.orgId, suppliers.supplierCode],
      name: "parts_suppliers_supplier_fk",
    }).onUpdate("cascade").onDelete("cascade"),
  ],
);

export const supplierContacts = pgTable(
  "supplier_contacts",
  {
    contactId: uuid("contact_id").primaryKey(),
    orgId: orgIdColumn(),
    supplierCode: text("supplier_code").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    version: versionColumn(), // ticket-writable via #16 (contact bounce)
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("supplier_contacts_org_id_idx").on(table.orgId),
    index("supplier_contacts_org_supplier_code_idx").on(table.orgId, table.supplierCode),
    foreignKey({
      columns: [table.orgId, table.supplierCode],
      foreignColumns: [suppliers.orgId, suppliers.supplierCode],
      name: "supplier_contacts_supplier_fk",
    }).onUpdate("cascade").onDelete("cascade"),
  ],
);

export const requisitions = pgTable(
  "requisitions",
  {
    reqId: uuid("req_id").primaryKey(),
    orgId: orgIdColumn(),
    reqCode: text("req_code").notNull(),
    needBy: date("need_by").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("requisitions_org_id_idx").on(table.orgId),
    uniqueIndex("requisitions_org_req_id_unique").on(table.orgId, table.reqId),
    uniqueIndex("requisitions_org_req_code_unique").on(table.orgId, table.reqCode),
  ],
);

export const requisitionLines = pgTable(
  "requisition_lines",
  {
    lineId: uuid("line_id").primaryKey(),
    orgId: orgIdColumn(),
    reqId: uuid("req_id").notNull(),
    partCode: text("part_code").notNull(),
    quantity: numeric("quantity").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("requisition_lines_org_id_idx").on(table.orgId),
    index("requisition_lines_org_req_id_idx").on(table.orgId, table.reqId),
    index("requisition_lines_org_part_code_idx").on(table.orgId, table.partCode),
    uniqueIndex("requisition_lines_org_line_id_unique").on(table.orgId, table.lineId),
    foreignKey({
      columns: [table.orgId, table.reqId],
      foreignColumns: [requisitions.orgId, requisitions.reqId],
      name: "requisition_lines_req_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.partCode],
      foreignColumns: [parts.orgId, parts.partCode],
      name: "requisition_lines_part_fk",
    }).onUpdate("cascade").onDelete("cascade"),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    poId: uuid("po_id").primaryKey(),
    orgId: orgIdColumn(),
    poCode: text("po_code").notNull(),
    supplierCode: text("supplier_code").notNull(),
    /** Header status; "partially acknowledged" is derived from lines. */
    status: poStatusEnum("status").default("unacknowledged").notNull(),
    /** Optional context for rejected/cancelled (e.g. supplier's stated reason). */
    statusReason: text("status_reason"),
    /**
     * §6: exactly one accountable owner, always set — ERP buyer code when
     * available, else org_settings.defaultOwnerUserId. Never transfers on
     * ticket resolution.
     */
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id),
    /** #11 chase bookkeeping: "acknowledgement requested at T" marker. */
    ackRequestedAt: timestamp("ack_requested_at", { mode: "date" }),
    version: versionColumn(),
    sentAt: timestamp("sent_at", { mode: "date" }),
    orderDate: date("order_date"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("purchase_orders_org_id_idx").on(table.orgId),
    uniqueIndex("purchase_orders_org_po_id_unique").on(table.orgId, table.poId),
    uniqueIndex("purchase_orders_org_po_code_unique").on(table.orgId, table.poCode),
    index("purchase_orders_org_supplier_code_idx").on(table.orgId, table.supplierCode),
    index("purchase_orders_org_status_idx").on(table.orgId, table.status),
    index("purchase_orders_org_owner_idx").on(table.orgId, table.ownerUserId),
    foreignKey({
      columns: [table.orgId, table.supplierCode],
      foreignColumns: [suppliers.orgId, suppliers.supplierCode],
      name: "purchase_orders_supplier_fk",
    }).onUpdate("cascade").onDelete("cascade"),
  ],
);

export const poLines = pgTable(
  "po_lines",
  {
    lineId: uuid("line_id").primaryKey(),
    orgId: orgIdColumn(),
    poId: uuid("po_id").notNull(),
    /** Nullable: email-parsed POs (#1) arrive with no requisition to link. */
    reqLineId: uuid("req_line_id"),
    quantity: numeric("quantity").notNull(),
    unitPrice: numeric("unit_price").notNull(),
    status: poLineStatusEnum("status").default("unacknowledged").notNull(),
    exceptionReason: text("exception_reason"),
    promisedDate: date("promised_date"),
    /** #12 chase bookkeeping: "ASN requested at T" marker. */
    asnRequestedAt: timestamp("asn_requested_at", { mode: "date" }),
    /** #13 bookkeeping: last weekly lead-time confirmation covering this line. */
    leadtimeConfirmedAt: timestamp("leadtime_confirmed_at", { mode: "date" }),
    version: versionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("po_lines_org_id_idx").on(table.orgId),
    index("po_lines_org_po_id_idx").on(table.orgId, table.poId),
    index("po_lines_org_req_line_id_idx").on(table.orgId, table.reqLineId),
    index("po_lines_org_status_idx").on(table.orgId, table.status),
    /** #12 watchdog scan: lines nearing promise/need-by with incomplete ASN coverage. */
    index("po_lines_org_promised_date_idx").on(table.orgId, table.promisedDate),
    foreignKey({
      columns: [table.orgId, table.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.poId],
      name: "po_lines_po_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.reqLineId],
      foreignColumns: [requisitionLines.orgId, requisitionLines.lineId],
      name: "po_lines_req_line_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * v2: multiple ASNs per line (partial shipments, #10) with quantityShipped;
 * line-level shipped quantity is derived by summing ASNs (#12's
 * "ASN-covered quantity < ordered quantity").
 */
export const asns = pgTable(
  "asns",
  {
    asnId: uuid("asn_id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    lineId: uuid("line_id")
      .notNull()
      .references(() => poLines.lineId, { onDelete: "cascade" }),
    quantityShipped: numeric("quantity_shipped").notNull(),
    dateShipped: date("date_shipped").notNull(),
    expectedDeliveryDate: date("expected_delivery_date"),
    trackingNumber: text("tracking_number"),
    carrier: text("carrier").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("asns_org_id_idx").on(table.orgId),
    index("asns_org_line_id_idx").on(table.orgId, table.lineId),
  ],
);

/** §6: grow-only (v1) subscriber list per PO — who is kept informed. */
export const poSubscribers = pgTable(
  "po_subscribers",
  {
    orgId: orgIdColumn(),
    poId: uuid("po_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: poSubscriberSourceEnum("source").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.poId, table.userId] }),
    index("po_subscribers_org_user_idx").on(table.orgId, table.userId),
    foreignKey({
      columns: [table.orgId, table.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.poId],
      name: "po_subscribers_po_fk",
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// Ticket model
// ---------------------------------------------------------------------------

/**
 * Org-extensible ticket-kind registry. Seeded with system defaults per org;
 * orgs may add rows without any source-level change.
 *
 * Split of concerns:
 *  - `family` + policy columns: machine-facing, what system code branches on
 *    (suppression, serialization, dedup). Structured, never prose-driven.
 *  - `definition`: skill.md-style body the agent reads to recognize the event
 *    and compute the pipeline. Free-form, safely editable per org.
 */
export const ticketKinds = pgTable(
  "ticket_kinds",
  {
    orgId: orgIdColumn(),
    /** Stable identifier referenced by tickets.kindKey, e.g. "po_creation", "ack_chase". */
    key: text("key").notNull(),
    family: ticketFamilyEnum("family").notNull(),
    title: text("title").notNull(),
    /** Default for tickets.hasWrites (snapshotted at ticket creation). */
    isWriteBearing: boolean("is_write_bearing").default(true).notNull(),
    /**
     * §5.3 open-ticket suppression: window within which a "requested" marker
     * (plus any open ticket of this kind) suppresses re-raising. Null = no
     * time-window suppression (open-ticket check still applies).
     */
    suppressionWindowHours: integer("suppression_window_hours"),
    /**
     * §4 rule 4 exemption for bookkeeping-only write kinds (e.g. the #13
     * "on-track" log, which stamps leadtimeConfirmedAt across many POs and
     * must not force supersede churn). Exempt kinds skip ticket_write_pos
     * rows; correctness is still guarded by version re-check at commit.
     */
    serializationExempt: boolean("serialization_exempt").default(false).notNull(),
    /** Seeded default vs. org-authored. */
    isSystem: boolean("is_system").default(false).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    /** skill.md-style instructions for the agent (recognition, pipeline, drafting). */
    definition: text("definition").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.key] }),
    index("ticket_kinds_org_family_idx").on(table.orgId, table.family),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    ticketId: uuid("ticket_id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    kindKey: text("kind_key").notNull(),
    title: text("title").notNull(),
    status: ticketStatusEnum("status").default("draft").notNull(),
    /**
     * Snapshot of the kind's isWriteBearing at creation — a later policy edit
     * must not retroactively change an open ticket's serialization behavior.
     * Drives the one-open-write-per-PO partial unique index (§4 rule 4).
     */
    hasWrites: boolean("has_writes").notNull(),
    /**
     * One ticket per (PO, intent) (§5.4). Nullable: triage (#14, no PO yet),
     * weekly lead-time (#13, per supplier), multi-PO bounce (#16 — primary PO
     * here, others via evidence/steps).
     */
    poId: uuid("po_id"),
    supplierCode: text("supplier_code"),
    /**
     * Agent-computed proposed pipeline (§2), including edit diffs bound to
     * record versions (§4 rule 1), editable drafts, decision branches, todos.
     * Recomputed on supersession/abandonment. On accept, the committed effects
     * are traceable via audit_log.ticketId and outbound_log.ticketId.
     */
    steps: jsonb("steps").$type<TicketStep[]>().default([]).notNull(),
    /** Why the agent raised this ticket (evidence summary / trigger). */
    creationReason: text("creation_reason").notNull(),
    /** Null = created by the agent (the normal case, §1). */
    createdByUserId: text("created_by_user_id").references(() => user.id),
    /** Human who accepted or dismissed the ticket. */
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
    /** Required when status = closed. */
    closedKind: ticketClosedKindEnum("closed_kind"),
    /**
     * Human-readable variation, e.g. "superseded by PO-1042 line cancellation",
     * "dismissed: off-topic newsletter". The structured fields are what code
     * branches on; this string is for the timeline.
     */
    closedReason: text("closed_reason"),
    /** superseded → successor ticket; withdrawn → dominating ticket. */
    closedRefTicketId: uuid("closed_ref_ticket_id").references(
      (): AnyPgColumn => tickets.ticketId,
      { onDelete: "set null" },
    ),
    /** Accepted-outcome snapshot (see TicketResolution). Set iff accepted. */
    resolution: jsonb("resolution").$type<TicketResolution>(),
    /**
     * §4 expiry watchdog: deadline this ticket depends on (need-by date,
     * offer validity). Null = not time-bound. The scheduled scan queries this
     * instead of digging through steps.meta.
     */
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("tickets_org_status_idx").on(table.orgId, table.status),
    index("tickets_org_po_idx").on(table.orgId, table.poId),
    /** Suppression query: open ticket of kind X for PO Y? (§5.3) */
    index("tickets_org_kind_status_idx").on(table.orgId, table.kindKey, table.status),
    index("tickets_org_supplier_idx").on(table.orgId, table.supplierCode),
    index("tickets_closed_ref_idx").on(table.closedRefTicketId),
    /** Watchdog scan: open, time-bound tickets past their deadline. */
    index("tickets_org_expires_at_idx").on(table.orgId, table.expiresAt),
    /** §3 contract, enforced structurally (review point D). */
    check("tickets_closed_kind_iff_closed", sql`(${table.status} = 'closed') = (${table.closedKind} IS NOT NULL)`),
    check("tickets_closed_reason_only_when_closed", sql`${table.status} = 'closed' OR ${table.closedReason} IS NULL`),
    foreignKey({
      columns: [table.orgId, table.kindKey],
      foreignColumns: [ticketKinds.orgId, ticketKinds.key],
      name: "tickets_kind_fk",
    }).onUpdate("cascade"),
    foreignKey({
      columns: [table.orgId, table.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.poId],
      name: "tickets_po_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.supplierCode],
      foreignColumns: [suppliers.orgId, suppliers.supplierCode],
      name: "tickets_supplier_fk",
    }).onUpdate("cascade"),
  ],
);

/**
 * §4 rule 4, closed multi-PO hole (review point B): one row per PO a
 * write-bearing, non-exempt ticket touches (single-PO tickets get one row;
 * a multi-PO #16 bounce fix gets several). The partial unique index enforces
 * "at most one open write-bearing ticket per PO" across ALL shapes.
 *
 * Maintenance contract: rows are inserted when the ticket opens; isOpen is
 * set false in the same transaction that resolves the ticket. Supersession
 * must close the original's rows BEFORE inserting the successor's (the index
 * is non-deferrable).
 */
export const ticketWritePos = pgTable(
  "ticket_write_pos",
  {
    orgId: orgIdColumn(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.ticketId, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull(),
    isOpen: boolean("is_open").default(true).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.poId] }),
    index("ticket_write_pos_org_po_idx").on(table.orgId, table.poId),
    uniqueIndex("ticket_write_pos_one_open_per_po_unique")
      .on(table.orgId, table.poId)
      .where(sql`${table.isOpen} = true`),
    foreignKey({
      columns: [table.orgId, table.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.poId],
      name: "ticket_write_pos_po_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * Ticket ↔ evidence, many-to-many (§5): one email fans out to several tickets;
 * semantic duplicates attach to one ticket. The PO evidence timeline is derived
 * through tickets (ticket.poId → evidence).
 */
export const ticketEvidence = pgTable(
  "ticket_evidence",
  {
    evidenceId: uuid("evidence_id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.ticketId, { onDelete: "cascade" }),
    type: evidenceTypeEnum("type").notNull(),
    emailMessageId: uuid("email_message_id").references(() => emailMessages.id, {
      onDelete: "set null",
    }),
    attachmentExtractionId: uuid("attachment_extraction_id").references(
      () => emailAttachmentExtractions.id,
      { onDelete: "set null" },
    ),
    /** ERP-API event payload/reference when the evidence is not an email. */
    erpPayload: jsonb("erp_payload").$type<Record<string, unknown>>(),
    note: text("note"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("ticket_evidence_ticket_idx").on(table.ticketId),
    index("ticket_evidence_email_message_idx").on(table.emailMessageId),
    uniqueIndex("ticket_evidence_ticket_message_unique").on(table.ticketId, table.emailMessageId),
    uniqueIndex("ticket_evidence_ticket_attachment_unique").on(
      table.ticketId,
      table.attachmentExtractionId,
    ),
  ],
);

/**
 * §5 ingestion ledger: every inbound event ends as a ticket, a dedup drop, or
 * a triage ticket — nothing silently discarded. Also the memory behind
 * semantic dedup and dismissed-suppression.
 */
export const ingestionEvents = pgTable(
  "ingestion_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    channel: ingestionChannelEnum("channel").notNull(),
    /** Provider message-id / ERP event id (raw idempotency also in processed_messages). */
    providerEventId: text("provider_event_id"),
    /** Hash of (PO, event type, content) — §5.2 semantic dedup across channels. */
    semanticHash: text("semantic_hash").notNull(),
    poId: uuid("po_id"),
    outcome: ingestionOutcomeEnum("outcome").notNull(),
    /** The ticket created, or the existing ticket the event was folded into / suppressed by. */
    ticketId: uuid("ticket_id").references(() => tickets.ticketId, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("ingestion_events_org_hash_idx").on(table.orgId, table.semanticHash, table.createdAt),
    index("ingestion_events_org_provider_idx").on(table.orgId, table.providerEventId),
    index("ingestion_events_ticket_idx").on(table.ticketId),
  ],
);

// ---------------------------------------------------------------------------
// Org settings (default owner fallback, §6)
// ---------------------------------------------------------------------------

export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** §6: fallback PO owner so a PO is never ownerless. */
  defaultOwnerUserId: text("default_owner_user_id")
    .notNull()
    .references(() => user.id),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

// ---------------------------------------------------------------------------
// Audit & outbound (ticket-granted writes and sends)
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    auditId: uuid("audit_id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    userId: text("user_id").notNull(),
    /**
     * §1 invariant: every SOR write is granted by exactly one ticket.
     * Null only for adapter-layer syncs (receipts, vendor bills, write-back),
     * which bypass tickets by design (§7 footnote).
     */
    ticketId: uuid("ticket_id").references(() => tickets.ticketId, { onDelete: "set null" }),
    tableName: text("table_name").notNull(),
    rowKey: text("row_key").notNull(),
    operation: text("operation").notNull(),
    changes: jsonb("changes"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("audit_log_org_id_idx").on(table.orgId),
    index("audit_log_org_table_idx").on(table.orgId, table.tableName),
    index("audit_log_org_row_idx").on(table.orgId, table.tableName, table.rowKey),
    index("audit_log_created_at_idx").on(table.orgId, table.createdAt),
    index("audit_log_ticket_idx").on(table.ticketId),
  ],
);

export const outboundLog = pgTable(
  "outbound_log",
  {
    id: uuid("id").primaryKey(),
    threadKey: text("thread_key").references(() => threads.threadKey, { onDelete: "cascade" }),
    /** §2.2: sends are ordered after a ticket's diffs — link them to the grant. */
    ticketId: uuid("ticket_id").references(() => tickets.ticketId, { onDelete: "set null" }),
    runId: text("run_id"),
    kind: text("kind"),
    sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("outbound_log_ticket_idx").on(table.ticketId)],
);

// ---------------------------------------------------------------------------
// Legacy / infrastructure tables (unchanged from v1)
// ---------------------------------------------------------------------------

export const threads = pgTable(
  "threads",
  {
    threadKey: text("thread_key").primaryKey(),
    orgId: orgIdColumn(),
    runId: text("run_id"),
    workflowId: text("workflow_id"),
    status: text("status"),
    ownerEmail: text("owner_email"),
    subject: text("subject"),
    lastMessageId: text("last_message_id"),
    threadType: text("thread_type"),
    suspendedStep: text("suspended_step"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("threads_org_id_idx").on(table.orgId)],
);

/** Raw message-id idempotency guard (§5.1); semantic dedup lives in ingestion_events. */
export const processedMessages = pgTable(
  "processed_messages",
  {
    messageId: text("message_id").primaryKey(),
    processedAt: timestamp("processed_at", { mode: "date" }).defaultNow().notNull(),
  },
);

export const poDispatches = pgTable(
  "po_dispatches",
  {
    poDispatchId: uuid("po_dispatch_id").primaryKey(),
    orgId: orgIdColumn(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.poId, { onDelete: "cascade" }),
    supplierEmail: text("supplier_email").notNull(),
    recipientEmails: jsonb("recipient_emails").$type<string[]>(),
    senderEmail: text("sender_email"),
    threadKey: text("thread_key").notNull(),
    messageId: text("message_id"),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    transport: text("transport"),
    sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("po_dispatches_org_id_idx").on(table.orgId),
    index("po_dispatches_po_id_idx").on(table.poId),
    index("po_dispatches_org_message_id_idx").on(table.orgId, table.messageId),
    index("po_dispatches_org_thread_key_idx").on(table.orgId, table.threadKey),
  ],
);

// ---------------------------------------------------------------------------
// Email ingestion (unchanged from v1)
// ---------------------------------------------------------------------------

export const inboxes = pgTable(
  "inboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    grantId: text("grant_id").notNull(),
    provider: text("provider").notNull(), // "google" | "microsoft"
    email: text("email").notNull(),
    name: text("name"),
    status: text("status").notNull().default("connected"),
    syncStatus: text("sync_status").notNull().default("idle"),
    nextCursor: text("next_cursor"),
    backfillStartedAt: timestamp("backfill_started_at", { mode: "date" }),
    backfillCompletedAt: timestamp("backfill_completed_at", { mode: "date" }),
    lastSyncError: text("last_sync_error"),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("inboxes_user_id_idx").on(table.userId),
    index("inboxes_organization_id_idx").on(table.organizationId),
    index("inboxes_organization_id_user_id_idx").on(table.organizationId, table.userId),
    uniqueIndex("inboxes_grant_id_unique").on(table.grantId),
  ],
);

export const nylasWebhookEvents = pgTable(
  "nylas_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nylasEventId: text("nylas_event_id").notNull(),
    eventType: text("event_type").notNull(),
    grantId: text("grant_id"),
    objectId: text("object_id"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: text("claim_token"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("nylas_webhook_events_event_id_unique").on(table.nylasEventId),
    index("nylas_webhook_events_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    index("nylas_webhook_events_grant_id_idx").on(table.grantId),
  ],
);

export const inboxEmails = pgTable(
  "inbox_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    nylasMessageId: text("nylas_message_id").notNull(),
    threadId: text("thread_id"),
    subject: text("subject"),
    fromAddress: text("from_address"),
    toAddresses: jsonb("to_addresses"),
    bodyHtml: text("body_html"),
    receivedAt: timestamp("received_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("inbox_emails_inbox_nylas_msg_unique").on(table.inboxId, table.nylasMessageId),
    index("inbox_emails_inbox_id_received_at_idx").on(table.inboxId, table.receivedAt.desc()),
  ],
);

type EmailAddress = {
  name?: string;
  email?: string;
};

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("nylas"),
    providerThreadId: text("provider_thread_id").notNull(),
    subject: text("subject"),
    participants: jsonb("participants").$type<EmailAddress[]>().default([]).notNull(),
    messageCount: integer("message_count").notNull().default(0),
    earliestMessageAt: timestamp("earliest_message_at", { mode: "date" }),
    latestMessageAt: timestamp("latest_message_at", { mode: "date" }),
    latestSnippet: text("latest_snippet"),
    classificationStatus: text("classification_status").notNull().default("unclassified"),
    processingStatus: text("processing_status").notNull().default("idle"),
    threadKind: text("thread_kind"),
    isBackfill: boolean("is_backfill").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { mode: "date" }).defaultNow().notNull(),
    lastError: text("last_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("email_threads_inbox_provider_thread_unique").on(table.inboxId, table.providerThreadId),
    index("email_threads_org_latest_idx").on(table.orgId, table.latestMessageAt.desc()),
    index("email_threads_org_classification_idx").on(table.orgId, table.classificationStatus),
    index("email_threads_org_processing_idx").on(table.orgId, table.processingStatus),
  ],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    providerThreadId: text("provider_thread_id").notNull(),
    messageIdHeader: text("message_id_header"),
    subject: text("subject"),
    snippet: text("snippet"),
    from: jsonb("from").$type<EmailAddress[]>().default([]).notNull(),
    to: jsonb("to").$type<EmailAddress[]>().default([]).notNull(),
    cc: jsonb("cc").$type<EmailAddress[]>().default([]).notNull(),
    bcc: jsonb("bcc").$type<EmailAddress[]>().default([]).notNull(),
    replyTo: jsonb("reply_to").$type<EmailAddress[]>().default([]).notNull(),
    folderIds: jsonb("folder_ids").$type<string[]>().default([]).notNull(),
    attachments: jsonb("attachments").$type<Array<Record<string, unknown>>>().default([]).notNull(),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    selectedPayload: jsonb("selected_payload").$type<Record<string, unknown>>().default({}).notNull(),
    receivedAt: timestamp("received_at", { mode: "date" }),
    source: text("source").notNull(),
    direction: text("direction").notNull().default("unknown"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("email_messages_inbox_provider_message_unique").on(table.inboxId, table.providerMessageId),
    index("email_messages_thread_id_idx").on(table.threadId),
    index("email_messages_org_received_at_idx").on(table.orgId, table.receivedAt.desc()),
    index("email_messages_org_message_id_header_idx").on(table.orgId, table.messageIdHeader),
  ],
);

export const emailAttachmentExtractions = pgTable(
  "email_attachment_extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => emailMessages.id, { onDelete: "cascade" }),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    providerAttachmentId: text("provider_attachment_id").notNull(),
    filename: text("filename"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    isInline: boolean("is_inline").notNull().default(false),
    status: text("status").notNull().default("pending"),
    extractionStrategy: text("extraction_strategy"),
    extractedMarkdown: text("extracted_markdown"),
    extractionPayload: jsonb("extraction_payload").$type<Record<string, unknown>>(),
    extractionError: text("extraction_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("email_attachment_extractions_message_attachment_unique").on(
      table.messageId,
      table.providerAttachmentId,
    ),
    index("email_attachment_extractions_message_id_idx").on(table.messageId),
    index("email_attachment_extractions_org_status_idx").on(table.orgId, table.status),
    index("email_attachment_extractions_provider_message_idx").on(
      table.inboxId,
      table.providerMessageId,
    ),
  ],
);

export const emailDiscoveryJobs = pgTable(
  "email_discovery_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("pending"),
    cursorStart: text("cursor_start"),
    cursorEnd: text("cursor_end"),
    pagesProcessed: integer("pages_processed").notNull().default(0),
    messagesUpserted: integer("messages_upserted").notNull().default(0),
    threadsTouched: integer("threads_touched").notNull().default(0),
    pagesRemaining: integer("pages_remaining"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: text("claim_token"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("email_discovery_jobs_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    index("email_discovery_jobs_inbox_id_idx").on(table.inboxId),
  ],
);

export const emailThreadJobs = pgTable(
  "email_thread_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: text("claim_token"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { mode: "date" }),
    classificationKind: text("classification_kind"),
    classificationConfidence: doublePrecision("classification_confidence"),
    classificationReason: text("classification_reason"),
    classificationStrategy: text("classification_strategy"),
    procurementStatus: text("procurement_status"),
    procurementPoCode: text("procurement_po_code"),
    procurementWarnings: jsonb("procurement_warnings").$type<string[]>().default([]).notNull(),
    classificationResult: jsonb("classification_result").$type<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("email_thread_jobs_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    index("email_thread_jobs_thread_id_job_type_idx").on(table.threadId, table.jobType),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("notifications_org_read_created_idx").on(table.orgId, table.isRead, table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Auth / tenancy (unchanged from v1)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    activeTeamId: text("active_team_id"),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: "date" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const orgResource = pgTable("org_resource", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  status: text("status").notNull().default("provisioning"),
  data: jsonb("data").notNull().default({}),
  error: text("error"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("org_resource_org_id_idx").on(table.organizationId),
  index("org_resource_type_idx").on(table.resourceType),
]);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    teamId: text("team_id"),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const buyerOnboarding = pgTable(
  "buyer_onboarding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invitationId: text("invitation_id").references(() => invitation.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    status: text("status").notNull().default("invited"),
    currentStep: text("current_step").notNull().default("account"),
    accountReadyAt: timestamp("account_ready_at", { mode: "date" }),
    invitationAcceptedAt: timestamp("invitation_accepted_at", { mode: "date" }),
    emailConnectedAt: timestamp("email_connected_at", { mode: "date" }),
    completedAt: timestamp("completed_at", { mode: "date" }),
    lastError: text("last_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("buyer_onboarding_user_org_idx").on(table.userId, table.organizationId),
    uniqueIndex("buyer_onboarding_invitation_id_unique").on(table.invitationId),
    index("buyer_onboarding_org_email_idx").on(table.organizationId, table.email),
  ],
);

export const nylasOAuthStates = pgTable(
  "nylas_oauth_states",
  {
    state: text("state").primaryKey(),
    codeVerifier: text("code_verifier").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    purpose: text("purpose").notNull().default("onboarding"),
    redirectPath: text("redirect_path").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { mode: "date" }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("nylas_oauth_states_expires_at_idx").on(table.expiresAt),
    index("nylas_oauth_states_user_org_idx").on(table.userId, table.organizationId),
  ],
);

export const apikey = pgTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    start: text("start"),
    enabled: boolean("enabled").default(true).notNull(),
    metadata: text("metadata"),
    remaining: integer("remaining"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    configId: text("config_id"),
    referenceId: text("reference_id"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    hash: text("hash"),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { mode: "date" }),
    requestCount: integer("request_count").default(0),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    lastRequest: timestamp("last_request", { mode: "date" }),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitMax: integer("rate_limit_max"),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitRefillInterval: integer("rate_limit_refill_interval"),
    rateLimitRefillAmount: integer("rate_limit_refill_amount"),
    permissions: text("permissions"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("apikey_userId_idx").on(table.userId),
    index("apikey_organizationId_idx").on(table.organizationId),
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    uniqueIndex("apikey_key_unique").on(table.key),
    uniqueIndex("apikey_hash_unique").on(table.hash),
  ],
);

export const ssoProvider = pgTable("sso_provider", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  domain: text("domain").notNull(),
  oidcConfig: text("oidc_config"),
  samlConfig: text("saml_config"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull().unique(),
  organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitationsSent: many(invitation, { relationName: "inviter" }),
  buyerOnboardings: many(buyerOnboarding),
  nylasOAuthStates: many(nylasOAuthStates),
  inboxes: many(inboxes),
  ticketsCreated: many(tickets, { relationName: "ticketCreator" }),
  ticketsResolved: many(tickets, { relationName: "ticketResolver" }),
  ownedPurchaseOrders: many(purchaseOrders),
  poSubscriptions: many(poSubscribers),
  ssoProviders: many(ssoProvider),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ one, many }) => ({
  settings: one(orgSettings),
  members: many(member),
  invitations: many(invitation),
  buyerOnboardings: many(buyerOnboarding),
  nylasOAuthStates: many(nylasOAuthStates),
  inboxes: many(inboxes),
  emailThreads: many(emailThreads),
  emailMessages: many(emailMessages),
  emailDiscoveryJobs: many(emailDiscoveryJobs),
  emailThreadJobs: many(emailThreadJobs),
  ticketKinds: many(ticketKinds),
  tickets: many(tickets),
  ingestionEvents: many(ingestionEvents),
  ssoProviders: many(ssoProvider),
}));

export const orgSettingsRelations = relations(orgSettings, ({ one }) => ({
  organization: one(organization, {
    fields: [orgSettings.orgId],
    references: [organization.id],
  }),
  defaultOwner: one(user, {
    fields: [orgSettings.defaultOwnerUserId],
    references: [user.id],
  }),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const orgResourceRelations = relations(orgResource, ({ one }) => ({
  organization: one(organization, {
    fields: [orgResource.organizationId],
    references: [organization.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
    relationName: "inviter",
  }),
}));

export const buyerOnboardingRelations = relations(buyerOnboarding, ({ one }) => ({
  user: one(user, {
    fields: [buyerOnboarding.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [buyerOnboarding.organizationId],
    references: [organization.id],
  }),
  invitation: one(invitation, {
    fields: [buyerOnboarding.invitationId],
    references: [invitation.id],
  }),
}));

export const nylasOAuthStatesRelations = relations(nylasOAuthStates, ({ one }) => ({
  user: one(user, {
    fields: [nylasOAuthStates.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [nylasOAuthStates.organizationId],
    references: [organization.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  contacts: many(supplierContacts),
  pricing: many(partsSuppliers),
  purchaseOrders: many(purchaseOrders),
  tickets: many(tickets),
}));

export const partsRelations = relations(parts, ({ many }) => ({
  pricing: many(partsSuppliers),
  requisitionLines: many(requisitionLines),
}));

export const partsSuppliersRelations = relations(partsSuppliers, ({ one }) => ({
  part: one(parts, {
    fields: [partsSuppliers.orgId, partsSuppliers.partCode],
    references: [parts.orgId, parts.partCode],
  }),
  supplier: one(suppliers, {
    fields: [partsSuppliers.orgId, partsSuppliers.supplierCode],
    references: [suppliers.orgId, suppliers.supplierCode],
  }),
}));

export const supplierContactsRelations = relations(supplierContacts, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierContacts.orgId, supplierContacts.supplierCode],
    references: [suppliers.orgId, suppliers.supplierCode],
  }),
}));

export const requisitionsRelations = relations(requisitions, ({ many }) => ({
  lines: many(requisitionLines),
}));

export const requisitionLinesRelations = relations(requisitionLines, ({ one, many }) => ({
  requisition: one(requisitions, {
    fields: [requisitionLines.orgId, requisitionLines.reqId],
    references: [requisitions.orgId, requisitions.reqId],
  }),
  part: one(parts, {
    fields: [requisitionLines.orgId, requisitionLines.partCode],
    references: [parts.orgId, parts.partCode],
  }),
  poLines: many(poLines),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchaseOrders.orgId, purchaseOrders.supplierCode],
    references: [suppliers.orgId, suppliers.supplierCode],
  }),
  owner: one(user, {
    fields: [purchaseOrders.ownerUserId],
    references: [user.id],
  }),
  lines: many(poLines),
  subscribers: many(poSubscribers),
  tickets: many(tickets),
  ticketWritePos: many(ticketWritePos),
  dispatches: many(poDispatches),
}));

export const poLinesRelations = relations(poLines, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [poLines.orgId, poLines.poId],
    references: [purchaseOrders.orgId, purchaseOrders.poId],
  }),
  requisitionLine: one(requisitionLines, {
    fields: [poLines.orgId, poLines.reqLineId],
    references: [requisitionLines.orgId, requisitionLines.lineId],
  }),
  asns: many(asns),
}));

export const asnsRelations = relations(asns, ({ one }) => ({
  poLine: one(poLines, {
    fields: [asns.lineId],
    references: [poLines.lineId],
  }),
}));

export const poSubscribersRelations = relations(poSubscribers, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [poSubscribers.orgId, poSubscribers.poId],
    references: [purchaseOrders.orgId, purchaseOrders.poId],
  }),
  user: one(user, {
    fields: [poSubscribers.userId],
    references: [user.id],
  }),
}));

export const ticketKindsRelations = relations(ticketKinds, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ticketKinds.orgId],
    references: [organization.id],
  }),
  tickets: many(tickets),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  organization: one(organization, {
    fields: [tickets.orgId],
    references: [organization.id],
  }),
  kind: one(ticketKinds, {
    fields: [tickets.orgId, tickets.kindKey],
    references: [ticketKinds.orgId, ticketKinds.key],
  }),
  purchaseOrder: one(purchaseOrders, {
    fields: [tickets.orgId, tickets.poId],
    references: [purchaseOrders.orgId, purchaseOrders.poId],
  }),
  supplier: one(suppliers, {
    fields: [tickets.orgId, tickets.supplierCode],
    references: [suppliers.orgId, suppliers.supplierCode],
  }),
  creator: one(user, {
    fields: [tickets.createdByUserId],
    references: [user.id],
    relationName: "ticketCreator",
  }),
  resolver: one(user, {
    fields: [tickets.resolvedByUserId],
    references: [user.id],
    relationName: "ticketResolver",
  }),
  /** superseded → successor; withdrawn → dominating ticket. */
  closedRef: one(tickets, {
    fields: [tickets.closedRefTicketId],
    references: [tickets.ticketId],
    relationName: "ticketClosedRef",
  }),
  closedRefOf: many(tickets, { relationName: "ticketClosedRef" }),
  writePos: many(ticketWritePos),
  evidence: many(ticketEvidence),
  ingestionEvents: many(ingestionEvents),
  auditEntries: many(auditLog),
  outboundEntries: many(outboundLog),
}));

export const ticketWritePosRelations = relations(ticketWritePos, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketWritePos.ticketId],
    references: [tickets.ticketId],
  }),
  purchaseOrder: one(purchaseOrders, {
    fields: [ticketWritePos.orgId, ticketWritePos.poId],
    references: [purchaseOrders.orgId, purchaseOrders.poId],
  }),
}));

export const ticketEvidenceRelations = relations(ticketEvidence, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketEvidence.ticketId],
    references: [tickets.ticketId],
  }),
  emailMessage: one(emailMessages, {
    fields: [ticketEvidence.emailMessageId],
    references: [emailMessages.id],
  }),
  attachmentExtraction: one(emailAttachmentExtractions, {
    fields: [ticketEvidence.attachmentExtractionId],
    references: [emailAttachmentExtractions.id],
  }),
}));

export const ingestionEventsRelations = relations(ingestionEvents, ({ one }) => ({
  organization: one(organization, {
    fields: [ingestionEvents.orgId],
    references: [organization.id],
  }),
  ticket: one(tickets, {
    fields: [ingestionEvents.ticketId],
    references: [tickets.ticketId],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  ticket: one(tickets, {
    fields: [auditLog.ticketId],
    references: [tickets.ticketId],
  }),
}));

export const outboundLogRelations = relations(outboundLog, ({ one }) => ({
  ticket: one(tickets, {
    fields: [outboundLog.ticketId],
    references: [tickets.ticketId],
  }),
}));

export const inboxesRelations = relations(inboxes, ({ one, many }) => ({
  user: one(user, {
    fields: [inboxes.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [inboxes.organizationId],
    references: [organization.id],
  }),
  emails: many(inboxEmails),
  threads: many(emailThreads),
  messages: many(emailMessages),
  attachmentExtractions: many(emailAttachmentExtractions),
  discoveryJobs: many(emailDiscoveryJobs),
}));

export const inboxEmailsRelations = relations(inboxEmails, ({ one }) => ({
  inbox: one(inboxes, {
    fields: [inboxEmails.inboxId],
    references: [inboxes.id],
  }),
}));

export const emailThreadsRelations = relations(emailThreads, ({ one, many }) => ({
  organization: one(organization, {
    fields: [emailThreads.orgId],
    references: [organization.id],
  }),
  inbox: one(inboxes, {
    fields: [emailThreads.inboxId],
    references: [inboxes.id],
  }),
  messages: many(emailMessages),
  jobs: many(emailThreadJobs),
}));

export const emailMessagesRelations = relations(emailMessages, ({ one, many }) => ({
  organization: one(organization, {
    fields: [emailMessages.orgId],
    references: [organization.id],
  }),
  inbox: one(inboxes, {
    fields: [emailMessages.inboxId],
    references: [inboxes.id],
  }),
  thread: one(emailThreads, {
    fields: [emailMessages.threadId],
    references: [emailThreads.id],
  }),
  attachmentExtractions: many(emailAttachmentExtractions),
  ticketEvidence: many(ticketEvidence),
}));

export const emailAttachmentExtractionsRelations = relations(emailAttachmentExtractions, ({ one, many }) => ({
  organization: one(organization, {
    fields: [emailAttachmentExtractions.orgId],
    references: [organization.id],
  }),
  inbox: one(inboxes, {
    fields: [emailAttachmentExtractions.inboxId],
    references: [inboxes.id],
  }),
  message: one(emailMessages, {
    fields: [emailAttachmentExtractions.messageId],
    references: [emailMessages.id],
  }),
  ticketEvidence: many(ticketEvidence),
}));

export const emailDiscoveryJobsRelations = relations(emailDiscoveryJobs, ({ one }) => ({
  organization: one(organization, {
    fields: [emailDiscoveryJobs.orgId],
    references: [organization.id],
  }),
  inbox: one(inboxes, {
    fields: [emailDiscoveryJobs.inboxId],
    references: [inboxes.id],
  }),
}));

export const emailThreadJobsRelations = relations(emailThreadJobs, ({ one }) => ({
  organization: one(organization, {
    fields: [emailThreadJobs.orgId],
    references: [organization.id],
  }),
  thread: one(emailThreads, {
    fields: [emailThreadJobs.threadId],
    references: [emailThreads.id],
  }),
}));

export const ssoProviderRelations = relations(ssoProvider, ({ one }) => ({
  user: one(user, {
    fields: [ssoProvider.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [ssoProvider.organizationId],
    references: [organization.id],
  }),
}));
