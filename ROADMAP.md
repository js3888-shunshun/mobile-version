# Mobile Ticket & Notification System — ROADMAP

A mobile POC for an organization-scoped ticket (todo) system with real-time sync
and push notifications. Built as a standalone pnpm monorepo connected to the shared
collab-table PostgreSQL instance.

## Infra

- **Project root**: `/root/mobile` (local dev)
- **GitHub**: [js3888-shunshun/mobile-version](https://github.com/js3888-shunshun/mobile-version)
- **Database**: Shared PostgreSQL 18 (collab-table Docker container `collab-postgres`, port 5432)
- **Server**: Fastify on port 4000 (pm2 in production)
- **Sync**: push to GitHub after each completed phase

## Architecture

```
mobile-version/  (pnpm monorepo)
├── apps/
│   ├── server/       Fastify + better-auth + ticket CRUD + push dispatch
│   └── mobile/       Expo SDK 56 + React Native + RN Reusables + NativeWind
├── packages/
│   ├── db/           Drizzle ORM (tickets, push_tokens + auth table mirrors)
│   └── shared/       Shared TypeScript types
```

- **Relational (Drizzle/Postgres, REST)**: tickets, push_tokens, user/org/member (shared with collab-table)
- **Auth**: better-auth with organization plugin — same `BETTER_AUTH_SECRET` as collab-table → shared sessions across both servers
- **Real-time sync**: TanStack React Query polling (15s) + Expo Push Notifications as instant trigger
- **Push**: Server-side `expo-server-sdk` dispatches to Expo Push API → FCM/APNs → device

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces |
| Backend | Fastify + TypeScript |
| ORM | Drizzle ORM + PostgreSQL 18 |
| Auth | better-auth (email/password) + organization plugin |
| Mobile | Expo SDK 56 + React Native 0.85 |
| Routing | Expo Router v4 (file-based) |
| Styling | NativeWind v4 + Tailwind CSS v3 |
| UI | React Native Reusables (shadcn/ui for RN) |
| Data fetching | TanStack React Query v5 |
| Push | expo-server-sdk + Expo Push API |

---

# Phases & Todos

## Phase 0 — Monorepo skeleton [IN PROGRESS]

- [ ] Root package.json, pnpm-workspace.yaml, .env, .npmrc, .gitignore
- [ ] packages/db: Drizzle ORM setup + schema (tickets, push_tokens, auth mirrors)
- [ ] packages/shared: shared TypeScript types
- [ ] apps/server: Fastify + better-auth handler + ticket CRUD routes
- [ ] **MILESTONE**: `pnpm install` clean; `pnpm --filter @mobile/db db:push` creates tables; `pnpm --filter @mobile/server dev` starts on :4000

## Phase 1 — Ticket CRUD API [ ]

- [ ] better-auth handler mounted on `/api/auth/*` (signup, login, session)
- [ ] `requireOrg` middleware — validates session + extracts active organization
- [ ] `GET /api/tickets` — list tickets for active org, ordered by createdAt
- [ ] `POST /api/tickets` — create ticket (description, status)
- [ ] `PATCH /api/tickets/:id` — update ticket (description, status); triggers push notification stub
- [ ] `DELETE /api/tickets/:id` — delete ticket
- [ ] `POST /api/push-token` — register device Expo push token
- [ ] `GET /api/members` — list org members (for client-side org info)
- [ ] **MILESTONE**: `curl` all endpoints with session cookie; CRUD works; tickets scoped to org

## Phase 2 — Expo Mobile App [ ]

- [ ] `npx create-expo-app` with blank TypeScript template
- [ ] Configure Metro for pnpm monorepo (watchFolders, symlinks, singleton pinning)
- [ ] Install NativeWind v4 + Tailwind CSS v3 + `tailwind.config.js` + `globals.css`
- [ ] Install React Native Reusables components (`rnr add button input card badge label textarea`)
- [ ] Auth screens: `(auth)/sign-in.tsx`, `(auth)/sign-up.tsx` with better-auth Expo client
- [ ] Tab layout: `(tabs)/_layout.tsx` — Tickets | Settings
- [ ] Ticket list screen `(tabs)/index.tsx` — FlatList with TicketCard components
- [ ] Create ticket screen `ticket/new.tsx` — TicketForm with description input + status picker
- [ ] Ticket detail/edit screen `ticket/[id].tsx` — edit description, change status
- [ ] Settings screen `(tabs)/settings.tsx` — user info, org name, logout
- [ ] `lib/auth-client.ts` — better-auth Expo client setup with SecureStore
- [ ] `lib/api.ts` — TanStack React Query hooks (useTickets, useCreateTicket, useUpdateTicket, useDeleteTicket) with 15s refetchInterval
- [ ] `lib/push.ts` — Expo push token registration (permissions + POST to server)
- [ ] **MILESTONE**: app launches; signup/login works; create/edit/delete tickets; list polls every 15s

## Phase 3 — Push Notifications [ ]

- [ ] `apps/server/src/push.ts` — `sendTicketNotification(orgId, ticketId, action)` dispatches via expo-server-sdk
- [ ] Hook into `POST /api/tickets` and `PATCH /api/tickets/:id` — call push dispatch after DB write
- [ ] Expo project setup: create project at expo.dev, get FCM/APNs credentials
- [ ] `app.config.ts` — notification settings (icon, color, sounds)
- [ ] Mobile notification listener — `addNotificationReceivedListener` → invalidate tickets query
- [ ] Notification tap handler — navigate to ticket detail screen
- [ ] Token lifecycle: re-register on app foreground; deactivate on `DeviceNotRegistered` receipts
- [ ] **MILESTONE**: User A updates ticket → User B receives push → taps → sees updated ticket

## Phase 4 — Polish & Ship [ ]

- [ ] Empty state UI (no tickets yet)
- [ ] Pull-to-refresh on ticket list
- [ ] Loading skeletons
- [ ] Error states with retry
- [ ] Optimistic updates for status changes
- [ ] Badge colors for ticket status (pending=yellow, approved=green, rejected=red)
- [ ] `.env.example` with placeholder values
- [ ] `README.md` with setup instructions
- [ ] **MILESTONE**: production-ready POC; push to GitHub with full README

---

## Notes / gotchas

- **pnpm + React Native**: `node-linker=hoisted` required for Metro compatibility.
- **Shared PostgreSQL**: We redeclare collab-table's auth tables in our Drizzle schema so better-auth works, but use `drizzle-kit push` to avoid recreating them.
- **Shared auth**: Both servers use the same `BETTER_AUTH_SECRET` + same DB → sessions are interoperable. A user registered on collab-table can log in on mobile.
- **Expo Go limitation**: better-auth OAuth requires a development build. Email/password auth works in Expo Go.
- **Push tokens**: Key by `(user_id, token)` for multi-device support; prune `DeviceNotRegistered` tokens.
- **Polling interval**: 15s is a good balance for a POC — keeps data fresh without hammering the server.
