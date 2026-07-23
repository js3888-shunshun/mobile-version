import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import {
  db,
  tickets,
  ticketKinds,
  ticketEvidence,
  ticketWritePos,
  purchaseOrders,
  poLines,
  pushTokens,
  emailMessages,
  member,
  user,
  organization,
  notifications,
  ingestionEvents,
  auditLog,
  outboundLog,
  eq,
  ne,
  and,
  inArray,
  desc,
  isNull,
  sql,
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

// ─── Swagger ────────────────────────────────────────────────────────────────

await app.register(swagger, {
  openapi: {
    info: {
      title: "Ticket System API",
      description: "Mobile-version ticket server — create, inspect, commit, and close tickets.",
      version: "2.0.0",
    },
    servers: [{ url: "http://172.105.135.182:4000", description: "Production" }],
  },
});

await app.register(swaggerUI, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: true,
  },
});

// ─── Health ────────────────────────────────────────────────────────────────

app.get("/health", async () => ({
  status: "ok",
  service: "mobile-version-server",
  time: new Date().toISOString(),
}));

// ─── Better Auth helper ──────────────────────────────────────────────────────

async function handleAuthRequest(request: any, reply: any) {
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
  response.headers.forEach((value: string, key: string) => {
    if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
  });
  const body = response.body ? await response.text() : null;
  try { return body ? JSON.parse(body) : null; } catch { return body; }
}

// ─── Explicit auth routes (documented for Swagger) ──────────────────────────

app.post("/api/auth/sign-in/email", {
  schema: {
    description: "Sign in with email and password",
    tags: ["auth"],
    body: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", format: "email" },
        password: { type: "string" },
        rememberMe: { type: "boolean" },
      },
    },
  },
}, async (request, reply) => handleAuthRequest(request, reply));

app.post("/api/auth/sign-up/email", {
  schema: {
    description: "Create a new account",
    tags: ["auth"],
    body: {
      type: "object",
      required: ["email", "password", "name"],
      properties: {
        email: { type: "string", format: "email" },
        password: { type: "string" },
        name: { type: "string" },
      },
    },
  },
}, async (request, reply) => handleAuthRequest(request, reply));

app.post("/api/auth/sign-out", {
  schema: {
    description: "Sign out the current session",
    tags: ["auth"],
  },
}, async (request, reply) => handleAuthRequest(request, reply));

app.get("/api/auth/session", {
  schema: {
    description: "Get the current session",
    tags: ["auth"],
  },
}, async (request, reply) => handleAuthRequest(request, reply));

app.get("/api/auth/organization/list", {
  schema: {
    description: "List organizations for the current user",
    tags: ["auth"],
  },
}, async (request, reply) => handleAuthRequest(request, reply));

app.post("/api/auth/organization/set-active", {
  schema: {
    description: "Set the active organization for this session",
    tags: ["auth"],
    body: {
      type: "object",
      required: ["organizationId"],
      properties: {
        organizationId: { type: "string", description: "The org ID from GET /api/auth/organization/list" },
      },
    },
  },
}, async (request, reply) => handleAuthRequest(request, reply));

// ─── Better Auth wildcard handler (catch-all for other auth routes) ──────────

app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    return handleAuthRequest(request, reply);
  },
});

// ─── Auth middleware ────────────────────────────────────────────────────────

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
  console.log(`[auth] requireOrg: session=${s ? "found" : "MISSING"}, userId=${s?.user?.id ?? "n/a"}, userName=${s?.user?.name ?? "n/a"}`);
  if (!s) {
    reply.status(401).send({ error: "unauthorized" });
    return null;
  }
  let orgId = (s.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;

  // Auto-pick first org if none is set
  if (!orgId) {
    const [memberRow] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, s.user.id))
      .limit(1);

    if (memberRow) {
      orgId = memberRow.organizationId;
      // Persist it back to the session
      try {
        await auth.api.setActiveOrganization({
          body: { organizationId: orgId },
          headers: fromNodeHeaders(request.headers),
        });
      } catch { /* best-effort */ }
    }
  }

  if (!orgId) {
    reply.status(400).send({ error: "no active organization — user is not a member of any org" });
    return null;
  }
  return { userId: s.user.id, orgId };
}

// ─── Me ────────────────────────────────────────────────────────────────────

app.get("/api/me", async (request, reply) => {
  const s = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!s) return reply.status(401).send({ error: "unauthorized" });
  return { user: s.user, session: s.session };
});

// ─── Members ────────────────────────────────────────────────────────────────

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

// ════════════════════════════════════════════════════════════════════════════
// TICKET SYSTEM v2
// ════════════════════════════════════════════════════════════════════════════

// ─── Ticket Kinds ──────────────────────────────────────────────────────────

app.get("/api/ticket-kinds", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  return db
    .select()
    .from(ticketKinds)
    .where(
      and(
        eq(ticketKinds.orgId, ctx.orgId),
        eq(ticketKinds.enabled, true),
      ),
    )
    .orderBy(ticketKinds.title);
});

// ─── List tickets for org ───────────────────────────────────────────────────

app.get("/api/tickets", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  // Return all non-draft tickets — open, accepted, and closed
  return db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.orgId, ctx.orgId),
        ne(tickets.status, "draft"),
      ),
    )
    .orderBy(desc(tickets.createdAt));
});

// ─── Create ticket (for Swagger / testing) ──────────────────────────────────

app.post("/api/tickets", {
  schema: {
    description: "Create a new ticket (for testing purposes)",
    tags: ["tickets"],
    body: {
      type: "object",
      required: ["kindKey", "title", "steps"],
      properties: {
        kindKey: { type: "string", description: "e.g. po_creation, full_acknowledgement, pre_ack_modification, whole_po_rejection, partial_acknowledgement" },
        title: { type: "string" },
        creationReason: { type: "string", default: "Manual test" },
        poId: { type: "string", format: "uuid", description: "Optional PO UUID" },
        supplierCode: { type: "string", description: "Optional supplier code" },
        steps: {
          type: "array",
          description: "TicketStep[] JSON array — the step pipeline",
          items: { type: "object" },
        },
      },
    },
    response: {
      201: {
        type: "object",
        properties: {
          ticketId: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
        },
      },
    },
  },
}, async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const body = request.body as {
    kindKey?: string;
    title?: string;
    creationReason?: string;
    poId?: string;
    supplierCode?: string;
    steps?: unknown[];
  };

  if (!body?.kindKey || !body?.title) {
    return reply.status(400).send({ error: "kindKey and title are required" });
  }

  // Verify the ticket kind exists for this org
  const [kind] = await db
    .select()
    .from(ticketKinds)
    .where(
      and(
        eq(ticketKinds.orgId, ctx.orgId),
        eq(ticketKinds.key, body.kindKey),
      ),
    );

  if (!kind) {
    return reply.status(400).send({
      error: `Unknown ticket kind "${body.kindKey}" for this org. Use GET /api/ticket-kinds to list available kinds.`,
    });
  }

  const [created] = await db
    .insert(tickets)
    .values({
      orgId: ctx.orgId,
      kindKey: body.kindKey,
      title: body.title,
      status: "open",
      hasWrites: kind.isWriteBearing,
      creationReason: body.creationReason ?? "Manual test",
      poId: body.poId ?? null,
      supplierCode: body.supplierCode ?? null,
      steps: (body.steps as any[]) ?? [],
      createdByUserId: ctx.userId,
    })
    .returning({ ticketId: tickets.ticketId, title: tickets.title, status: tickets.status });

  // Notify other org members via push
  sendTicketNotification(ctx.orgId, created.ticketId, "created", ctx.userId).catch((err) =>
    app.log.error(err, "push notification failed"),
  );

  return reply.status(201).send(created);
});

// ─── Single ticket with relations ──────────────────────────────────────────

app.get("/api/tickets/:id", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const { id } = request.params as { id: string };

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.ticketId, id), eq(tickets.orgId, ctx.orgId)));

  if (!ticket) return reply.status(404).send({ error: "ticket not found" });

  // Fetch kind metadata
  const [kind] = await db
    .select()
    .from(ticketKinds)
    .where(
      and(
        eq(ticketKinds.orgId, ctx.orgId),
        eq(ticketKinds.key, ticket.kindKey),
      ),
    );

  // Fetch evidence (emails)
  const evidence = await db
    .select()
    .from(ticketEvidence)
    .where(eq(ticketEvidence.ticketId, id));

  // Fetch linked email messages
  const emailIds = evidence
    .map((e) => e.emailMessageId)
    .filter((id): id is string => id !== null);

  let emails: (typeof emailMessages.$inferSelect)[] = [];
  if (emailIds.length > 0) {
    emails = await db
      .select()
      .from(emailMessages)
      .where(inArray(emailMessages.id, emailIds))
      .orderBy(desc(emailMessages.receivedAt));
  }

  // Fetch PO if linked
  let po: typeof purchaseOrders.$inferSelect | null = null;
  let lines: (typeof poLines.$inferSelect)[] = [];
  if (ticket.poId) {
    const [poRow] = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.orgId, ctx.orgId),
          eq(purchaseOrders.poId, ticket.poId),
        ),
      );
    po = poRow ?? null;

    if (po) {
      lines = await db
        .select()
        .from(poLines)
        .where(eq(poLines.poId, ticket.poId!))
        .orderBy(poLines.lineId);
    }
  }

  return {
    ...ticket,
    kind,
    evidence,
    emails,
    purchaseOrder: po,
    poLines: lines,
  };
});

// ─── Commit (accept) ───────────────────────────────────────────────────────

app.post("/api/tickets/:id/commit", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const { id } = request.params as { id: string };
  const body = request.body as {
    steps?: unknown[];
    decisionPath?: Array<{ stepId: string; chosenOption: string }>;
    skippedStepIds?: string[];
    todoStepIds?: string[];
  } | null;

  // 1. Fetch ticket and verify it's open
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.ticketId, id), eq(tickets.orgId, ctx.orgId)));

  if (!ticket) return reply.status(404).send({ error: "ticket not found" });
  if (ticket.status !== "open") {
    return reply.status(409).send({
      error: `ticket is ${ticket.status} — cannot commit`,
      detail: "The ticket may have been superseded or already resolved. Reload to see the current state.",
    });
  }

  // 2. Apply all edit diffs in a transaction
  try {
    await db.transaction(async (tx) => {
      // Mark ticket as accepted
      await tx
        .update(tickets)
        .set({
          status: "accepted",
          resolvedByUserId: ctx.userId,
          resolvedAt: new Date(),
          resolution: {
            decisionPath: body?.decisionPath ?? [],
            skippedStepIds: body?.skippedStepIds ?? [],
            todoStepIds: body?.todoStepIds ?? [],
            steps: (body?.steps as any[]) ?? [],
          },
          updatedAt: new Date(),
        })
        .where(eq(tickets.ticketId, id));

      // Close write-pos rows if any
      await tx
        .update(ticketWritePos)
        .set({ isOpen: false })
        .where(eq(ticketWritePos.ticketId, id));

      // Record in audit_log
      await tx.insert(auditLog).values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        ticketId: id,
        tableName: "tickets",
        rowKey: id,
        operation: "commit",
        changes: { status: "accepted" },
      });

      // If there are send steps, record in outbound_log
      const sendStepIds =
        (body?.steps as any[])?.filter((s: any) => s.kind === "send").map((s: any) => s.id) ?? [];
      for (const stepId of sendStepIds) {
        await tx.insert(outboundLog).values({
          id: crypto.randomUUID(),
          ticketId: id,
          kind: "send",
          sentAt: new Date(),
        });
      }
    });
  } catch (err: any) {
    app.log.error(err, "commit transaction failed");
    return reply.status(500).send({ error: "commit failed", detail: err?.message });
  }

  // 3. Notify PO subscribers + owner (fire-and-forget)
  sendTicketNotification(ctx.orgId, id, "accepted", ctx.userId).catch((err) =>
    app.log.error(err, "push notification failed"),
  );

  // 4. Return updated ticket
  const [updated] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.ticketId, id));

  return reply.status(200).send(updated);
});

// ─── Close (dismiss) ───────────────────────────────────────────────────────

app.post("/api/tickets/:id/close", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const { id } = request.params as { id: string };
  const body = request.body as {
    closedKind?: string;
    closedReason?: string;
  } | null;

  const closedKind = body?.closedKind;
  const closedReason = (body?.closedReason ?? "").trim();

  if (!closedKind) {
    return reply.status(400).send({ error: "closedKind is required" });
  }

  // 1. Fetch ticket
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.ticketId, id), eq(tickets.orgId, ctx.orgId)));

  if (!ticket) return reply.status(404).send({ error: "ticket not found" });
  if (ticket.status !== "open") {
    return reply.status(409).send({ error: `ticket is already ${ticket.status}` });
  }

  // 2. Check: fact tickets (write_fact family) cannot be dismissed
  const [kind] = await db
    .select()
    .from(ticketKinds)
    .where(
      and(
        eq(ticketKinds.orgId, ctx.orgId),
        eq(ticketKinds.key, ticket.kindKey),
      ),
    );

  if (kind?.family === "write_fact" && closedKind === "dismissed") {
    return reply.status(403).send({
      error: "fact tickets cannot be dismissed",
      detail: "ERP-fact tickets (#1, #6, #7, #8) must be accepted. Correct the values and accept instead.",
    });
  }

  // 3. Close the ticket
  await db
    .update(tickets)
    .set({
      status: "closed",
      closedKind: closedKind as any,
      closedReason: closedReason || null,
      resolvedByUserId: ctx.userId,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tickets.ticketId, id));

  // 4. Record in ingestion_events for suppression memory
  await db.insert(ingestionEvents).values({
    orgId: ctx.orgId,
    channel: "buyer_cc",
    semanticHash: `dismissed:${id}`,
    outcome: "suppressed_dismissed",
    ticketId: id,
    payload: { closedKind, closedReason },
  });

  // 5. Notify
  sendTicketNotification(ctx.orgId, id, "closed", ctx.userId).catch((err) =>
    app.log.error(err, "push notification failed"),
  );

  const [updated] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.ticketId, id));

  return reply.status(200).send(updated);
});

// ─── PO detail ─────────────────────────────────────────────────────────────

app.get("/api/pos/:id", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const { id } = request.params as { id: string };

  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.orgId, ctx.orgId),
        eq(purchaseOrders.poId, id),
      ),
    );

  if (!po) return reply.status(404).send({ error: "PO not found" });

  const lines = await db
    .select()
    .from(poLines)
    .where(eq(poLines.poId, id))
    .orderBy(poLines.lineId);

  // All tickets for this PO (including closed, for timeline)
  const poTickets = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.orgId, ctx.orgId),
        eq(tickets.poId, id),
      ),
    )
    .orderBy(desc(tickets.createdAt));

  return { ...po, lines, tickets: poTickets };
});

// ─── Ticket evidence ───────────────────────────────────────────────────────

app.get("/api/tickets/:id/evidence", async (request, reply) => {
  const ctx = await requireOrg(request, reply);
  if (!ctx) return;

  const { id } = request.params as { id: string };

  const evidence = await db
    .select()
    .from(ticketEvidence)
    .where(eq(ticketEvidence.ticketId, id));

  const emailIds = evidence
    .map((e) => e.emailMessageId)
    .filter((eid): eid is string => eid !== null);

  let emails: (typeof emailMessages.$inferSelect)[] = [];
  if (emailIds.length > 0) {
    emails = await db
      .select()
      .from(emailMessages)
      .where(inArray(emailMessages.id, emailIds))
      .orderBy(desc(emailMessages.receivedAt));
  }

  return { evidence, emails };
});

// ─── Push Token Registration ───────────────────────────────────────────────

app.post("/api/push-token", async (request, reply) => {
  const ctx = await requireSession(request, reply);
  if (!ctx) return;

  const body = request.body as { token?: string; platform?: string };
  const token = (body?.token ?? "").trim();
  if (!token) return reply.status(400).send({ error: "token required" });

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

// ─── Start ─────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`server listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
