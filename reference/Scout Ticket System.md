# Scout Ticket System

The ticket is the single mechanism through which the system of record (SOR) changes. The AI agent (Scout) observes events — supplier emails, ERP messages, scheduled scans — and converts them into tickets. Humans (buyers) resolve tickets. **No SOR write occurs except through a ticket**, and the ticket queue itself is agent-managed: the agent creates, updates, supersedes, and withdraws tickets as the world changes.

This document defines how a ticket is structured (a pipeline of steps that commits atomically), the ticket lifecycle, the concurrency rules that keep proposals honest, and the supporting models (ingestion, ownership, notification).

## 1\. Core Invariants

1. **Every SOR write is granted by exactly one ticket and applied only by that ticket's commit.** The ticket records what changed, why, on whose authority, and from what evidence.  
2. **A ticket is atomic and resolved in one session.** A ticket is a short pipeline of *steps* (§2) that gathers intent; its SOR writes are held and applied together at a single **commit**. It either commits as a whole or leaves no trace — there is no partial commit and no parked, half-finished state. Each ticket is scoped to one atomic decision (one PO, one intent).  
3. **A ticket's proposal is bound to a record version.** A proposal computed against PO version N may only be committed against PO version N; the version is re-checked at commit (see §4).  
4. **The agent owns queue hygiene.** Humans never have to garbage-collect stale tickets; the agent withdraws or supersedes them.

**Effect scope.** Only SOR writes are held to commit. A *todo* step's external change (the human editing the ERP) happens in the world when they perform it, so the SOR may transiently lag reality; outbound emails are ordered within the commit, not atomic with the write (see §2.2).

## 2\. Ticket Structure: Steps

A ticket is a short, sometimes branching **pipeline of steps**. Each step gathers intent — a decision, an edited draft, a confirmation that external work is done — and produces *pending effects*. Nothing touches the SOR or sends an email until the ticket's final **commit**, which applies every pending effect together. What used to be four "ticket types" are just common step shapes (§2.4).

### 2.1 Step kinds

- **edit step** — proposes a structured SOR diff (PO header and/or lines): target record \+ version, field-level old→new values, evidence links. Editable before commit. *(the former Apply.)*  
- **send step** — proposes an outbound email (editable draft) plus its bookkeeping marker (e.g. "acknowledgement requested at T"). *(the former Send.)*  
- **decision step** — presents two or more mutually exclusive options; the human chooses one (or "none", which ends the ticket). The choice determines which downstream steps follow — this is what makes a pipeline branch. *(the former Decide.)*  
- **todo step** — work the human performs outside the system (canonically updating the ERP, which the agent cannot write). Marking it Done is the human *asserting reality changed* — an input, not a system effect; the matching SOR mirror-write is an edit that applies at commit like any other. *(the former Todo — now a step, not a separate ticket.)*

The human works each step and may edit its payload first: an **edit** is accepted (after fixing the diff if the values are off — *correct in place, never reject*); a **send** is sent, or skipped if it is optional; a **decision** is one chosen option (each option is a branch that then gets accepted), or "none"; a **todo** is marked Done (asserting the external work). Taking the steps to commit makes the ticket **accepted** (§3); choosing "none", or judging that nothing should happen, **closes** it (`dismissed`); simply walking away abandons the session and recomputes (§2.3).

### 2.2 Commit — how pending effects apply

Steps only gather intent; the SOR is untouched until commit. At commit, in order:

1. **Re-lock.** Re-check every target record's version (optimistic locking, §4). If any moved since its step was computed, the ticket commits nothing and is superseded — it recomputes fresh against the current version.  
2. **Apply all SOR diffs together**, atomically — every edit step (including a todo's mirror-write) lands as one write-set.  
3. **Fire sends**, ordered after the diffs (diff → send → marker). A send is *ordered-with-retry*, not ACID with the write: if a send fails, the committed diff stands and the agent raises a follow-up rather than rolling back.

**Effect scope.** Only SOR writes are truly held to commit. A todo's external change (the human editing the ERP) happens in the world when they do it, so the SOR may transiently lag reality — that lag *is* the todo. Sends are external too, hence ordered rather than atomic.

### 2.3 One session, no parking

A ticket is resolved in a single sitting. There is **no durable mid-flight state**: if the human abandons it — closes the browser, navigates away — before commit, nothing is persisted, and the ticket recomputes fresh next time, re-walking its steps (and re-generating drafts) against current state. Three consequences:

- **Strict atomicity for free.** A ticket either commits whole or leaves no trace; no half-applied ticket can exist.  
- **Abandonment and supersession are the same mechanism** — discard the in-flight ticket, recompute fresh. The commit-time re-lock (§2.2) is where a supersession that happened mid-session is caught.  
- **Long todos may be re-walked.** Updating the ERP takes the human out of the browser; if their session dies they re-walk the ticket on return. If the record moved meanwhile, the fresh ticket reflects current truth rather than a stale diff — accepted friction, and safer than committing something stale.

### 2.4 Common step shapes (the former "types")

Conventions for UI and permissions, not distinct types — a ticket's shape is just its step list:

| Shape | Pipeline | Scenarios |
| :---- | :---- | :---- |
| Simple write | `[edit]` | PO creation, acknowledgements, ASN |
| Write \+ notify supplier | `[edit, send]` | line update (\#6), line/PO cancellation (\#7/\#8), expedite (\#10) |
| Chase | `[send]` | acknowledgement / ASN / lead-time chases (\#11/\#12/\#13) |
| Choose-then-act | `[decision → branch of send / todo / edit]` | pre-ack modification (\#4), whole-PO rejection (\#5), post-ack exception (\#9), post-ack rejection (\#15) |

### 2.5 Approval: human-in-the-loop (v1)

**Every ticket is human-approved in v1.** A buyer walks its steps and triggers the commit before any SOR write — no exceptions. This holds even for ERP-originated facts (PO creates/changes/cancellations) and for trivial bookkeeping (logging an "all on track" reply): the write still waits behind a human. We accept the resulting latency between an authoritative source and its mirror (the drift risk raised in A4) in exchange for a single, uniform trust model — one way a write ever happens.

**Auto-approval is deferred, not designed away.** A later version may add an auto-approved class for facts from a trusted channel (e.g. the structured ERP API), so those commit instantly while still leaving a ticket for audit. The lifecycle already accommodates it — an auto-approved ticket would enter `open` and commit in the same tick — so adding it later is non-breaking. Until then, treat every ticket as work in the queue.

### 2.6 Triage — the fallback

When ingestion can't produce a confident proposal (unknown PO number, ambiguous match, low-confidence extraction, off-topic email), the agent raises a **Triage ticket**: a ticket whose pipeline isn't known yet — a single *classify* step with evidence attached and no edit. Resolving it either appends the appropriate steps (which then get accepted) or, if the email is spam/off-topic, closes the ticket `dismissed:<note>` with the email filed as evidence. Every inbound event ends as either a ticket, a dedup drop, or a Triage ticket — nothing is silently discarded.

## 3\. Ticket Lifecycle

A ticket has **two terminal states**: **accepted** (the human took it to commit and its effects were applied) and **closed** (it ended without acceptance, carrying a reason). There is no separate "rejected" state — see below.

```
                    ┌────────────► accepted   (human committed it; effects applied)
 draft ──► open ────┤
                    └────────────► closed      (ended without acceptance; carries a reason)
```

- **draft** — agent is still assembling the pipeline (not visible as work).  
    
- **open** — in the queue, awaiting a human session (every ticket in v1; see §2.5). A ticket abandoned mid-session (browser closed, navigated away) simply stays `open` and recomputes fresh (§2.3) — abandonment is not a terminal state.  
    
- **accepted** — the human carried the ticket through its steps to a successful commit; its effects were applied (§2.2). This *includes* the "push back" branch of a decision — sending a push-back email is an effect, so choosing it is an accept, not a rejection. Along the way the human may edit any step's payload and skip optional steps (§2.1). Terminal. *(the former "committed" / "approved".)*  
    
- **closed** — the ticket ended without being accepted. A single terminal state, qualified by a required **reason string** that records *why* and links to the cause:  
    
  - `superseded:<successor-id>` — (agent) the *same job* was recomputed into a newer ticket. Links to its successor.  
  - `withdrawn:dominated-by:<id>` — (agent) a *different, dominating* event mooted the ticket's whole premise (e.g. the PO was cancelled while an acknowledgement ticket was open). Links to what dominated it; no successor.  
  - `expired:<window>` — (agent) a deadline the ticket depended on lapsed (§4). Usually lands as a supersession instead.  
  - `dismissed:<note>` — (human) nothing should happen here: spam, off-topic, or an action the human judges unnecessary. Recorded so ingestion won't re-raise the same event (§5).


  New reasons are just new strings; nothing branches on the *set* of reasons, only on the single `closed` state.

**There is no "rejected".** Because nothing is written until the human takes a ticket to commit (§2.2–§2.3), declining to act writes nothing — that is just a `closed` (`dismissed`), or, if the human simply walks away, an abandon that recomputes. And crucially, **a factually-wrong proposal is corrected in place, not declined**: the human edits the step's payload and accepts. So an ERP-**fact** ticket (\#1/\#6/\#7/\#8) has only two outcomes — **accept**, or **fix on the spot and accept**. A fact ticket is never `dismissed`: you cannot dismiss a PO that exists in the ERP without stranding it out of the SOR — the exact A2 worst case. (If the ERP fact itself looks wrong, the human still corrects the mirror and accepts, or escalates out-of-band; the ticket resolves by acceptance, never by a decline.)

A decision step's choice and a todo step's Done are *steps within* a ticket, not ticket states; a ticket reaches `accepted` only when its final step completes and the commit succeeds.

**Closed is not deleted.** A closed ticket leaves the *active* queue but stays on the PO timeline with its reason and link, so a buyer who saw it can always find out what became of it. Suppression is a state change, never a silent removal.

## 4\. Concurrency, Ordering, and Closure

Stale tickets are the main way commits corrupt state. Four rules keep the queue honest.

1. **Record-version locking (at commit).** Every edit step's diff records its target record's version. At commit the versions are re-checked; if any moved, the ticket commits nothing and is superseded — the agent recomputes against the current version, raising a successor and closing the original `superseded:<successor-id>` if work remains, or closing it `withdrawn` if nothing is left to do. Because a ticket carries no parked state (§2.3), the staleness window is a single session, not days.  
     
2. **Ticket-state locking (the commit race).** Between the agent deciding to close a ticket and a human committing it there is a window. Commit therefore re-checks the ticket's *own* state, not just the record version: committing a ticket the agent has already closed is refused with an explanation (e.g. "superseded by PO-XXXX cancellation"), and the ticket recomputes fresh. Same mechanism as record-version locking, one level up.  
     
3. **Supersede vs. withdraw — the survival test.** When a new event collides with an open ticket, the agent asks one question: *does any of this ticket's job survive the new event?*  
     
   - **None survives → withdraw.** A whole-PO cancellation lands while an acknowledgement ticket is open: the ack has nothing left to do. Close it `withdrawn:dominated-by:<cancellation-id>`; the cancellation stands up its own ticket. ("Supersede" would be the wrong verb — nobody recomputed the ack.)  
   - **Part survives → supersede.** A line cancellation removes 2 of the 5 lines an open ack ticket covers: the ack still has 3 lines to acknowledge. Recompute it to the surviving scope and close the original `superseded:<successor-id>`.

   

4. **Per-PO serialization.** At most one open write-bearing ticket per PO at a time (pure `[send]` tickets exempt where harmless). A new event for a PO that already has an open write-ticket is resolved by rules 1–3 — amend, supersede, or withdraw — never by silently queueing a second, conflicting write behind the first.

**Expiry is an event, not a passive state.** The system is rarely time-driven. A lapsed deadline — an unapproved expedite draft past its need-by date, or a supplier offer past its stated validity — is modeled as an **event emitted by a scheduled watchdog scan**, and it closes the affected ticket exactly like any other dominating event. Usually the same scan also spawns a successor (a fresh chase or an escalation), so it lands as a *supersession*; only when nothing is left to do — a genuinely evaporated offer — is it a bare `expired` close. A stale proactive draft that the *next scheduled scan would recompute anyway* is that recompute — i.e. a supersession — not a separate expiry, so it is never counted twice.

## 5\. Ingestion and Deduplication

Events reach the system through overlapping channels (buyer-inbox webhook, Scout inbox CC, ERP API). Before ticket creation:

1. **Message-level dedup** — email message-id; ERP event id.  
2. **Semantic dedup** — hash of (PO, event type, content) catches the same fact arriving via different channels (e.g. ERP API \+ CC'd email both announcing a PO). Dedup spans all discovery channels (buyer-CC, Scout-CC, ERP API), not just retries within one. When the same fact lands on more than one channel, the **authoritative ERP-API copy is kept** and the CC'd-email copies attach to that ticket as evidence rather than each spawning its own; if no API copy exists, the first email copy wins and later ones attach as evidence.  
3. **Open-ticket suppression** — the agent does not raise a ticket for a job an open ticket already grants. "Is a chase already pending?" means *there is an open (not-yet-accepted) chase ticket* **or** a recent "requested" timestamp — not the timestamp alone. Checking the timestamp only would let a daily scan re-raise the same chase every day while the first ticket sits unapproved.  
4. **Fan-out** — one email may cover multiple POs and multiple intents. Ingestion splits it: one ticket per (PO, intent), each linking back to the shared source message. Ticket ↔ evidence is many-to-many.  
5. **Fallback** — anything unmatchable becomes a Triage ticket (§2.6).

## 6\. Ownership and Notification

Ownership and subscription are **two separate concepts**: the owner is *who is accountable*, the subscriber list is *who is kept informed*.

**PO owner — a single, always-set buyer.** Every PO has exactly one owner, resolved by precedence: (1) the ERP buyer code when available; (2) otherwise the **org's default owner** — a configured fallback, so a PO is never ownerless. The owner is *not* the approver; ownership never transfers just because someone resolves a ticket. The owner is the accountable party — escalations and "who should chase this" route to them — and is always on the notification path.

**Subscriber list ("touched") — flat, per PO.** Separate from ownership, each PO carries a flat list of subscribed buyers. A buyer is added when:

- they are CC'd on any of the PO's emails (anyone CC'd touches the PO, resolved to a known buyer identity);  
- a ticket on the PO originated from their buyer inbox (only when that inbox resolves to a specific buyer);  
- they resolve (accept or close) any ticket on the PO.

Identity resolution is best-effort: a Scout-inbox event, or a shared/unresolvable mailbox, adds no subscriber — the owner is the backstop, so nothing falls through the cracks. In v1 the list only grows (no unsubscribe or decay); mute/unsubscribe is deferred (noted against A8/A9).

**Notification routing.**

- **New-PO creation** notifies **every buyer in the tenant** — literally all buyers, with no team/site/commodity scoping. Creation also seeds the subscriber list from CC'd buyers and sets the owner.  
- **Every other PO-lifecycle event** notifies the PO's **subscribers \+ owner**, never all buyers.

---

## 7\. Scenario → Model Mapping

Every ticket is human-approved in v1 (§2.5). "Pipeline" is the ticket's step list (§2.4).  
Restructured mapping (proposal): the table below adds Discovery and “When ERP integration is live” columns, scenario \#17 (MRP reschedule), and a sync footnote — intended to replace the original table that follows it.

| Scenario | Pipeline (steps) | Discovery | When ERP integration is live | Notes |
| :---- | :---- | :---- | :---- | :---- |
| \#1 PO creation | \[edit\] | Buyer CC webhook · Scout CC | Adapter event becomes the authoritative copy; auto-approve candidate | Sets owner, seeds subscribers (§6) |
| \#2 Full acknowledgement | \[edit\] | Supplier email | No change | — |
| \#3 Partial acknowledgement | \[edit\] | Supplier email | No change | Unconfirmed lines stay unacknowledged; \#11 chases |
| \#4 Pre-ack modification | \[decision: agree | push back\] → agree \[send, todo: update ERP, edit\]; push back \[send\] | Supplier email | Agree-branch todo →  adapter write (dates: phase 1; price/qty: stays todo until phase 2\) | — |
| \#5 Whole-PO rejection | \[decision: accept | push back\] → accept \[send, todo: cancel in ERP, edit\]; push back \[send\] | Supplier email | Todo stays until phase-2 write-back (cancellations) | — |
| \#6 Line update | \[edit, send?\] | buyer/Scout CC · ERP event | ERP copy authoritative; emails attach as evidence; auto-approve candidate | Send \= re-ack request; may supersede an open ack (§4) |
| \#7 Line cancellation | \[edit, send\] | buyer/Scout CC · ERP event | Same as \#6 | Send \= confirm cancellation; closes tickets on affected lines (§4) |
| \#8 Whole-PO cancellation | \[edit, send\] | buyer/Scout CC · ERP event | Same as \#6 | Withdraws open tickets on the PO (§4) |
| \#9 Exception w/ counter | \[decision: accept | hold\] → accept \[send, todo: update ERP, edit\]; hold \[send, edit: mark exception\] | Supplier email | Accept-branch todo → adapter write (dates: phase 1; price/qty: phase 2\) | — |
| \#10 ASN | \[edit, send?\] | Supplier email | Edit mirrors to ERP via adapter (expected receipt) | Send only if expedite needed |
| \#11 Ack chase | \[send\] | Scheduled scan | No change | — |
| \#12 ASN chase | \[send\] | Scheduled scan | No change | — |
| \#13 Weekly lead-time | \[send\]; on-track reply → \[edit\] log | Scheduled scan | No change | Open: where does the lead-time baseline come from? |
| \#14 Triage | Classify → appends steps | Any unmatched event | No change | Evidence, no diff, until classified |
| \#15 Post-ack rejection | \[decision: push back | accept closure\] → push back \[send, edit: mark exception\]; accept \[send, todo: cancel in ERP, edit\] | Supplier email | Todo stays until phase-2 write-back | Concrete counter re-enters as \#9 |
| \#16 Contact bounce | \[edit, send?\] | NDR / auto-reply | No change | Update contact; optional re-send |
| \#17 MRP reschedule (NEW) | \[decision: act | dismiss\] → act \[send: drafted supplier email, todo: update ERP, edit\] | ERP MRP read (API) · weekly MRP CSV drop (interim) | Native here — without ERP this scenario exists only via the CSV drop | Move-in / move-out / cancel recommendations not yet sent to the supplier |

Not tickets: receipts, vendor bills, and SOR→ERP write-back are adapter-layer syncs. §1 scope amendment: tickets govern human-mediated, email-derived facts; adapter syncs write directly.

| Scenario | Pipeline (steps) | Notes |
| :---- | :---- | :---- |
| \#1 PO creation | `[edit]` | sets owner, seeds subscribers (§6); auto-approve candidate later |
| \#2 Full acknowledgement | `[edit]` |  |
| \#3 Partial acknowledgement | `[edit]` | unconfirmed lines stay "unacknowledged" (no "deferred" state); \#11 chases them |
| \#4 Pre-ack modification | `[decision: agree | push back]` → agree `[send, todo: update ERP, edit]`; push back `[send]` |  |
| \#5 Whole-PO rejection | `[decision: accept | push back]` → accept `[send, todo: cancel in ERP, edit]`; push back `[send]` |  |
| \#6 Line update | `[edit, send?]` | send \= re-acknowledgement request (optional); reverts lines to unacknowledged, may supersede an open ack (§4) |
| \#7 Line cancellation | `[edit, send]` | send \= confirm cancellation; closes open tickets on affected lines (§4) |
| \#8 Whole-PO cancellation | `[edit, send]` | send \= confirm cancellation; withdraws open tickets on the PO (§4) |
| \#9 Exception w/ counter | `[decision: accept | hold]` → accept `[send, todo: update ERP, edit]`; hold `[send, edit: mark "exception"]` |  |
| \#10 ASN | `[edit, send?]` | send only if an expedite email is needed |
| \#11, \#12 Chases | `[send]` |  |
| \#13 Weekly lead-time | `[send]`; "on track" reply → `[edit]` log ticket | all human-approved |
| \#14 Unmatched email | Triage → appends steps | evidence, no diff, until classified/linked |
| \#15 Post-ack rejection (no counter) | `[decision: push back | accept closure]` → push back `[send, edit: mark "exception"]`; accept `[send, todo: cancel in ERP, edit]` | supplier reply with a concrete new date/qty re-enters as \#9 |
| \#16 Contact bounce | `[edit, send?]` | update supplier contact; optional re-send of the bounced message |

## 8\. Ticket Creation Scenarios

> Each scenario is an **event** the agent turns into a ticket whose **step pipeline is computed from the situation** — not a fixed "ticket type." The **Pipeline** line shows the typical shape in `edit` / `send` / `decision` / `todo` steps (Ticket Model §2); branches (`|`) and optional steps (`?`) mean the actual pipeline depends on the data and the human's choices. Scenarios sharing an **Event family** are the same underlying pipeline in different situations. Every ticket is resolved in one session and all its SOR writes are held and applied together at a single commit (Ticket Model §2.2–§2.3). A ticket ends **accepted** (its effects applied — including "push back" branches) or **closed** (with a reason). There is no "rejected": a wrong proposal is corrected on the spot and accepted, not declined (Ticket Model §3).

### Scenario \#1: PO Creation

**Event family:** ERP-originated PO fact (with \#6, \#7, \#8) · **Pipeline:** `[edit]`

#### Triggers

ERP sends out PO email to supplier

#### Means of Discovery

1. Buyer inbox gets CCed on the new PO email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox gets CCed on the new PO email. IT sets up this CC association. Scout email processing picks up this event  
3. **\[If ERP Integration is Available\]** ERP directly calls our API endpoint to transmit new PO information.

>   
> **Deduplication (applies to every multi-channel scenario — \#1, \#6, \#7, \#8):** these channels double-fire, so the same PO fact arrives two or three times. Ingestion collapses them into one ticket by (PO, event type, content); the authoritative ERP-API copy is kept and the CC'd emails attach as evidence. See Ticket Model §5.

#### Ticket Structure

* Title: New PO PO-XXXX  
* Available Info:  
  * Supplier Name  
  * PO Number  
  * Creation Date  
  * Total value  
  * \# of line items  
* Line-level Info:  
  * Part name  
  * Part code  
  * Part spec  
  * Quantity  
  * Need-by date  
* Suggested Action:  
  * Create a new PO record with clear associated PO lines  
  * Set the PO initial status to “unacknowledged”  
  * If any parsed value is off (email-sourced POs), the human corrects it on the spot and accepts — a fact ticket is never declined (Ticket Model §3).

#### On Commit:

* **Notification:** All buyers in the tenant should be notified that there is a new PO — literally every buyer. New-PO creation is the one tenant-wide broadcast; every later event on this PO goes only to its subscribers \+ owner (see Ticket Model §6).  
* **Ownership:** Set the PO owner by precedence — ERP buyer code if available, otherwise the org's default owner. Ownership is **not** assigned to whoever approves this ticket.  
* **Subscribers:** Seed the PO's subscriber list from any CC'd buyers (best-effort identity match).  
* **Evidence:** Attach PO email and the original PDF to the PO

### Scenario \#2: Full PO Acknowledgement

**Event family:** Supplier acknowledges (with \#3) · **Pipeline:** `[edit]`

#### Triggers

1. Supplier responds to the PO email that they can ship it by the need-by date  
   (same email thread)  
2. Supplier emails the buyer that one or more PO can be shipped on time.  
   (new email thread)

#### Means of Discovery

1. Buyer inbox receives the acknowledgement email. Email Integration sends a Webhook event to Scout.  
2. Scout email directly receives the acknowledgement email.Scout email processing picks up this event

>   
> **Fan-out (A6):** one email may acknowledge several POs (and mix intents — e.g. ack some lines, raise an exception on others). Ingestion splits it into **one ticket per (PO, intent)**, each linking back to the shared source email; the ticket structure below describes a single such ticket. See Ticket Model §5.

#### Ticket Structure

* Title: PO-XXXX is acknowledged  
* Available Information:  
  * PO Number  
  * Supplier name  
  * Sender email address  
  * \# of line item  
* Suggested Action:  
  * Turn a PO and all of its lines into “acknowledged”

#### On Commit:

* **Notification:** Notify the PO's subscribers \+ owner that PO-XXXX is acknowledged — not all buyers (only new-PO creation broadcasts tenant-wide; see Ticket Model §6).  
* **Evidence:** Attach PO acknowledgement email to the PO

### Scenario \#3: Partial PO Acknowledgement

**Event family:** Supplier acknowledges (with \#2) · **Pipeline:** `[edit]`

#### Trigger

Supplier responds to the PO email that they can ship some items by the need by date, some they need to check again

#### Means of Discovery

1. Buyer inbox receives the partial acknowledgement email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox directly receives the partial acknowledgement email. Scout email processing picks up this event.

#### Ticket Structure

* Title: PO-XXXX is partially acknowledged  
* Available Information:  
  * PO Number  
  * Supplier name  
  * Sender email address  
  * No. of line items acknowledged  
  * No. of line items still unacknowledged  
* Line-level Info:  
  * Part code  
  * Quantity  
  * Need-by date  
  * Disposition: acknowledged vs. still unacknowledged  
  * Expected date for the supplier’s answer, if given (kept as info on the line — it does not create a distinct state)  
* Suggested Action:  
  * Turn the confirmed lines into “acknowledged”  
  * Leave the unconfirmed lines “unacknowledged”. There is **no separate “deferred” state** — an unconfirmed line is simply unacknowledged, and the Scenario \#11 proactive chase picks it up once it breaches the 48-hour window.

#### On Commit:

* **Notification:** Notify the PO's subscribers \+ owner that PO-XXXX is partially acknowledged, with the still-unacknowledged lines called out — not all buyers (see Ticket Model §6).  
* **Evidence:** Attach the partial acknowledgement email to the PO

### Scenario \#4: Suggested Modification Before Acknowledgement

**Event family:** Supplier proposes a change (with \#9) · **Pipeline:** `[decision: agree | push back]` → agree `[send, todo, edit]`; push back `[send]`

#### Trigger

Supplier responds to the PO email proposing changes (e.g. a different need-by date, quantity, or price) instead of acknowledging the PO as-is (same or new email thread)

#### Means of Discovery

1. Buyer inbox receives the modification email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox directly receives the modification email. Scout email processing picks up this event.

#### Ticket Structure

- Title: Supplier suggested modifications to PO-XXXX before acknowledgement  
- Available Information:  
  - PO Number  
  - Supplier name  
  - Sender email address  
  - Type of modification (need-by date / quantity / price)  
  - \# of line items affected  
- Line-level Info:  
  - Part code  
  - Original value vs. proposed value  
  - Supplier's reason (if given)  
- Suggested Action — a decision-step ticket (Ticket Model §2):  
  - **Decision step** — choose one:  
    - **Agree** → `[send: reply agreeing and ask for acknowledgement]`, `[todo: update the ERP]`, `[edit: apply the agreed values to the PO and lines]`. Marking the todo Done asserts the ERP is updated.  
    - **Push back** → `[send: don't agree, push for acknowledgement or rejection]` (no SOR change).  
  - The affected lines stay "unacknowledged" until commit. Nothing is written until the chosen branch's steps complete and the ticket commits (all writes apply together); abandoning mid-way recomputes the ticket fresh.

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified about the update.  
- **Evidence:** Attach the modification email to the PO

### Scenario \#5: Whole PO Rejection

**Event family:** Supplier rejects (with \#15) · **Pipeline:** `[decision: accept | push back]` → accept `[send, todo, edit]`; push back `[send]`

#### Trigger

Supplier responds to the PO email (or emails the buyer in a new thread) that they cannot fulfill the PO and reject it entirely

#### Means of Discovery

1. Buyer inbox receives the rejection email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox directly receives the rejection email. Scout email processing picks up this event.

#### Ticket Structure

- Title: PO-XXXX is rejected by supplier  
- Available Information:  
  - PO Number  
  - Supplier name  
  - Sender email address  
  - Rejection reason (if given)  
  - \# of line items  
- Suggested Action — a decision-step ticket (Ticket Model §2):  
  - **Decision step** — choose one:  
    - **Accept** → `[send: acknowledge the rejection, ask for the reason if not given]`, `[todo: cancel the PO in the ERP and re-source the parts]`, `[edit: turn the PO and all lines "rejected"]`. The todo's Done asserts the ERP change.  
    - **Push back** → `[send: ask the supplier to reconsider or propose alternative terms]` (no SOR change).  
  - Nothing is written until the chosen branch commits (all writes apply together); abandoning recomputes the ticket fresh.

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified that PO-XXXX is rejected, so re-sourcing can start.  
- **Evidence:** Attach the rejection email to the PO

### Scenario \#6: PO Line Quantity or Date Update

**Event family:** ERP-originated PO fact (with \#1, \#7, \#8) · **Pipeline:** `[edit, send?]` (send \= re-ack request)

#### Trigger

ERP sends out a PO change email to the supplier updating the quantity or need-by date of one or more PO lines.

#### Means of Discovery

1. Buyer inbox gets CCed on the change email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox gets CCed on the change email. Scout email processing picks up this event.  
3. **\[If ERP Integration is Available\]** ERP directly calls our API endpoint to transmit the change.

#### Ticket Structure

- Title: PO-XXXX line update  
- Available Information:  
  - PO Number  
  - Supplier name  
  - \# of line items changed  
  - New total value  
- Line-level Info:  
  - Part code  
  - Old quantity vs. new quantity  
  - Old need-by date vs. new need-by date  
- Suggested Action:  
  - Update the quantity / date on the affected PO lines in the SOR record  
  - Turn the affected lines back into "unacknowledged" (supplier needs to re-acknowledge the new quantities)  
  - \[Optional\] Draft a follow-up email to the supplier asking for re-acknowledgement of the changed lines

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified that the quantities changed and the lines await re-acknowledgement.  
- **Evidence:** Attach the change email and the updated PO PDF to the PO  
- **Open tickets:** Reverting a line to "unacknowledged" moots an open acknowledgement ticket on that line. Apply the survival test (Ticket Model §4) — recompute the ack to the surviving lines and close the original `superseded`, or `withdrawn` if nothing survives.

### Scenario \#7: PO Line Cancellation

**Event family:** ERP-originated PO fact (with \#1, \#6, \#8) · **Pipeline:** `[edit, send]` (send \= confirm cancellation)

#### Trigger

ERP sends out a PO change email to the supplier cancelling one or more PO lines (but not the whole PO)

#### Means of Discovery

1. Buyer inbox gets CCed on the cancellation email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox gets CCed on the cancellation email. Scout email processing picks up this event.  
3. **\[If ERP Integration is Available\]** ERP directly calls our API endpoint to transmit the change.

#### Ticket Structure

- Title: One or more lines of PO-XXXX are cancelled  
- Available Information:  
  - PO Number  
  - Supplier name  
  - \# of line items cancelled  
  - \# of line items remaining  
  - New total value  
- Line-level Info:  
  - Part code  
  - Quantity  
  - Line status before cancellation (unacknowledged / acknowledged)  
- Suggested Action:  
  - Turn the cancelled lines into "cancelled" in the SOR record  
  - Leave the remaining lines' status unchanged  
  - Draft an email to the supplier asking them to confirm the cancellation (especially for lines they had already acknowledged). Note that this is not asking for “acknowledgement of cancellation”. The system does not care about cancellation of lines acknowledged.

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified which lines are cancelled.  
- **Evidence:** Attach the cancellation email to the PO  
- **Open tickets:** Apply the survival test (Ticket Model §4) to every open ticket that touches a cancelled line. If the ticket still has surviving lines to act on (e.g. a partial acknowledgement covering other lines), recompute it to that scope and close the original `superseded`; if the cancellation leaves it nothing to do, close it `withdrawn:dominated-by` this ticket.

### Scenario \#8: Whole PO Cancellation

**Event family:** ERP-originated PO fact (with \#1, \#6, \#7) · **Pipeline:** `[edit, send]` (send \= confirm cancellation)

#### Trigger

ERP sends out a PO cancellation email to the supplier cancelling the entire PO

#### Means of Discovery

1. Buyer inbox gets CCed on the cancellation email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox gets CCed on the cancellation email. Scout email processing picks up this event.  
3. **\[If ERP Integration is Available\]** ERP directly calls our API endpoint to transmit the cancellation.

#### Ticket Structure

- Title: PO-XXXX is cancelled  
- Available Information:  
  - PO Number  
  - Supplier name  
  - \# of line items  
  - Cancellation reason (if given)  
- Suggested Action:  
  - Turn the PO and all of its lines into "cancelled" in the SOR record.  
  - Draft an email to the supplier asking them to confirm the cancellation.

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified that PO-XXXX is cancelled.  
- **Evidence:** Attach the cancellation email to the PO  
- **Open tickets:** The PO is dead, so nothing survives (Ticket Model §4). Close every other open ticket on this PO as `withdrawn:dominated-by` this cancellation (e.g. a pending acknowledgement, a line update awaiting re-ack). This cancellation stands as its own ticket; the withdrawn tickets stay on the PO timeline with their reason, not silently removed.

### Scenario \#9: PO Exception with Counter Offer

**Event family:** Supplier proposes a change (with \#4) · **Pipeline:** `[decision: accept | hold]` → accept `[send, todo, edit]`; hold `[send, edit]`

#### Trigger

After acknowledgement, supplier emails that they can no longer meet the acknowledged terms and proposes an alternative: a new date other than the acknowledged date, or a different quantity, asking the buyer to modify some PO lines

#### Means of Discovery

1. Buyer inbox receives the exception email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox directly receives the exception email. Scout email processing picks up this event.

#### Ticket Structure

- Title: Supplier raised an exception on PO-XXXX with a counter-proposal  
- Available Information:  
  - PO Number  
  - Supplier name  
  - Sender email address  
  - Exception type (date / quantity)  
  - \# of line items affected  
- Line-level Info:  
  - Part code  
  - Acknowledged value vs. counter-proposed value  
  - Supplier's reason (if given)  
- Suggested Action — a decision-step ticket (Ticket Model §2):  
  - **Decision step** — choose one:  
    - **Accept counter** → `[send: ask the supplier to confirm the updated commitment]`, `[todo: update the ERP]`, `[edit: affected lines return to "acknowledged" with the counter-proposed values]`. The todo's Done asserts the ERP change.  
    - **Hold terms** → `[send: hold the supplier to the acknowledged terms]`, `[edit: mark the affected lines "exception"]`.  
  - All writes in the chosen branch apply together at commit; nothing is written until then, and abandoning recomputes the ticket fresh.

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified, with the at-risk lines called out.  
- **Evidence:** Attach the exception email to the PO  
- **Loop handling (merges B5):** a supplier reply to an earlier push-back or hold draft (from \#4, \#5, or this scenario) that carries a *new* proposed change re-enters here as a fresh instance of this scenario — a new counter, a new decision. No separate "supplier reply" scenario is needed; the loop closes by recomputing a new Exception-with-counter (or, if the PO is not yet acknowledged, a fresh \#4). Each round is its own single-session ticket.

### Scenario \#10: Advanced Shipping Notice

**Event family:** Supplier ships (ASN) · **Pipeline:** `[edit, send?]` (send \= expedite, only if late)

#### Trigger

Supplier emails an advanced shipping notice (ASN) that some or all lines of a PO have shipped, typically including ship date, carrier, tracking number, and packing list (same or new email thread)

#### Means of Discovery

1. Buyer inbox receives the ASN email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox directly receives the ASN email. Scout email processing picks up this event.

#### Ticket Structure

- Title: Shipment notice received for PO-XXXX  
- Available Information:  
  - PO Number  
  - Supplier name  
  - Sender email address  
  - Ship date  
  - Carrier and tracking number  
  - Expected delivery date  
  - \# of line items shipped  
- Line-level Info:  
  - Part code  
  - Quantity shipped vs. quantity ordered (flag partial shipments)  
  - Expected delivery date vs. need-by date (flag late lines)  
- Suggested Action:  
  - Turn the fully shipped lines into "shipped"; record the shipped quantity on partially shipped lines  
  - Record carrier, tracking number, and expected delivery date on the PO  
  - If the expected delivery date misses the need-by date on any line, draft an email to the supplier asking to expedite

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified that lines have shipped, with any late or partially shipped lines called out.  
- **Evidence:** Attach the ASN email (and packing list, if attached) to the PO

### Scenario \#11: Proactive PO Acknowledgement Request

**Event family:** Proactive chase (with \#12, \#13) · **Pipeline:** `[send]`

#### Trigger

A PO has one or more lines sitting in "unacknowledged" for more than 48 hours since the PO email was sent (and no acknowledgement request is already pending)

#### Means of Discovery

1. Scout's scheduled scan of the SOR finds POs breaching the 48-hour acknowledgement threshold. One ticket is raised per PO.

#### Ticket Structure

- Title: Request acknowledgement of PO-XXXX from supplier  
- Available Information:  
  - PO Number  
  - Supplier name  
  - Supplier contact email  
  - PO sent date and time elapsed since  
  - \# of unacknowledged line items  
- Line-level Info:  
  - Part code  
  - Quantity  
  - Need-by date  
- Suggested Action:  
  - Send the drafted acknowledgement request email (draft attached to the ticket, editable before commit) to the supplier contact  
  - Record "acknowledgement requested" with a timestamp on the PO. A PO counts as **already pending** — and is not re-chased — if it has an open (not-yet-accepted) chase ticket **or** a "requested" timestamp inside the current 48-hour window (Ticket Model §5, open-ticket suppression). Checking the timestamp alone would let the daily scan re-raise a chase every day while the first ticket sits unapproved.

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified that the acknowledgement chase was sent.  
- **Evidence:** Attach the sent request email to the PO

### Scenario \#12: Proactive ASN Request

**Event family:** Proactive chase (with \#11, \#13) · **Pipeline:** `[send]`

#### Trigger

A PO line is within 48 hours of its need-by date and no ASN covers its full quantity (and no ASN request is already pending)

#### Means of Discovery

Scout's scheduled scan of the SOR finds lines where need-by date minus current time ≤ 48 hours and ASN-covered quantity \< ordered quantity. One ticket is raised per PO, covering all such lines.

#### Ticket Structure

- Title: Request shipping notice for PO-XXXX from supplier  
- Available Information:  
  - PO Number  
  - Supplier name  
  - Supplier contact email  
  - Earliest need-by date at risk  
  - \# of line items missing an ASN  
- Line-level Info:  
  - Part code  
  - Quantity ordered vs. quantity covered by ASN (if partially shipped)  
  - Need-by date  
  - Line status  
- Suggested Action:  
  - Send the drafted ASN request email (draft attached to the ticket, editable before commit) asking for ship confirmation, carrier, and tracking number for the listed lines  
  - Record "ASN requested" with a timestamp on the affected lines. As in Scenario \#11, a line counts as **already pending** — and is not re-chased — if it has an open (not-yet-accepted) ASN-chase ticket **or** an "ASN requested" timestamp inside the current window (Ticket Model §5, open-ticket suppression), not the timestamp alone.

#### On Commit:

- **Notification:** The PO's subscribers \+ owner (Ticket Model §6) should be notified that the ASN request was sent, with the at-risk lines called out.  
- **Evidence:** Attach the sent request email to the PO

### Scenario \#13: Proactive Leadtime Confirmation

**Event family:** Proactive chase (with \#11, \#12) · **Pipeline:** `[send]`; "on track" reply → `[edit]` log ticket

#### Trigger

Weekly schedule (Friday morning): a supplier has outstanding PO lines (acknowledged but not yet fully shipped/delivered)

#### Means of Discovery

1. Scout's weekly scheduled job queries the SOR for all outstanding PO lines, grouped by supplier. One ticket is raised per supplier per week.

#### Ticket Structure

- Title: Weekly lead time confirmation for \[Supplier\] (week of YYYY-MM-DD)  
- Available Information:  
  - Supplier name  
  - Supplier contact email  
  - \# of open POs  
  - \# of outstanding line items  
- Line-level Info (the table sent to the supplier):  
  - PO Number  
  - Part code  
  - Outstanding quantity  
  - Acknowledged / need-by date  
  - Line status  
- Suggested Action:  
  - Send the drafted weekly email (draft attached to the ticket, editable before commit) containing the table of outstanding lines, asking the supplier to confirm everything is on track or flag any risks  
  - Record "leadtime confirmation sent" with a timestamp on the included lines

#### On Commit:

- **Notification:** The subscribers \+ owner of the included POs (Ticket Model §6) should be notified that the weekly confirmation was sent.  
- **Evidence:** Attach the sent email to each PO included in the table  
- **Reply handling:** "all on track" → an `[edit]` ticket logging the confirmation on the included lines (human-approved, per A4/A7); any flagged problem → raises a Scenario \#9 exception ticket

### Scenario \#14: Unmatched / Unparseable Email (Triage)

**Event family:** Triage · **Pipeline:** Triage → appends steps once classified/linked

#### Trigger

An inbound email cannot be confidently matched to a PO or parsed into a known intent: unknown or ambiguous PO number, low-confidence extraction, or an off-topic / spam message.

#### Means of Discovery

1. Buyer inbox or Scout inbox receives the email; Scout email processing cannot produce a confident structured proposal, so it falls through to Triage (Ticket Model §2.6, §5 fallback).

#### Ticket Structure

- Title: Needs triage — unmatched email from \[sender\]  
- Available Information:  
  - Sender email address  
  - Subject line  
  - Best-guess PO number(s) with confidence, if any  
  - Reason it couldn't be auto-handled (no match / ambiguous / low confidence / off-topic)  
- Suggested Action — a **Triage** ticket (a pipeline that isn't known yet; Ticket Model §2.6):  
  - Present the email as evidence with no diff.  
  - The human classifies or links it: pick the correct PO (resolving ambiguity) and/or the intent, which **appends the appropriate steps** (e.g. an `[edit]` acknowledgement, a `[decision]` exception) that then get accepted; or, if it's spam/off-topic, **close it `dismissed`** with the email filed as evidence (no write). A dismissed event is recorded so ingestion won't re-raise it (Ticket Model §3, §5).

#### On Commit:

- **Notification:** the resolving buyer; once linked to a PO, that PO's subscribers \+ owner (Ticket Model §6).  
- **Evidence:** attach the email; once linked, attach it to the PO.

### Scenario \#15: Post-Acknowledgement Rejection (No Counter-Offer)

**Event family:** Supplier rejects (with \#5) · **Pipeline:** `[decision: push back | accept closure]` → push back `[send, edit]`; accept `[send, todo, edit]`

#### Trigger

After acknowledgement, the supplier says they can no longer fulfill one or more lines (or the whole PO) and offers **no alternative** — no new date, no counter quantity. (Distinct from \#9, which carries a counter-proposal.)

#### Means of Discovery

1. Buyer inbox receives the email. Email Integration sends a Webhook event to Scout.  
2. Scout inbox directly receives the email. Scout email processing picks up this event.

#### Ticket Structure

- Title: Supplier can no longer meet PO-XXXX (no counter-offer)  
- Available Information:  
  - PO Number  
  - Supplier name  
  - Sender email address  
  - Reason (if given)  
  - \# of line items affected  
- Line-level Info:  
  - Part code  
  - Acknowledged value  
  - Line status  
- Suggested Action — a decision-step ticket (Ticket Model §2):  
  - **Decision step** — choose one:  
    - **Push back** → `[send: ask the supplier to find a recovery date or reconsider]`, `[edit: mark the affected lines "exception"]` (flag them at-risk; no cancellation yet).  
    - **Accept closure** → `[send: acknowledge they can't fulfill, ask the reason if not given]`, `[todo: cancel/close the lines in the ERP and re-source]`, `[edit: turn the affected lines "cancelled" — or the whole PO "rejected" if all lines are affected]`. The todo's Done asserts the ERP change.  
  - All writes in the chosen branch commit together; abandoning recomputes the ticket fresh. A later supplier reply with a concrete new date/quantity re-enters as a \#9 (Exception with counter).

#### On Commit:

- **Notification:** the PO's subscribers \+ owner, with the at-risk or closed lines called out (Ticket Model §6).  
- **Evidence:** attach the email to the PO.

### Scenario \#16: Chase Email Bounce / Wrong Supplier Contact

**Event family:** Delivery failure · **Pipeline:** `[edit, send?]` (edit \= fix contact; send \= re-send bounced message)

#### Trigger

An outbound email — a chase (\#11–\#13) or a reply — bounces, or an auto-reply indicates the contact has left or is invalid.

#### Means of Discovery

1. A bounce / non-delivery notification (NDR) or auto-reply returns to the sending inbox (buyer or Scout). Scout email processing detects the delivery failure and links it to the original outbound message and its PO(s).

#### Ticket Structure

- Title: Supplier contact for PO-XXXX bounced — update contact  
- Available Information:  
  - PO Number(s) affected  
  - Supplier name  
  - Failed contact email \+ bounce reason (hard bounce / left company / mailbox full)  
  - The original outbound message that failed  
- Suggested Action — an `[edit]` (+ optional `[send]`) ticket (Ticket Model §2.4):  
  - `[edit: update the supplier contact on the affected PO(s) / supplier record]` with the corrected address the human supplies.  
  - `[send: re-send the bounced message to the corrected contact]` (optional; fires on commit).  
  - If no correct contact is known, the human escalates or leaves a note rather than guessing — the bounced chase does not silently fail forever.

#### On Commit:

- **Notification:** the subscribers \+ owner of the affected PO(s) (Ticket Model §6).  
- **Evidence:** attach the bounce notice and the original message.

