import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";
import { debug } from "./debug";
import type { Ticket } from "@mobile/shared";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://172.105.135.182:4000";

/**
 * Ensure the user has an active organization set in their session.
 * If not, auto-select the first available organization.
 * Returns true if an active org is now set, false if user has no orgs.
 */
export async function ensureActiveOrg(): Promise<boolean> {
  debug.info("API", "ensureActiveOrg: checking session…");

  // Check current session
  const sessionRes = await authClient.getSession();
  const session = sessionRes.data?.session as Record<string, unknown> | undefined;

  if (session?.activeOrganizationId) {
    debug.info("API", `Active org already set: ${session.activeOrganizationId}`);
    return true;
  }

  debug.info("API", "No active org, listing organizations…");

  // List user's organizations
  try {
    // NOTE: better-auth's $fetch already includes the baseURL, so use a relative path
    const orgsRes = await authClient.$fetch("/api/auth/organization/list", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!orgsRes.ok) {
      debug.error("API", "Failed to list organizations", {
        status: orgsRes.status,
      });
      return false;
    }

    const orgs: Array<{ id: string; name: string; slug: string }> = await orgsRes.json();

    debug.info("API", `Found ${orgs.length} organizations`, {
      orgs: orgs.map((o) => ({ id: o.id, name: o.name })),
    });

    if (orgs.length === 0) {
      debug.warn("API", "User has no organizations");
      return false;
    }

    // Auto-select the first organization
    const orgId = orgs[0].id;
    debug.info("API", `Auto-selecting organization: ${orgs[0].name} (${orgId})`);

    const setRes = await authClient.$fetch(
      "/api/auth/organization/set-active",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      },
    );

    if (!setRes.ok) {
      debug.error("API", "Failed to set active organization", {
        status: setRes.status,
      });
      return false;
    }

    debug.info("API", "Active organization set successfully");
    return true;
  } catch (err: any) {
    debug.error("API", "ensureActiveOrg exception", {
      error: err?.message ?? String(err),
    });
    return false;
  }
}

/**
 * Thin wrapper around authClient.$fetch that adds JSON headers.
 */
async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // better-auth's $fetch prepends its own baseURL, so use relative path
  debug.log("API", `${options.method ?? "GET"} ${path}`);

  const res = await authClient.$fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  debug.log("API", `Response ${res.status} for ${options.method ?? "GET"} ${path}`);

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      errMsg = (body as any)?.error ?? (body as any)?.message ?? JSON.stringify(body);
    } catch {
      // response might not be JSON
    }
    debug.error("API", `Request failed: ${options.method ?? "GET"} ${path}`, {
      status: res.status,
      body: errMsg,
    });
    throw new Error(errMsg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Tickets ─────────────────────────────────────────────────

export function useTickets() {
  debug.log("API", "useTickets hook mounted");
  return useQuery({
    queryKey: ["tickets"],
    queryFn: () => apiFetch<Ticket[]>("/api/tickets"),
    refetchInterval: 15_000, // poll every 15s for real-time sync
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ["tickets", id],
    queryFn: async () => {
      // We don't have a single-ticket endpoint, filter from list
      const tickets = await apiFetch<Ticket[]>("/api/tickets");
      return tickets.find((t) => t.id === id) ?? null;
    },
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { description: string; status: string }) =>
      apiFetch<Ticket>("/api/tickets", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; description?: string; status?: string }) =>
      apiFetch<Ticket>(`/api/tickets/${data.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(data.description !== undefined && { description: data.description }),
          ...(data.status !== undefined && { status: data.status }),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/tickets/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}
