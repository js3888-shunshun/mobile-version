# Mobile Ticket & Notification System

A mobile POC for organization-scoped ticket CRUD with real-time cross-device sync and push notifications. Built with Expo SDK 57 + React Native + Fastify in a pnpm monorepo.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [Environment Configuration](#3-environment-configuration)
4. [PostgreSQL Setup](#4-postgresql-setup)
5. [EAS / Expo Setup](#5-eas--expo-setup)
6. [Build & Install on iPhone](#6-build--install-on-iphone)
7. [Run Locally (Development Mode)](#7-run-locally-development-mode)
8. [Testing on a Second Device](#8-testing-on-a-second-device)
9. [Project Structure](#9-project-structure)
10. [Common Issues](#10-common-issues)

---

## 1. Prerequisites

You need the following installed on your machine:

| Tool | Version | How to check | Install |
|---|---|---|---|
| Node.js | 22+ | `node -v` | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | 9+ | `pnpm -v` | `npm install -g pnpm@latest` |
| Docker | any | `docker --version` | [docker.com](https://docker.com) (or use an existing PostgreSQL instance) |
| EAS CLI | latest | `eas --version` | `npm install -g eas-cli` |

You also need these **accounts**:

- **Expo account** (free) — sign up at [expo.dev](https://expo.dev/signup)
- **Apple Developer account** ($99/year) — enroll at [developer.apple.com](https://developer.apple.com/develop/)  
  *Required to build and install the app on a physical iPhone.*

### Why not Expo Go?

Expo Go has been stuck in App Store review for several releases and is not available for SDK 57. The only way to run the app on a physical iPhone is via an EAS Development Build. The sections below walk through this process step by step.

---

## 2. Clone & Install

```bash
git clone https://github.com/js3888-shunshun/mobile-version.git
cd mobile-version
pnpm install
```

`pnpm install` will automatically run a `postinstall` script that patches two dependencies (`@expo/cli` and `react-native-css-interop`) to fix a compatibility bug with Metro's bundler. You should see output like:

```
[patch] PATCHED: metroVirtualModules.js
[patch] PATCHED: index.js
```

This is normal and expected.

---

## 3. Environment Configuration

Two `.env` files are needed.

### 3.1 Root `.env` — Server / Database

Create a file at the project root: `mobile-version/.env`

```bash
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<dbname>
BETTER_AUTH_SECRET=<a random 64-character hex string>
BETTER_AUTH_URL=http://<your-server-ip>:4000
```

Example:

```bash
DATABASE_URL=postgres://tickets:password@localhost:5432/tickets_db
BETTER_AUTH_SECRET=d4448ceb7a2a661188c38ac56e869f4ee4d7a4b325864820a02b5863c882c643
BETTER_AUTH_URL=http://192.168.1.100:4000
```

**Where to get these values:**

- `DATABASE_URL` — your PostgreSQL connection string. If you use the Docker setup in section 4, use `postgres://tickets:password@localhost:5432/tickets_db`.
- `BETTER_AUTH_SECRET` — generate one: `openssl rand -hex 32`
- `BETTER_AUTH_URL` — your machine's LAN IP + port 4000. Find your IP with: `hostname -I | awk '{print $1}'`

### 3.2 Mobile `.env` — Expo API URL

Create a file at: `mobile-version/apps/mobile/.env`

```bash
EXPO_PUBLIC_API_URL=http://<your-server-ip>:4000
```

Example:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.100:4000
```

> **Important:** `EXPO_PUBLIC_API_URL` must be your machine's LAN IP (not `localhost`), because the phone connects from outside the machine. Use `hostname -I | awk '{print $1}'` to find it.

### 3.3 EAS Build Credentials (for building to device)

Create a file at `~/.eas-build-env` (or anywhere convenient; you'll `source` it before building):

```bash
export EXPO_TOKEN=<your-expo-access-token>
export EXPO_APPLE_API_KEY_ID=<your-apple-key-id>
export EXPO_APPLE_API_KEY_ISSUER_ID=<your-apple-issuer-id>
export EXPO_APPLE_API_KEY_FILE_PATH=/absolute/path/to/AuthKey_XXXXXX.p8
```

**Where to get these values:**

1. **EXPO_TOKEN** — go to [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens), click "Create Token", copy it.
2. **Apple API Key** — go to [App Store Connect → Users and Access → Integrations → API Keys](https://appstoreconnect.apple.com/access/api), create a new key with **Developer** access. Download the `.p8` file and note the **Key ID** and **Issuer ID**.
3. Put the `.p8` file somewhere permanent (e.g., `~/.appstore/AuthKey_XXXXXX.p8`) and point `EXPO_APPLE_API_KEY_FILE_PATH` to it.

Before any EAS build command, run:

```bash
source ~/.eas-build-env
```

---

## 4. PostgreSQL Setup

You have two options.

### Option A: Docker (recommended for local dev)

Create a `docker-compose.yml` at the project root:

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: password
      POSTGRES_DB: tickets_db
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Then:

```bash
docker compose up -d
```

### Option B: Existing PostgreSQL instance

Make sure your `DATABASE_URL` in `.env` points to it, and the database + user already exist. The server will create tables automatically on first run (via Drizzle ORM).

---

## 5. EAS / Expo Setup

Login to your Expo account from the terminal:

```bash
eas login
```

It will open a browser — sign in with your Expo account. Verify you're logged in:

```bash
eas whoami
```

Create the Expo project (first time only):

```bash
cd apps/mobile
eas init --id <your-expo-project-id>
```

> If you've already created a project at [expo.dev](https://expo.dev), find the project ID in the project dashboard and use that. If not, `eas init` will create one for you.

---

## 6. Build & Install on iPhone

This is the **first thing you should do** after setup. The EAS build creates a development client `.ipa` that you install on your phone. Later, when you run the app, it will connect back to your local Metro dev server to load the JavaScript bundle.

The build happens on Expo's servers and takes **10–20 minutes**.

### 6.1 Get Your iPhone UDID

On your iPhone, open **Safari** and go to:

```
https://udid.tech
```

1. Tap "Tap to Get Your UDID".
2. Tap "Allow" to download the configuration profile.
3. Open **Settings** → you'll see "Profile Downloaded" at the top. Tap it.
4. Tap "Install" → enter your passcode → "Install" again → "Done".
5. Safari will now display your UDID (a long hex string like `00008110-XXXXXXXX`).
6. Copy it — you'll need it in the next step.

### 6.2 Register Your Device

```bash
cd apps/mobile
source ~/.eas-build-env
eas device:create
```

Follow the prompts:

| Prompt | Your input |
|---|---|
| Use the `<your-expo-account>` account? | `y` |
| Apple ID | Your Apple Developer email |
| Password | Your Apple ID password |
| How would you like to register? | Choose **Input** (type UDIDs manually) |
| UDID | Paste the UDID from step 6.1 |
| Device name | Any name, e.g. `My iPhone` |
| Device class | Choose **iPhone** |
| Is this what you want? | `y` |
| Register another? | `n` |

### 6.3 Build the App

```bash
source ~/.eas-build-env
eas build --platform ios --profile development
```

EAS will upload your code and start building. When prompted **"Would you like to choose the devices to provision again?"** → choose `y`, then use **Space** to select your device (◉), and **Enter** to confirm.

You can close the terminal — the build happens on Expo's servers. To check progress:

```bash
eas build:list
```

### 6.4 Install on Your Phone

When the build completes, you'll see a QR code and a link. Open your iPhone Camera app, scan the QR code, and tap the notification to install.

If you get **"This app cannot be installed because its integrity could not be verified"**:

- Your device UDID was not included in the provisioning profile. Re-run `eas device:create` to make sure the device is registered, then rebuild.

After installation, the first launch will fail — iOS blocks unverified enterprise apps. Go to:

**Settings → General → VPN & Device Management → (your Apple Developer name) → Trust**

Then open the app again. It will show the dev client launcher screen — this is normal. It's waiting for a Metro dev server to connect to (next section).

---

## 7. Run Locally (Development Mode)

> **Prerequisite:** You must have the development build installed on your phone (section 6) before this step.

Open **two terminal windows**. Both must stay running while you use the app.

### Terminal 1: Backend Server (port 4000)

```bash
cd apps/server
npx dotenv -e ../../.env -- npx tsx src/index.ts
```

If successful, you'll see:

```
{"level":30,"msg":"Server listening at http://0.0.0.0:4000"}
{"level":30,"msg":"server listening on http://0.0.0.0:4000"}
```

**Verify the server is reachable:**

```bash
curl http://localhost:4000/health
# → {"status":"ok","service":"mobile-version-server",...}
```

### Terminal 2: Expo Dev Server (port 8081)

```bash
cd apps/mobile
EXPO_NO_METRO_WORKSPACE_ROOT=true npx expo start
```

After Metro finishes bundling, you'll see:

```
› Metro waiting on http://localhost:8081
```

This Metro dev server does **not** serve Expo Go. It serves the JavaScript bundle to the development build you installed in section 6.

### 7.1 Connect the App to Metro

1. Open the Mobile Tickets app on your iPhone.
2. If the dev client launcher appears, enter the Metro server URL: `exp://<your-ip>:8081` (e.g., `exp://192.168.1.100:8081`).
3. The app loads your JavaScript from Metro and you can sign up / log in.

> If the app crashes immediately on launch, check that both terminals are running and the phone can reach your machine's IP (same WiFi network, no firewall blocking port 8081).

---

## 8. Testing on a Second Device

To install the app on another iPhone (for multi-user push notification testing):

### 8.1 Register the second device

Get the second phone's UDID (same process as [6.1](#61-get-your-iphone-udid)), then:

```bash
cd apps/mobile
source ~/.eas-build-env
eas device:create
```

Enter the new UDID. If your original device is already registered, answer `y` when asked "Register another?" and enter the second UDID.

### 8.2 Rebuild

```bash
source ~/.eas-build-env
eas build --platform ios --profile development
```

When asked **"Would you like to choose the devices to provision again?"** → choose `y`. Use **Space** to select **both** devices (both should show ◉), then **Enter** to confirm.

### 8.3 Install on both phones

Scan the QR code on both devices. Each device will:

1. Install the app.
2. On first launch, request notification permission → **Allow**.
3. Register its push token with the server automatically.

### 8.4 Test push notifications

1. On Phone A, sign up / log in with user A.
2. On Phone B, sign up / log in with user B.
3. Make sure both users are in the **same organization**.
4. User A creates or edits a ticket → User B gets a push notification → tapping it navigates to the ticket.

---

## 9. Project Structure

```
mobile-version/
├── apps/
│   ├── server/           Fastify API server (port 4000)
│   │   └── src/
│   │       ├── index.ts      Ticket CRUD routes, auth, push-token endpoints
│   │       ├── auth.ts       better-auth configuration
│   │       └── push.ts       Expo push notification dispatch
│   └── mobile/           Expo SDK 57 + React Native
│       ├── app/              Expo Router screens
│       │   ├── (auth)/           Sign in / sign up
│       │   ├── (tabs)/           Ticket list, settings
│       │   └── ticket/           Create & detail/edit screens
│       ├── lib/
│       │   ├── api.ts           React Query hooks (useTickets, useCreateTicket, …)
│       │   ├── auth-client.ts   better-auth Expo client (SecureStore)
│       │   └── push.ts          Push token registration
│       ├── scripts/
│       │   └── patch-css-interop.js   Postinstall compatibility patch
│       └── metro.config.js      Metro bundler config (pnpm monorepo)
├── packages/
│   ├── db/               Drizzle ORM schemas (tickets, push_tokens, auth tables)
│   └── shared/           Shared TypeScript types (Ticket, Member)
├── .env                  Server environment (DATABASE_URL, secrets)
├── .npmrc                pnpm config (hoisted node_modules)
├── pnpm-workspace.yaml   Monorepo workspace definition
└── docker-compose.yml    PostgreSQL container
```

---

## 10. Common Issues

### "Cannot read properties of undefined (reading 'transformFile')"

The `postinstall` script in `apps/mobile/scripts/patch-css-interop.js` should patch this automatically. If you still see it, run the patch manually:

```bash
cd apps/mobile
node scripts/patch-css-interop.js
```

### 403 Missing Origin / "Missing or null Origin"

Already fixed in the code. The `api.ts` file now includes `Origin: mobileversion://` on all requests. If you see this, make sure you pulled the latest code.

### Port 8081 is already in use

```bash
kill $(lsof -t -i :8081)
```

Then re-run `npx expo start`.

### App crashes on launch (white screen + immediate crash)

- **iOS 26 beta** may have compatibility issues with Expo SDK 57. Try on a non-beta iOS version.
- Make sure `pnpm install` ran successfully and the postinstall patch was applied.
- Check that both Terminal 1 (server) and Terminal 2 (Expo) are running.
- The dev client needs to reach your machine's IP on port 8081 — same WiFi, no firewall.

### Push notifications not arriving

1. On the phone: **Settings → Mobile Tickets → Notifications → Allow Notifications** (must be ON).
2. Open the app, go to the ticket list. Check Terminal 1 server logs for: `[push] active push tokens found: 1` or more. If it says `0`, the device hasn't registered its push token — kill and reopen the app.
3. If you are the only user in the organization, check that the `sender exclusion` logic in `push.ts` is removed (line 30–32 should only have `eq(member.organizationId, orgId)` without `ne(member.userId, actorId)`).

### "DATABASE_URL is not set"

The server can't find the `.env` file. Make sure you use `npx dotenv -e ../../.env` (two levels up, relative to `apps/server/`):

```bash
cd apps/server
npx dotenv -e ../../.env -- npx tsx src/index.ts
```
