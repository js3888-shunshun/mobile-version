import { Expo } from "expo-server-sdk";
import { db, pushTokens, member, tickets, user, eq, and, inArray, ne } from "@mobile/db";

const expo = new Expo();

/**
 * Send a ticket-update push notification to every device belonging to
 * members of the given organization — except the actor who made the change.
 */
export async function sendTicketNotification(
  orgId: string,
  ticketId: string,
  action: "created" | "updated",
  actorId?: string,
) {
  console.log(`[push] sendTicketNotification called: orgId=${orgId}, ticketId=${ticketId}, action=${action}, actorId=${actorId ?? "none"}`);

  // 1. Get ticket info for the notification body
  const [ticket] = await db
    .select({ description: tickets.description, status: tickets.status })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  console.log(`[push] ticket fetch: ${ticket ? "found" : "NOT FOUND"}, description=${ticket?.description?.slice(0, 30) ?? "n/a"}`);

  // 2. Find all members of this org
  // TODO: exclude actorId in production (ne(member.userId, actorId))
  const members = await db
    .select()
    .from(member)
    .where(eq(member.organizationId, orgId));
  console.log(`[push] org members (all, including actor): ${members.length}`);

  if (!members.length) {
    console.log("[push] No other members to notify — exiting");
    return;
  }

  // 3. Find active push tokens for those members
  const userIds = members.map((m) => m.userId);
  console.log(`[push] member userIds: ${userIds.join(", ")}`);

  const tokens = await db
    .select()
    .from(pushTokens)
    .where(
      and(inArray(pushTokens.userId, userIds), eq(pushTokens.isActive, true)),
    );
  console.log(`[push] active push tokens found: ${tokens.length}`);

  if (!tokens.length) {
    console.log("[push] No active push tokens for these members — exiting");
    return;
  }

  for (const t of tokens) {
    console.log(`[push] token: ${t.token.slice(0, 30)}… userId=${t.userId}`);
  }

  // 4. Get actor name for richer notifications
  let actorName: string | undefined;
  if (actorId) {
    const [u] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actorId));
    actorName = u?.name;
  }
  console.log(`[push] actor name: ${actorName ?? "unknown"}`);

  // 5. Build messages
  const description = ticket?.description ?? "ticket";
  const truncated = description.length > 80 ? description.slice(0, 77) + "…" : description;
  const who = actorName ?? "Someone";
  const title =
    action === "created" ? `📝 New ticket by ${who}` : `✏️ Ticket updated by ${who}`;
  const body = `"${truncated}"`;
  console.log(`[push] message: title="${title}", body="${body}"`);

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default" as const,
    title,
    body,
    data: { type: "ticket_update", ticketId },
  }));

  // 6. Dispatch in batches (Expo allows up to 100 per request)
  const chunks = expo.chunkPushNotifications(messages);
  console.log(`[push] dispatching ${messages.length} messages in ${chunks.length} chunk(s)`);

  for (const chunk of chunks) {
    try {
      const ticketReceipts = await expo.sendPushNotificationsAsync(chunk);
      console.log(`[push] dispatched chunk: ${ticketReceipts.length} receipts`);

      // Handle DeviceNotRegistered errors — deactivate bad tokens
      for (let i = 0; i < ticketReceipts.length; i++) {
        const receipt = ticketReceipts[i];
        console.log(`[push] receipt[${i}]: status=${receipt.status}` + (receipt.status === "error" ? `, message=${(receipt as any).message}, details=${JSON.stringify((receipt as any).details)}` : ""));
        if (receipt.status === "error") {
          const detail = receipt as { status: "error"; message: string; details?: { error?: string } };
          if (detail.details?.error === "DeviceNotRegistered") {
            const badToken = chunk[i].to as string;
            console.log("[push] deactivating DeviceNotRegistered token:", badToken.slice(0, 20) + "…");
            await db
              .update(pushTokens)
              .set({ isActive: false })
              .where(eq(pushTokens.token, badToken));
          }
        }
      }
    } catch (err) {
      console.error("[push] dispatch failed:", err);
    }
  }
}
