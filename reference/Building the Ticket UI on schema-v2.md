# Building the Ticket UI on schema-v2

**Audience:** frontend / prototyping. **Scope:** the ticket queue and ticket-resolution flow for Scenarios \#1–\#5. **Companion files:** `schema-v2.ts` (the source of truth for shapes), `ticket-model.md` (the product spec; § references below point there).

---

## 1\. The mental model in three sentences

The agent (Scout) watches emails and ERP events and turns them into **tickets**. A ticket is a small pipeline of **steps** the buyer walks through in one sitting; nothing touches the database until the final **commit**, which applies everything at once. Your UI's whole job is: render the queue, let the buyer walk/edit the steps, and fire one commit call at the end.

Three product rules that shape every screen you build:

1. **There is no "reject" button.** A wrong proposal is corrected in place and accepted (§3). A ticket that shouldn't exist is *dismissed* (closed with a reason). Fact tickets (\#1–\#3 and other ERP facts) can never be dismissed — only accepted, possibly after edits.  
2. **There is no "save draft" button.** If the buyer navigates away mid-ticket, all their in-progress edits are simply gone; the ticket stays `open` and recomputes fresh next time (§2.3). Keep all mid-flight state in client memory. Never persist partial progress.  
3. **Closed ≠ deleted.** Closed tickets leave the queue but stay on the PO timeline with their reason and link (§3). Build the timeline to show them.

---

## 2\. Make-or-break tables and fields

### 2.1 `tickets` — the center of the UI

| Field | Why it matters to you |
| :---- | :---- |
| `status` | `draft` → never show (agent still assembling). `open` → it's in the queue. `accepted` / `closed` → terminal, timeline only. |
| `kindKey` \+ `title` | What to render in the queue row. `kindKey` joins to `ticket_kinds` for the family and display metadata. |
| `poId`, `supplierCode` | Both nullable. `poId` null \= triage or supplier-level ticket. Everything in \#1–\#5 has a PO (for \#1 the PO doesn't exist until commit — `poId` is null on the ticket until then). |
| `steps` (jsonb, `TicketStep[]`) | **The entire ticket body.** The step walker renders directly from this. See §3 below. |
| `creationReason` | "Why am I seeing this?" — show it at the top of the ticket detail view. |
| `hasWrites` | Whether this ticket writes to the SOR. Cosmetic for you (badge), structural for the backend. |
| `closedKind` \+ `closedReason` \+ `closedRefTicketId` | For timeline rendering: `superseded` → link forward to the successor ticket; `withdrawn` → link to the dominating ticket; `dismissed` → show the human's note. The DB *enforces* that closed tickets have a kind (CHECK constraint) — you can rely on it. |
| `resolution` (jsonb, `TicketResolution`) | Set only on accepted tickets: which decision branch was chosen, which optional steps were skipped, and the **final step payloads as committed** (after human edits). Render the timeline's "what actually happened" from this — not from the original `steps`, which may differ. |
| `resolvedByUserId`, `resolvedAt` | "Accepted by Dana, 2h ago." |
| `expiresAt` | Optional deadline badge ("expires Friday"). |

**Relations you'll query through:** `tickets.kind`, `tickets.purchaseOrder`, `tickets.supplier`, `tickets.evidence` (→ emails/attachments), `tickets.resolver`, `tickets.closedRef`.

### 2.2 `ticket_kinds` — display \+ behavior metadata

Org-scoped registry. For the UI you need `title`, `family` (icon/grouping: `write_fact`, `supplier_response`, `chase`, …), and `enabled`. The `definition` column is agent-facing prompt material — never render it.

### 2.3 `ticket_evidence` — "show me the email"

Many-to-many. Each row points at an `emailMessages` row (or an attachment extraction, or an ERP payload). The ticket detail view should always have an evidence panel — the buyer decides based on the actual email. One email can appear on several tickets (fan-out) and one ticket can hold several emails (dedup) — don't assume 1:1.

### 2.4 `purchase_orders` and `po_lines` — what tickets write

Fields the ticket UI reads and displays as *current state* next to proposed diffs:

- `purchaseOrders.status`: `unacknowledged | acknowledged | rejected | cancelled`. There is **no stored "partially acknowledged"** — derive it in the UI: some lines `acknowledged`, some not.  
- `poLines.status`: `unacknowledged | acknowledged | exception | cancelled | shipped | rejected`.  
- `version` on both: **the optimistic-lock counter.** Every edit diff in a ticket is bound to the version it was computed against. You don't manage this — but you must *handle the failure* (see §4, "when commit is refused").  
- `purchaseOrders.ownerUserId`: the accountable buyer, always set. Show it on the PO header.  
- `po_subscribers`: who gets notified besides the owner. Grow-only in v1.

### 2.5 Tables you'll never write, but should know exist

- `ticket_write_pos` — backend enforcement of "one open write-ticket per PO." Its only UI consequence: a commit or ticket-creation race can fail loudly; treat it like a stale-version refusal.  
- `audit_log` (with `ticketId`) and `outbound_log` (with `ticketId`) — the committed effects, if you ever build a deep-audit view. For the normal timeline, `tickets.resolution` is enough.  
- `ingestion_events` — the "nothing silently discarded" ledger; useful for an admin/debug screen only.

---

## 3\. The `steps` payload — your rendering contract

`tickets.steps` is a `TicketStep[]` (types exported from `schema-v2.ts`). Four step kinds appear in \#1–\#5:

```
// EDIT — a structured SOR diff. Render as an editable old→new grid.
{
  "id": "s1", "kind": "edit",
  "targets": [
    {
      "table": "po_lines", "rowKey": "…uuid…",
      "operation": "update", "version": 4,          // bound version — display-only for you
      "diff": [ { "field": "status", "from": "unacknowledged", "to": "acknowledged" } ]
    },
    {
      "table": "purchase_orders", "rowKey": "…new uuid…",
      "operation": "insert", "version": null,        // insert: no prior row, no version
      "diff": [ { "field": "po_code", "from": null, "to": "PO-1042" } ]
    }
  ]
}

// SEND — an editable email draft. Render to/cc/subject/body as editable fields.
{
  "id": "s2", "kind": "send", "optional": true,      // optional → show a "skip" affordance
  "draft": { "to": ["sales@acme.com"], "subject": "…", "body": "…", "marker": "ack_requested" }
}

// DECISION — mutually exclusive branches. Render as cards; choosing one reveals its steps.
{
  "id": "s3", "kind": "decision",
  "options": [
    { "key": "agree",     "label": "Agree to changes",  "steps": [ /* send, todo, edit */ ] },
    { "key": "push_back", "label": "Push back",          "steps": [ /* send */ ] }
  ]
}

// TODO — external work (update the ERP). Render instruction + a "Mark done" checkbox.
// Marking done is the human ASSERTING reality changed — it gates commit, it is not a write.
{ "id": "s4", "kind": "todo", "instruction": "Update PO-1042 need-by dates in the ERP" }
```

**UI rules for the step walker:**

- The buyer can edit any `edit` diff's `to` values and any `send` draft before commit ("correct in place, never reject").  
- `optional: true` steps can be skipped; required ones gate the commit button.  
- A `decision` chooses exactly one option (its `steps` then apply), or "none of these" — which closes the ticket `dismissed` (never offered on fact tickets like \#1).  
- All of this state lives in React state only. The one server interaction is the final commit call carrying the (possibly edited) steps \+ choices.

---

## 4\. Commit — the single mutation

One API call: *commit ticket N with these final step payloads*. The backend then re-checks versions and ticket state, applies all diffs atomically, fires sends, writes `resolution`, sets `status = accepted` (§2.2).

**When commit is refused** (stale version, ticket already superseded/withdrawn by the agent, or a serialization conflict):

- Show the explanation the backend returns (e.g. "superseded by PO-1042 cancellation").  
- Discard local state and reload the ticket/queue — the agent will have raised a recomputed successor. **Never** offer a retry that force-commits stale data.

This is the single most important interaction to get right. Buyers must experience it as "the world moved, here's the fresh version," not as an error.

---

## 5\. Scenario walkthroughs (\#1–\#5)

### \#1 — New PO created (ERP fact) · pipeline `[edit]`

**Queue row:** "New PO PO-1042 · Acme Corp · 5 lines · $12,400".

**Ticket detail:** header info (supplier, PO number, creation date, total, line count) \+ line grid (part, qty, need-by) \+ evidence panel (the CC'd PO email and PDF). The `edit` step is **all inserts**: one `purchase_orders` target (`operation: "insert"`, `version: null`) plus one target per line. Because the PO doesn't exist yet, `tickets.poId` is null; the PO link appears on the timeline only after acceptance.

**UI flow:** the buyer reviews the parsed values in an editable grid. If email parsing got a quantity wrong, they fix the `to` value in place. Then Accept. **There is no dismiss on this ticket** — a fact ticket is never declined (§3).

**On commit (backend does; UI reflects):** PO \+ lines created with status `unacknowledged`; owner set (ERP buyer code → else `org_settings.defaultOwnerUserId`); `po_subscribers` seeded from CC'd buyers; **every buyer in the tenant** gets a `notifications` row (the one tenant-wide broadcast); evidence attached. Queue removes the ticket; PO page now exists with the ticket at the top of its timeline.

### \#2 — Full acknowledgement · pipeline `[edit]`

**Queue row:** "PO-1042 acknowledged · Acme Corp".

**Ticket detail:** one `edit` step with `operation: "update"` targets — the PO header (`status: unacknowledged → acknowledged`) and every line (same transition), each bound to its current `version`. Evidence panel shows the supplier's reply.

**UI flow:** essentially a one-click review: show the before/after status change, buyer accepts. If the supplier actually only acknowledged some lines, the agent should have raised a \#3 instead — but the buyer can also just edit this diff down (deselect/correct lines) and accept; correct-in-place applies here too.

**On commit:** statuses flip, subscribers \+ owner notified (not all buyers), email attached to the PO timeline.

### \#3 — Partial acknowledgement · pipeline `[edit]`

**Ticket detail:** the line grid is the star — each line shows a **disposition**: `acknowledged` vs. *still unacknowledged*. The `edit` step only carries targets for the confirmed lines. Unconfirmed lines appear in the UI (from `steps[].meta` or the PO join) but have **no diff** — there is no "deferred" status (§ Scenario 3); they simply stay `unacknowledged` and the \#11 chase will pick them up later.

**UI nuance:** if the supplier gave an expected-answer date for the pending lines, it arrives as line-level info (render it), but it does *not* create a state or a diff.

**On commit:** confirmed lines flip to `acknowledged`; PO header stays `unacknowledged` (your UI derives "partially acknowledged" from the mixed line statuses); subscribers \+ owner notified with the outstanding lines called out.

### \#4 — Supplier proposes changes before ack · pipeline `[decision] → branch`

**Ticket detail:** show the comparison table (per line: original value vs. proposed value, supplier's reason), then a **decision step** with two cards:

- **Agree** → reveals three steps: `send` (drafted reply agreeing \+ asking for acknowledgement, editable), `todo` ("update the ERP with the agreed values" — Mark-done checkbox), `edit` (apply proposed values to PO/lines; affected lines stay/return `unacknowledged`).  
- **Push back** → reveals one step: `send` (drafted refusal, editable). **No SOR diff at all** — and note this branch still ends in `accepted`, because sending the push-back email *is* the ticket's effect (§3).

**UI flow:** choose a card → walk that branch's steps → commit button enables when required steps are satisfied (todo checked, send reviewed). Choosing the other card discards the first branch's local edits (confirm with the user). The buyer walking away \= nothing saved, ticket recomputes.

**On commit:** branch effects apply in order — diffs first, then the send fires (§2.2). Subscribers \+ owner notified; modification email attached.

### \#5 — Whole-PO rejection · pipeline `[decision] → branch`

**Ticket detail:** rejection banner (supplier, reason if given, line count), evidence panel, then the decision:

- **Accept the rejection** → `send` (acknowledge \+ ask for reason if missing), `todo` ("cancel the PO in the ERP and re-source the parts"), `edit` (PO `status → rejected` **and every line `status → rejected`** — the line enum has `rejected` for exactly this).  
- **Push back** → `send` only (ask them to reconsider); no SOR change; still `accepted` on commit.

**On commit (accept branch):** PO and lines turn `rejected`; subscribers \+ owner notified so re-sourcing can start. Any other open tickets on this PO will be withdrawn *by the agent* — your queue should simply re-render from the data; expect tickets to vanish from the queue and reappear as `closed/withdrawn` entries on the PO timeline with a link to this rejection ticket (`closedRefTicketId`).

---

## 6\. Quick reference — screens to build

| Screen | Reads | Writes (via API) |
| :---- | :---- | :---- |
| Ticket queue | `tickets` (status=`open`) \+ `ticket_kinds` \+ `purchaseOrders` join | — |
| Ticket detail / step walker | `tickets.steps`, `ticket_evidence` → `emailMessages`, current PO/line state | one commit call; or one dismiss call (non-fact tickets only) |
| PO page \+ timeline | `purchaseOrders` \+ `poLines` (derive partial-ack), all `tickets` for the PO incl. closed (`closedKind`, `closedReason`, `closedRef`, `resolution`) | — |
| Notifications | `notifications` (isRead) | mark-read |

**The three failure states to design:** commit refused (stale/superseded — show reason, reload); ticket vanished from queue while viewing (agent withdrew it — same treatment); email evidence missing (deleted upstream — evidence rows null out gracefully, show a placeholder).

