# Mobile Ticket & Notification System — ROADMAP

A mobile POC for an organization-scoped ticket (todo) system with real-time sync
and push notifications. Built as a standalone pnpm monorepo connected to the shared
collab-table PostgreSQL instance.

> **Last updated**: 2026-07-17

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
│   └── mobile/       Expo SDK 57 + React Native + RN Reusables + NativeWind
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
| Backend | Fastify 5.10 + TypeScript |
| ORM | Drizzle ORM v0.45.2 + PostgreSQL 18 |
| Auth | better-auth v1.6.23 (email/password) + organization plugin |
| Mobile | Expo SDK 57 + React Native 0.86 + React 19.2.3 |
| Routing | Expo Router v5 (file-based) |
| Styling | NativeWind v4 + Tailwind CSS v3 |
| UI | React Native Reusables (shadcn/ui for RN, manual CVA components) |
| Data fetching | TanStack React Query v5 |
| Push | expo-server-sdk + Expo Push API |

---

# Phases & Todos

## Phase 0 — Monorepo skeleton [DONE] ✅

- [x] Root package.json, pnpm-workspace.yaml, .env, .npmrc, .gitignore
- [x] packages/db: Drizzle ORM setup + schema (tickets, push_tokens, auth mirrors)
- [x] packages/shared: shared TypeScript types
- [x] apps/server: Fastify + better-auth handler + ticket CRUD routes
- [x] **MILESTONE**: `pnpm install` clean; tables created in DB; server starts on :4000

## Phase 1 — Ticket CRUD API [DONE] ✅

- [x] better-auth handler mounted on `/api/auth/*` (signup, login, session)
- [x] `requireSession` + `requireOrg` middlewares — validates session + extracts active organization
- [x] `GET /api/me` — current user + session
- [x] `GET /api/tickets` — list tickets for active org, ordered by createdAt desc
- [x] `POST /api/tickets` — create ticket (description, status)
- [x] `PATCH /api/tickets/:id` — update ticket (description, status) with org-ownership check
- [x] `DELETE /api/tickets/:id` — delete ticket with org-ownership check
- [x] `POST /api/push-token` — register device Expo push token (upsert)
- [x] `DELETE /api/push-token` — deactivate push token
- [x] `GET /api/members` — list org members with user names/emails
- [x] **MILESTONE**: all endpoints tested via curl; CRUD works; tickets scoped to org

## Phase 2 — Expo Mobile App [DONE] ✅

- [x] `npx create-expo-app` with blank TypeScript template
- [x] Configure Metro for pnpm monorepo (watchFolders, symlinks, singleton pinning)
- [x] Install NativeWind v4 + Tailwind CSS v3 + `tailwind.config.js` + `globals.css`
- [x] Build UI components manually (button, input, card, badge, textarea, label) using CVA + tailwind-merge
- [x] Auth screens: `(auth)/sign-in.tsx`, `(auth)/sign-up.tsx` with better-auth Expo client
- [x] Tab layout: `(tabs)/_layout.tsx` — Tickets | Settings
- [x] Ticket list screen `(tabs)/index.tsx` — FlatList with TicketCard, pull-to-refresh, empty state
- [x] Create ticket screen `ticket/new.tsx` — description input + status selector badges
- [x] Ticket detail/edit screen `ticket/[id].tsx` — edit description, change status, approve, delete
- [x] Settings screen `(tabs)/settings.tsx` — user info, active org, logout
- [x] `lib/auth-client.ts` — better-auth Expo client setup with SecureStore
- [x] `lib/api.ts` — TanStack React Query hooks (useTickets, useCreateTicket, useUpdateTicket, useDeleteTicket) with 15s refetchInterval
- [x] `lib/push.ts` — Expo push token registration (permissions + POST to server)
- [x] `lib/org-store.ts` — zustand store for org state (avoids stale session cache issue)
- [x] `lib/debug.ts` — structured debug logging with emoji levels
- [x] `components/ErrorBoundary.tsx` — React error boundary for crash visibility
- [x] `components/Sidebar.tsx` — slide-out drawer with user info, org badge, nav links, logout
- [x] Test app on device via EAS dev client build (iOS)
- [x] Fix RNWorklets.framework dyld crash (buildFromSource + usePrecompiledModules: false)
- [x] Fix ATS dev server connectivity (NSAllowsArbitraryLoads for dev builds)
- [x] Fix better-auth ESM import (static import instead of require())
- [x] Fix 403 Missing Origin (add Origin header to all fetch calls)
- [x] Fix org name stuck on "Loading…" (zustand store + staleTime: 0)
- [x] Fix keyboard dismiss on auth and ticket pages
- [x] Fix back button safe area on ticket pages
- [x] Verify signup/login flow end-to-end
- [x] Verify ticket CRUD from mobile app
- [x] **MILESTONE**: app launches; signup/login works; create/edit/delete tickets; list polls every 15s

## Phase 3 — Push Notifications [IN PROGRESS] 🚧

- [x] `apps/server/src/push.ts` — `sendTicketNotification(orgId, ticketId, action)` with expo-server-sdk
- [x] Hook into `POST /api/tickets` and `PATCH /api/tickets/:id` — fire-and-forget push dispatch (verified: server logs show push triggered)
- [x] Mobile notification listener — `addNotificationReceivedListener` → invalidate tickets query on foreground
- [x] Notification tap handler — navigate to ticket detail screen via `router.push`
- [x] Push token registration — `registerForPushNotifications()` on mount, foreground, sign-in, sign-up, cold start
- [x] Server push-token endpoint — `POST /api/push-token` (upsert), `DELETE /api/push-token` (deactivate)
- [x] Enhanced push messages — actor name, ticket description, exclude sender from own notifications
- [x] DeviceNotRegistered token cleanup — auto-deactivate invalid tokens
- [x] Set all Cronwell member passwords to "test1234" for multi-user testing
- [x] Foreground notification received → tickets query invalidated → auto-refetch (verified end-to-end)
- [x] Fix `shouldShowAlert` deprecated → `shouldShowBanner` + `shouldShowList` (Expo SDK 57)
- [x] Fix emoji removal from push titles ("太AI了")
- [x] Fix `apiFetch` use `authClient.$fetch()` instead of raw `fetch()` (cookie passthrough)
- [x] Fix `useSession()` Proxy crash on Hermes → removed dependency, simplified NotificationProvider
- [x] Add session mismatch detection (compare `getSession()` vs `/api/me`)
- [x] Add AppState listener — re-register push token when app returns to foreground
- [ ] **BUG**: Server `requireOrg` always resolves to Joy Sun regardless of logged-in user (cookie mismatch)
- [ ] **BUG**: `active push tokens found: 0` — other members haven't registered push tokens
- [ ] Expo project setup: create project at expo.dev, get FCM/APNs credentials (for production builds)
- [ ] **MILESTONE**: multi-member real-time sync working — push delivered, tickets stay consistent

## Phase 4 — Polish & Ship [ ]

- [x] Empty state UI (no tickets yet) — shown in ticket list
- [x] Pull-to-refresh on ticket list
- [x] Badge colors for ticket status (pending=yellow, approved=green, rejected=red)
- [x] Error states with retry on ticket list
- [ ] Loading skeletons (currently using ActivityIndicator)
- [ ] Optimistic updates for status changes (e.g. approve button)
- [ ] `.env.example` with placeholder values
- [ ] `README.md` with setup instructions
- [ ] **MILESTONE**: production-ready POC; push to GitHub with full README

---

## Notes / gotchas

- **pnpm + React Native**: `node-linker=hoisted` required for Metro compatibility.
- **Shared PostgreSQL**: We redeclare collab-table's auth tables in our Drizzle schema so better-auth works. Tables created via raw SQL since `drizzle-kit push` needs TTY.
- **Shared auth**: Both servers use the same `BETTER_AUTH_SECRET` + same DB → sessions are interoperable. A user registered on collab-table can log in on mobile.
- **Expo Go limitation**: better-auth OAuth requires a development build. Email/password auth works in Expo Go.
- **Push tokens**: Key by `(user_id, token)` for multi-device support; prune `DeviceNotRegistered` tokens.
- **Polling interval**: 15s is a good balance for a POC — keeps data fresh without hammering the server.
- **Manual UI components**: `@react-native-reusables/cli` requires interactive TTY for `rnr add`, so components are built manually following the same pattern (CVA + tailwind-merge + clsx).
