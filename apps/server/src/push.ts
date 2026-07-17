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
  // 1. Get ticket info for the notification body
  const [ticket] = await db
    .select({ description: tickets.description, status: tickets.status })
    .from(tickets)
    .where(eq(tickets.id, ticketId));

  // 2. Find all members of this org (excluding the actor)
  const members = await db
    .select()
    .from(member)
    .where(
      actorId
        ? and(eq(member.organizationId, orgId), ne(member.userId, actorId))
        : eq(member.organizationId, orgId),
    );

  if (!members.length) return;

  // 3. Find active push tokens for those members
  const userIds = members.map((m) => m.userId);
  const tokens = await db
    .select()
    .from(pushTokens)
    .where(
      and(inArray(pushTokens.userId, userIds), eq(pushTokens.isActive, true)),
    );

  if (!tokens.length) return;

  // 4. Get actor name for richer notifications
  let actorName: string | undefined;
  if (actorId) {
    const [u] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actorId));
    actorName = u?.name;
  }

  // 5. Build messages
  const description = ticket?.description ?? "ticket";
  const truncated = description.length > 80 ? description.slice(0, 77) + "…" : description;
  const who = actorName ?? "Someone";
  const title =
    action === "created" ? `📝 New ticket by ${who}` : `✏️ Ticket updated by ${who}`;
  const body = `"${truncated}"`;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default" as const,
    title,
    body,
    data: { type: "ticket_update", ticketId },
  }));

  // 6. Dispatch in batches (Expo allows up to 100 per request)
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const ticketReceipts = await expo.sendPushNotificationsAsync(chunk);
      console.log("[push] dispatched chunk:", ticketReceipts.length);

      // Handle DeviceNotRegistered errors — deactivate bad tokens
      for (let i = 0; i < ticketReceipts.length; i++) {
        const receipt = ticketReceipts[i];
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
