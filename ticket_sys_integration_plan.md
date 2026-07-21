# Ticket System Integration Plan (schema-v2)

## Context

The current mobile app has a simple ticket CRUD system (description + pending/approved/rejected status). We need to upgrade to the full Scout ticket model per `schema-v2.ts` and the Scout Ticket System spec, supporting the first 5 ticket scenarios (#1–#5) with a step-walker UI. This transforms tickets from simple todo items into structured procurement pipelines.

## Key Design Decisions

1. **kindKey** is the column on `tickets` that references `ticket_kinds.key`. The first 5 scenarios map to kindKeys: `po_creation`, `full_acknowledgement`, `partial_acknowledgement`, `pre_ack_modification`, `whole_po_rejection`.
2. **All tables from schema-v2.ts will be created** in the DB (user's requirement), even if some aren't used by the mobile UI yet.
3. **Ticket detail page becomes a step walker** — rendering `tickets.steps` jsonb as interactive Edit/Send/Decision/Todo steps.
4. **No "reject" button** — fact tickets (#1) can only be accepted; supplier-response tickets (#4, #5) use decision branches (Agree/Push back or Accept/Push back).
5. **Commit is the single mutation** — all step edits live in React state, one commit call at the end.

---

## 1. Database Layer (`packages/db`)

### 1.1 Replace `packages/db/src/schema.ts`

**Current state:** Simple `tickets` table (id, orgId, description, status, createdBy, createdAt, updatedAt) + `pushTokens` + auth mirror tables.

**Target state:** Full schema-v2.ts. Changes:

- **Add enums**: `po_status`, `po_line_status`, `ticket_status`, `ticket_closed_kind`, `ticket_family`, `ticket_step_kind`, `ticket_evidence_type`, `ingestion_channel`, `ingestion_outcome`, `po_subscriber_source`
- **Replace `tickets` table** with the v2 version (ticketId, kindKey, title, status enum, steps jsonb, creationReason, hasWrites, poId, supplierCode, createdByUserId, resolvedByUserId, resolvedAt, closedKind, closedReason, closedRefTicketId, resolution jsonb, expiresAt)
- **Add SOR tables**: `suppliers`, `parts`, `parts_suppliers`, `supplier_contacts`, `requisitions`, `requisition_lines`, `purchase_orders`, `po_lines`, `asns`, `po_subscribers`, `org_settings`
- **Add ticket infrastructure**: `ticket_kinds`, `ticket_write_pos`, `ticket_evidence`, `ingestion_events`
- **Add email tables**: `inboxes`, `email_threads`, `email_messages`, `email_attachment_extractions`, `nylas_webhook_events`, `inbox_emails`, `email_discovery_jobs`, `email_thread_jobs`
- **Add logging**: `audit_log`, `outbound_log`, `notifications`
- **Add legacy/support**: `threads`, `processed_messages`, `po_dispatches`, `buyer_onboarding`, `nylas_oauth_states`, `apikey`, `sso_provider`, `org_resource`
- **Update auth tables** to match v2 (add `firstName`, `lastName`, `role`, `banned` etc. to `user`; add `activeTeamId`, `impersonatedBy` to `session`)
- **Add all Drizzle relations** for the new tables
- **Keep `pushTokens`** (not in schema-v2 but needed for mobile)

### 1.2 Update `packages/db/src/index.ts`

- Add re-exports for all new tables and enums
- Ensure `pushTokens` is still exported

### 1.3 Database migration

- Since `drizzle-kit push` needs TTY, use raw SQL migration or the existing pattern
- Enums must be created before tables that reference them
- Auth tables already exist → add columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- New tables can be `CREATE TABLE IF NOT EXISTS`
- **Seed `ticket_kinds`** with the first 5 system kinds for the active org

---

## 2. Shared Types (`packages/shared`)

### 2.1 Replace `packages/shared/src/index.ts`

Export all types needed by the mobile app:

```typescript
// Ticket types
export interface Ticket { ... }  // full v2 shape
export type TicketStatus = "draft" | "open" | "accepted" | "closed";
export type TicketClosedKind = "superseded" | "withdrawn" | "expired" | "dismissed";
export type TicketFamily = "write_fact" | "supplier_response" | "chase" | "triage" | "delivery_failure" | "recommendation";

// Step types (matching schema-v2.ts TicketStep)
export type TicketStepKind = "edit" | "send" | "decision" | "todo" | "classify";
export interface TicketRecordBinding { table: string; rowKey: string; operation: "insert" | "update"; version: number | null; }
export interface TicketFieldDiff { field: string; from: unknown; to: unknown; }
export interface TicketEditTarget extends TicketRecordBinding { diff: TicketFieldDiff[]; }
export interface TicketStep { id: string; kind: TicketStepKind; optional?: boolean; targets?: TicketEditTarget[]; draft?: { to: string[]; cc?: string[]; subject: string; body: string; marker?: string; }; instruction?: string; options?: Array<{ key: string; label: string; steps: TicketStep[] }>; meta?: Record<string, unknown>; }
export interface TicketResolution { decisionPath?: Array<{ stepId: string; chosenOption: string }>; skippedStepIds?: string[]; steps?: TicketStep[]; }

// TicketKind
export interface TicketKind { orgId: string; key: string; family: TicketFamily; title: string; isWriteBearing: boolean; ... }

// Evidence
export interface TicketEvidence { ... }

// PO types (for display)
export interface PurchaseOrder { poId: string; poCode: string; supplierCode: string; status: string; ... }
export interface PoLine { lineId: string; poId: string; quantity: string; unitPrice: string; status: string; ... }

// Email evidence
export interface EmailMessage { id: string; subject: string; from: ...; receivedAt: string; ... }
```

---

## 3. Server API (`apps/server`)

### 3.1 New/modified endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/tickets` | GET | List open tickets for org (updated query: join `ticket_kinds`, filter `status = 'open'`) |
| `/api/tickets/:id` | GET | Single ticket with evidence, PO data, email messages |
| `/api/tickets/:id/commit` | POST | Commit ticket (accept): body = final steps + decision choices + skipped step IDs |
| `/api/tickets/:id/close` | POST | Close ticket (dismiss): body = closedKind, closedReason |
| `/api/ticket-kinds` | GET | List enabled ticket kinds for org |
| `/api/pos/:id` | GET | PO detail with lines, tickets timeline |
| `/api/tickets/:id/evidence` | GET | Evidence (emails) for a ticket |

### 3.2 Commit logic (in `apps/server/src/index.ts` or new `apps/server/src/tickets.ts`)

1. Re-check ticket status = `open`
2. Re-check record versions (optimistic locking)
3. Apply all edit diffs atomically in a transaction
4. Record sends in `outbound_log`
5. Write `resolution` jsonb with decision path + final steps
6. Set `status = 'accepted'`, `resolvedByUserId`, `resolvedAt`
7. Fire push notifications to PO subscribers + owner

### 3.3 Close logic

1. Verify ticket is not a write_fact ticket (fact tickets cannot be dismissed)
2. Set `status = 'closed'`, `closedKind`, `closedReason`
3. Record in `ingestion_events` for suppression memory

### 3.4 Update push notifications (`apps/server/src/push.ts`)

- Include ticket title, kindKey in push payload
- Route to PO subscribers + owner (not all buyers except for #1)

---

## 4. Mobile App (`apps/mobile`)

### 4.1 New/updated screens

| Screen | File | Changes |
|---|---|---|
| Ticket List | `app/(tabs)/index.tsx` | Update TicketCard to show title, kind, PO reference, expiry badge |
| Ticket Detail (Step Walker) | `app/ticket/[id].tsx` | **Complete rewrite** — step walker replacing simple edit form |
| New screens (future) | `app/ticket/` | PO detail page, notification center (not in this phase) |

### 4.2 Ticket Detail / Step Walker (`app/ticket/[id].tsx`)

This is the **core UI change**. The page renders `ticket.steps` as an interactive pipeline:

#### Layout (top to bottom):
1. **Header bar**: Back button, ticket title, status badge
2. **Info card**: `creationReason`, PO reference, supplier, expiry badge
3. **Evidence panel**: Linked emails (from `ticket_evidence`), collapsible
4. **Step walker**: Each step rendered according to its `kind`
5. **Bottom bar**: Commit button (enabled when all required steps done) / Close button (for non-fact tickets)

#### Step renderers (new components):

**EditStep** (`components/ticket/EditStep.tsx`):
- Renders a table/grid: field name | old value → new value
- "new value" cells are editable (TextInput) for buyer corrections
- Shows target table and operation (insert/update)
- Line items rendered as rows in a scrollable grid

**SendStep** (`components/ticket/SendStep.tsx`):
- Editable fields: To, CC, Subject, Body
- Skip button if `optional: true`
- Shows the draft marker (e.g., "ack_requested")

**DecisionStep** (`components/ticket/DecisionStep.tsx`):
- Two (or more) cards side by side for each option
- Selecting a card reveals its child steps below
- For #4: "Agree to changes" → [send, todo, edit], "Push back" → [send]
- For #5: "Accept the rejection" → [send, todo, edit], "Push back" → [send]

**TodoStep** (`components/ticket/TodoStep.tsx`):
- Shows instruction text
- Checkbox/toggle "Mark as done"
- Gates the commit button

**StepWalker** (`components/ticket/StepWalker.tsx`):
- Container that iterates `ticket.steps` and renders each with the appropriate component
- Manages React state for all step edits (diffs, drafts, decisions, todos)
- Tracks completion: which required steps are satisfied
- Assembles final payload for commit

### 4.3 New UI components (all using React Native Reusables patterns + Tailwind)

| Component | File | Purpose |
|---|---|---|
| `EditStep` | `components/ticket/EditStep.tsx` | Diff grid |
| `SendStep` | `components/ticket/SendStep.tsx` | Email draft editor |
| `DecisionStep` | `components/ticket/DecisionStep.tsx` | Branch selection cards |
| `TodoStep` | `components/ticket/TodoStep.tsx` | External work checkbox |
| `StepWalker` | `components/ticket/StepWalker.tsx` | Step pipeline container |
| `EvidencePanel` | `components/ticket/EvidencePanel.tsx` | Email evidence display |
| `DiffRow` | `components/ticket/DiffRow.tsx` | Single field old→new diff row |
| `CloseDialog` | `components/ticket/CloseDialog.tsx` | Close reason modal/sheet |

Additional reusable UI components needed (add to `components/ui/`):
- `checkbox.tsx` — Checkbox/toggle component
- `select.tsx` — Select/dropdown component
- `dialog.tsx` — Modal dialog component
- `table.tsx` — Table/grid component (for diff display)

### 4.4 Update TicketCard (`components/TicketCard.tsx`)

Show: title, kindKey label, PO reference, supplier, created time, expiry (if set), hasWrites badge. Remove old status badge logic.

### 4.5 Update API layer (`lib/api.ts`)

Add hooks:
- `useTicketKinds()` — fetch ticket kinds for display metadata
- `useCommitTicket()` — commit mutation
- `useCloseTicket()` — close/dismiss mutation
- `useTicketEvidence()` — fetch evidence for a ticket
- `usePO()` — fetch PO detail
- Update `useTicket()` — fetch single ticket with relations
- Update `useTickets()` — filter status = 'open'

### 4.6 Update Ticket type throughout

- Remove old `description`/`status: pending|approved|rejected` references
- Use new Ticket type from `@mobile/shared`

---

## 5. Ticket Kinds Seed Data (First 5 Scenarios)

```sql
INSERT INTO ticket_kinds (org_id, key, family, title, is_write_bearing, is_system, enabled, definition)
VALUES
  ('<orgId>', 'po_creation', 'write_fact', 'New PO Created', true, true, true, '...'),
  ('<orgId>', 'full_acknowledgement', 'supplier_response', 'PO Fully Acknowledged', true, true, true, '...'),
  ('<orgId>', 'partial_acknowledgement', 'supplier_response', 'PO Partially Acknowledged', true, true, true, '...'),
  ('<orgId>', 'pre_ack_modification', 'supplier_response', 'Supplier Proposed Changes', true, true, true, '...'),
  ('<orgId>', 'whole_po_rejection', 'supplier_response', 'PO Rejected by Supplier', true, true, true, '...');
```

---

## 6. Implementation Order

### Phase A: Database (packages/db)
1. Write new `schema.ts` with all tables from schema-v2.ts + pushTokens
2. Update `index.ts` exports
3. Create and run migration SQL

### Phase B: Shared types (packages/shared)
4. Rewrite `src/index.ts` with all v2 types

### Phase C: Server (apps/server)
5. Add new API endpoints (ticket detail with relations, commit, close, ticket-kinds)
6. Update push notification logic for new ticket model

### Phase D: Mobile UI components (apps/mobile)
7. Add new UI primitives (checkbox, select, dialog, table)
8. Build ticket step components (EditStep, SendStep, DecisionStep, TodoStep, StepWalker, EvidencePanel, DiffRow, CloseDialog)
9. Update TicketCard component
10. Rewrite ticket detail page (`app/ticket/[id].tsx`) as step walker
11. Update ticket list page for new ticket shape
12. Update API hooks in `lib/api.ts`

### Phase E: Seed & verify
13. Seed ticket_kinds for test org
14. Create test tickets with steps jsonb for each scenario
15. End-to-end verification

---

## 7. Verification

1. **Database**: Run migration, verify all tables exist with `\dt` in psql
2. **Server**: Start server, verify `/api/ticket-kinds` returns seeded kinds
3. **Mobile - Scenario #1**: Open a PO creation ticket → see edit step with line items → edit a value → commit → verify accepted
4. **Mobile - Scenario #2**: Open a full ack ticket → see status diff → commit → verify
5. **Mobile - Scenario #4**: Open modification ticket → see decision cards → select "Agree" → see send/todo/edit steps → fill them → commit
6. **Mobile - Scenario #5**: Open rejection ticket → see "Accept the rejection" and "Push back" → choose accept → see send/todo/edit → fill todo (ERP updated) → commit
7. **Mobile - Close flow**: Open a #4 ticket → choose dismiss → enter reason → verify closed
8. **Push**: Verify notifications fire on commit with correct ticket data

---

## 8. Risk Areas

- **Database migration**: Schema-v2 user table has more columns than current. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to avoid breaking existing auth.
- **Enum creation**: PostgreSQL enums can't be created inside a transaction with `IF NOT EXISTS`. Need pre-flight check.
- **Steps jsonb**: The step walker must correctly handle the recursive `TicketStep` type (DecisionStep.options[].steps can contain nested steps).
- **No mid-flight save**: Per spec §2.3, abandoning mid-ticket discards all edits. The UI must make this clear to users.
- **Commit race**: The commit endpoint must handle version conflicts gracefully and return clear error messages the UI can display.
