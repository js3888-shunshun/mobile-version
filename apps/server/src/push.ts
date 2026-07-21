import { Expo } from "expo-server-sdk";
import { db, pushTokens, member, tickets, ticketKinds, user, eq, and, inArray, ne } from "@mobile/db";

const expo = new Expo();

/**
 * Send a ticket-update push notification to every device belonging to
 * members of the given organization — except the actor who made the change.
 */
export async function sendTicketNotification(
  orgId: string,
  ticketId: string,
  action: "created" | "updated" | "accepted" | "closed",
  actorId?: string,
) {
  console.log(`[push] sendTicketNotification: orgId=${orgId}, ticketId=${ticketId}, action=${action}, actorId=${actorId ?? "none"}`);

  // 1. Get ticket info for the notification body
  const [ticket] = await db
    .select({ title: tickets.title, kindKey: tickets.kindKey, status: tickets.status })
    .from(tickets)
    .where(eq(tickets.ticketId, ticketId));
  console.log(`[push] ticket: ${ticket ? `"${ticket.title}" (${ticket.kindKey})` : "NOT FOUND"}`);

  // 2. Find all members of this org (excluding the actor)
  const members = await db
    .select()
    .from(member)
    .where(eq(member.organizationId, orgId));
  console.log(`[push] org members: ${members.length}`);

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
    console.log("[push] No active push tokens — exiting");
    return;
  }

  // 4. Get actor name
  let actorName: string | undefined;
  if (actorId) {
    const [u] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actorId));
    actorName = u?.name;
  }
  console.log(`[push] actor: ${actorName ?? "unknown"}`);

  // 5. Build messages
  const title = ticket?.title ?? "Ticket update";
  const truncated =
    title.length > 80 ? title.slice(0, 77) + "…" : title;
  const who = actorName ?? "Someone";

  let pushTitle: string;
  switch (action) {
    case "accepted":
      pushTitle = `Ticket accepted by ${who}`;
      break;
    case "closed":
      pushTitle = `Ticket closed by ${who}`;
      break;
    case "created":
      pushTitle = `New ticket by ${who}`;
      break;
    case "updated":
      pushTitle = `Ticket updated by ${who}`;
      break;
    default:
      pushTitle = `Ticket ${action} by ${who}`;
  }

  const body = `"${truncated}"`;
  console.log(`[push] message: title="${pushTitle}", body="${body}"`);

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default" as const,
    title: pushTitle,
    body,
    data: { type: "ticket_update", ticketId, action, kindKey: ticket?.kindKey },
  }));

  // 6. Dispatch in batches
  const chunks = expo.chunkPushNotifications(messages);
  console.log(`[push] dispatching ${messages.length} messages in ${chunks.length} chunk(s)`);

  for (const chunk of chunks) {
    try {
      const ticketReceipts = await expo.sendPushNotificationsAsync(chunk);
      console.log(`[push] dispatched chunk: ${ticketReceipts.length} receipts`);

      for (let i = 0; i < ticketReceipts.length; i++) {
        const receipt = ticketReceipts[i];
        if (receipt.status === "error") {
          const detail = receipt as {
            status: "error";
            message: string;
            details?: { error?: string };
          };
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
