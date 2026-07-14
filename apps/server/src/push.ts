import { Expo } from "expo-server-sdk";
import { db, pushTokens, member, eq, and, inArray } from "@mobile/db";

const expo = new Expo();

/**
 * Send a ticket-update push notification to every device belonging to
 * members of the given organization.
 *
 * Phase 3 — will be called from ticket create/update routes.
 */
export async function sendTicketNotification(
  orgId: string,
  ticketId: string,
  action: "created" | "updated",
) {
  // 1. Find all members of this org
  const members = await db
    .select()
    .from(member)
    .where(eq(member.organizationId, orgId));

  if (!members.length) return;

  // 2. Find active push tokens for those members
  const userIds = members.map((m) => m.userId);
  const tokens = await db
    .select()
    .from(pushTokens)
    .where(
      and(inArray(pushTokens.userId, userIds), eq(pushTokens.isActive, true)),
    );

  if (!tokens.length) return;

  // 3. Build messages
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default" as const,
    title: "Ticket Updated",
    body:
      action === "created"
        ? "A new ticket was created"
        : "A ticket was updated",
    data: { type: "ticket_update", ticketId },
  }));

  // 4. Dispatch in batches (Expo allows up to 100 per request)
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      console.log("[push] dispatched chunk:", tickets.length);
    } catch (err) {
      console.error("[push] dispatch failed:", err);
    }
  }
}
