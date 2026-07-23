# Ticket System Integration — ROADMAP

> **Last updated**: 2026-07-21
> **Reference**: `reference/schema-v2.ts`, `reference/Scout Ticket System.md`, `reference/Building the Ticket UI on schema-v2.md`

Integrate the Scout ticket model (schema-v2) into the mobile app, supporting ticket scenarios #1–#5 with a full step-walker UI.

## Key Points

- **kindKey** = column on `tickets`, references `ticket_kinds.key`. First 5 scenarios: `po_creation`, `full_acknowledgement`, `partial_acknowledgement`, `pre_ack_modification`, `whole_po_rejection`
- **All schema-v2 tables** created (even if some unused by mobile UI)
- **Step walker** replaces simple edit form — Edit/Send/Decision/Todo steps rendered interactively
- **No "reject" button** — fact tickets accept only; supplier-response tickets use decision branches (Agree/Push back, Accept/Push back)
- **Commit = single mutation** — all step edits in React state, one commit call

---

# Phases & Todos

## Phase A — Database Schema [DONE] ✅

- [x] **A1**: Write new `packages/db/src/schema.ts` (all v2 tables + pushTokens + enums + relations)
- [x] **A2**: Update `packages/db/src/index.ts` exports
- [x] **A3**: Create migration SQL (enums first, then tables, auth column additions)
- [x] **A4**: Run migration against collab-postgres
- [x] **A5**: Verify all tables exist with `\dt` — 47 tables confirmed
- [x] **MILESTONE**: DB schema matches schema-v2.ts; server can import new tables

## Phase B — Shared Types [DONE] ✅

- [ ] **B1**: Rewrite `packages/shared/src/index.ts` — Ticket, TicketStep, TicketKind, TicketEvidence, PurchaseOrder, PoLine, EmailMessage types
- [ ] **B2**: Export TicketStatus, TicketClosedKind, TicketFamily, TicketStepKind union types
- [ ] **MILESTONE**: Mobile and server share v2 type definitions

## Phase C — Server API [DONE] ✅

- [ ] **C1**: Update `GET /api/tickets` — filter `status = 'open'`, join `ticket_kinds`
- [ ] **C2**: Add `GET /api/tickets/:id` — single ticket with steps, evidence, PO, emails
- [ ] **C3**: Add `POST /api/tickets/:id/commit` — accept: re-check status/versions, apply diffs, write resolution, fire push
- [ ] **C4**: Add `POST /api/tickets/:id/close` — dismiss: verify non-fact, set closedKind/closedReason
- [ ] **C5**: Add `GET /api/ticket-kinds` — list enabled kinds for org
- [ ] **C6**: Update `/api/members` if needed for new user columns
- [ ] **C7**: Update push notification logic — include ticket title/kindKey in payload
- [ ] **MILESTONE**: Commit and close endpoints work via curl; ticket-kinds returns seeded data

## Phase D — Mobile UI Primitives & Components [DONE] ✅

- [x] **D1**: Add `components/ui/checkbox.tsx` (CVA + tailwind-merge)
- [x] **D2**: Add `components/ui/select.tsx`
- [x] **D3**: Add `components/ui/dialog.tsx` (modal/sheet for close reason)
- [x] **D4**: Add `components/ui/table.tsx` (for diff grid display)
- [x] **E1**: `components/ticket/DiffRow.tsx` — single field old→new diff
- [x] **E2**: `components/ticket/EditStep.tsx` — editable diff grid
- [x] **E3**: `components/ticket/SendStep.tsx` — email draft editor
- [x] **E4**: `components/ticket/DecisionStep.tsx` — option cards
- [x] **E5**: `components/ticket/TodoStep.tsx` — checkbox
- [x] **E6**: `components/ticket/EvidencePanel.tsx` — collapsible emails
- [x] **E7**: `components/ticket/StepWalker.tsx` — state management, commit payload assembly
- [x] **E8**: `components/ticket/CloseDialog.tsx` — close reason modal
- [x] **F1**: Update `components/TicketCard.tsx` — title, kind, PO ref, badges
- [x] **F2**: Rewrite `app/ticket/[id].tsx` — complete step walker
- [x] **F3**: Update `app/(tabs)/index.tsx` — FlatList for new ticket shape
- [x] **F4**: Update `lib/api.ts` — all new hooks
- [x] **F5**: Remove old `app/ticket/new.tsx` (tickets are agent-created)
- [x] **MILESTONE**: All components and screens built

## Phase E — Seed & Verify [DONE] ✅

- [x] **G1**: Seed `ticket_kinds` (5 kinds) for all orgs
- [x] **G2**: Create 5 test tickets with realistic steps jsonb for scenarios #1–#5 (via DB)
- [x] Server verified: `/api/ticket-kinds` returns 5 kinds, `/api/tickets` returns 5 test tickets
- [ ] **G3**: E2E: Scenario #1 PO creation → edit step → commit → accepted (needs device)
- [ ] **G4**: E2E: Scenario #2 Full ack → status diff → commit → accepted (needs device)
- [ ] **G5**: E2E: Scenario #4 Modification → decision (Agree) → send/todo/edit → commit (needs device)
- [ ] **G6**: E2E: Scenario #5 Rejection → decision (Accept) → send/todo/edit → commit (needs device)
- [ ] **G7**: E2E: Close flow — dismiss with reason → closed (needs device)
- [ ] **G8**: Push notification verification on commit (needs device)
- [x] **MILESTONE**: All code pushed to GitHub; ready for device testing

---

## Notes / Gotchas

- **Enum creation**: PostgreSQL enums can't use `IF NOT EXISTS` inside transactions. Use pre-flight DO blocks.
- **Auth table migration**: `user` table gets `first_name`, `last_name`, `role`, `banned`, `ban_reason`, `ban_expires`. `session` gets `active_team_id`, `impersonated_by`. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **Old tickets table**: The v1 `tickets` table (id, description, status, etc.) will be replaced. Old data is POC — can be dropped.
- **Steps jsonb recursion**: `DecisionStep.options[].steps` can contain nested steps. The step walker must recurse.
- **No mid-flight save**: Per spec §2.3, navigating away discards all edits. Step state lives only in React state.
- **Commit race**: Backend must re-check ticket status + record versions at commit time.
- **Fact ticket guard**: Close endpoint must reject `write_fact` family tickets (they can only be accepted).
- **pushTokens**: Not in schema-v2 — kept from original schema, needed for Expo push.
