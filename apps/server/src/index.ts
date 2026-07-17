import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  db,
  tickets,
  pushTokens,
  member,
  user,
  eq,
  and,
  inArray,
  desc,
} from "@mobile/db";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { sendTicketNotification } from "./push.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [
    "http://localhost:8081",
    "http://172.105.135.182:8081",
    "http://localhost:4000",
    "http://172.105.135.182:4000",
    "http://localhost:5173",
  ],
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
});

// ─── Health ────────────────────────────────────────────────────────────

app.get("/health", async () => ({
  status: "ok",
  service: "mobile-version-server",
  time: new Date().toISOString(),
}));

// ─── Better Auth handler ───────────────────────────────────────────────

app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const req = new Request(url.toString(), {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    const response = await auth.handler(req);
    reply.status(response.status);
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length) reply.header("set-cookie", setCookies);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
    });
    return reply.send(response.body ? await response.text() : null);
  },
});

// ─── Auth middleware ────────────────────────────────────────────────────

type AuthCtx = { userId: string; orgId: string };

async function requireSession(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
): Promise<{ userId: string } | null> {
  const s = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!s) {
    reply.status(401).send({ error: "unauthorized" });
    return null;
  }
  return { userId: s.user.id };
}

async function requireOrg(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
): Promise<AuthCtx | null> {
  const s = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!s) {
    reply.status(401).send({ error: "unauthorized" });
    return null;
  }
  const orgId = (s.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;
  if (!orgId) {
    reply.status(400).send({ error: "no active organization" });
    return null;
  }
  return { userId: s.user.id, orgId };
}

// ─── Me ────────────────────────────────────────────────────────────────

app.get("/api/me", async (request, reply) => {
  const s = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!s) return reply.status(401).send({ error: "unauthorized" });
  return { user: s.user, session: s.session };
});

// ─── Members (read from shared org/member tables) ──────────────────────

app.get("/api/members", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const rows = await db
    .select()
    .from(member)
    .where(eq(member.organizationId, ctx.orgId));

  const result: Array<{
    id: string;
    userId: string;
    role: string;
    name?: string;
    email?: string;
  }> = [];
  for (const m of rows) {
    const u = await db
      .select()
      .from(user)
      .where(eq(user.id, m.userId))
      .then((r) => r[0]);
    result.push({
      id: m.id,
      userId: m.userId,
      role: m.role,
      name: u?.name,
      email: u?.email,
    });
  }
  return result;
});

// ─── Tickets CRUD ──────────────────────────────────────────────────────

// List tickets for the active organization
app.get("/api/tickets", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  return db
    .select()
    .from(tickets)
    .where(eq(tickets.orgId, ctx.orgId))
    .orderBy(desc(tickets.createdAt));
});

// Create a ticket
app.post("/api/tickets", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const body = request.body as { description?: string; status?: string };
  const description = (body?.description ?? "").trim();
  if (!description) {
    return reply.status(400).send({ error: "description required" });
  }

  const [ticket] = await db
    .insert(tickets)
    .values({
      orgId: ctx.orgId,
      description,
      status: body?.status ?? "pending",
      createdBy: ctx.userId,
    })
    .returning();

  // Fire push notification (don't block response)
  sendTicketNotification(ctx.orgId, ticket.id, "created", ctx.userId).catch((err) =>
    app.log.error(err, "push notification failed"),
  );

  return reply.status(201).send(ticket);
});

// Update a ticket
app.patch("/api/tickets/:id", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const { id } = request.params as { id: string };
  const body = request.body as { description?: string; status?: string };

  // Verify ticket exists and belongs to this org
  const [existing] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, id));
  if (!existing) return reply.status(404).send({ error: "ticket not found" });
  if (existing.orgId !== ctx.orgId)
    return reply.status(403).send({ error: "forbidden" });

  const set: Record<string, unknown> = {};
  if (body?.description !== undefined) set.description = body.description.trim();
  if (body?.status !== undefined) set.status = body.status;
  if (Object.keys(set).length === 0)
    return reply.status(400).send({ error: "no fields to update" });

  const [updated] = await db
    .update(tickets)
    .set(set)
    .where(eq(tickets.id, id))
    .returning();

  // Fire push notification (don't block response)
  sendTicketNotification(ctx.orgId, id, "updated", ctx.userId).catch((err) =>
    app.log.error(err, "push notification failed"),
  );

  return updated;
});

// Delete a ticket
app.delete("/api/tickets/:id", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const { id } = request.params as { id: string };

  const [existing] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, id));
  if (!existing) return reply.status(404).send({ error: "ticket not found" });
  if (existing.orgId !== ctx.orgId)
    return reply.status(403).send({ error: "forbidden" });

  await db.delete(tickets).where(eq(tickets.id, id));
  return reply.status(204).send();
});

// ─── Push Token Registration ───────────────────────────────────────────

app.post("/api/push-token", async (request, reply) => {
  const ctx = await requireSession(request, reply);
  if (!ctx) return;

  const body = request.body as { token?: string; platform?: string };
  const token = (body?.token ?? "").trim();
  if (!token) return reply.status(400).send({ error: "token required" });

  // Upsert — activate if exists, insert if new
  await db
    .insert(pushTokens)
    .values({
      userId: ctx.userId,
      token,
      platform: body?.platform ?? null,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { isActive: true, userId: ctx.userId, updatedAt: new Date() },
    });

  return reply.status(200).send({ ok: true });
});

// Deactivate a push token
app.delete("/api/push-token", async (request, reply) => {
  const ctx = await requireSession(request, reply);
  if (!ctx) return;

  const body = request.body as { token?: string };
  const token = (body?.token ?? "").trim();
  if (!token) return reply.status(400).send({ error: "token required" });

  await db
    .update(pushTokens)
    .set({ isActive: false })
    .where(eq(pushTokens.token, token));

  return reply.status(200).send({ ok: true });
});

// ─── Start ─────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`server listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
