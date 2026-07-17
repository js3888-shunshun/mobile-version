import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";
import { debug } from "./debug";
import { useOrgStore } from "./org-store";
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
    // Use native fetch for org endpoints (authClient.$fetch may behave differently on web)
    // NOTE: React Native fetch() does NOT automatically include an Origin header.
    // The server requires Origin for CORS-protected endpoints like set-active.
    const orgsRes = await fetch(`${BASE_URL}/api/auth/organization/list`, {
      method: "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Origin": BASE_URL },
    });

    if (!orgsRes.ok) {
      let errMsg = `status=${orgsRes.status}`;
      try {
        const b = await orgsRes.json();
        errMsg += ` body=${JSON.stringify(b)}`;
      } catch {
        errMsg += " (no json body)";
      }
      debug.error("API", "Failed to list organizations: " + errMsg);
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

    const setRes = await fetch(`${BASE_URL}/api/auth/organization/set-active`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Origin": BASE_URL },
      body: JSON.stringify({ organizationId: orgId }),
    });

    if (!setRes.ok) {
      let errMsg = `status=${setRes.status}`;
      try {
        const b = await setRes.json();
        errMsg += ` body=${JSON.stringify(b)}`;
      } catch {
        errMsg += " (no json body)";
      }
      debug.error("API", "Failed to set active organization: " + errMsg);
      return false;
    }

    debug.info("API", "Active organization set successfully");
    // Store org info directly — useSession() cache may be stale
    useOrgStore.getState().setActiveOrg({ id: orgId, name: orgs[0].name });
    return true;
  } catch (err: any) {
    debug.error("API", "ensureActiveOrg exception", {
      error: err?.message ?? String(err),
    });
    return false;
  }
}

/**
 * Thin wrapper around native fetch for API calls.
 * Uses credentials: "include" so browser sends session cookies.
 */
async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const method = options.method ?? "GET";
  const hasBody = options.body != null;

  const headers: Record<string, string> = {
    "Origin": BASE_URL,
    ...(hasBody && { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };

  debug.log("API", `${method} ${url}`, { hasBody, headers });

  try {
    const res = await fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });

    debug.log("API", `Response ${res.status} ${method} ${path}`);

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      let rawBody = "";
      try {
        rawBody = await res.text();
        const parsed = JSON.parse(rawBody);
        errMsg = parsed?.error ?? parsed?.message ?? JSON.stringify(parsed);
      } catch {
        errMsg = rawBody || errMsg;
      }
      debug.error("API", `${method} ${path} FAILED`, {
        status: res.status,
        rawBody: rawBody.substring(0, 500),
        errMsg,
      });
      throw new Error(errMsg);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (e: any) {
    if (e instanceof TypeError || e?.name === "TypeError" || e?.message?.includes("fetch")) {
      debug.error("API", `${method} ${path} NETWORK ERROR`, {
        error: e?.message ?? String(e),
        url,
      });
      throw new Error(`Network: ${e?.message ?? "Failed to fetch"}`);
    }
    throw e;
  }
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

// ─── Organization ────────────────────────────────────────────

export function useOrgName() {
  const { data: session } = authClient.useSession();
  const storedOrg = useOrgStore((s) => s.activeOrg);

  return useQuery({
    queryKey: ["org-name", (session?.session as any)?.activeOrganizationId ?? storedOrg?.id],
    queryFn: async () => {
      const activeOrgId = (session?.session as any)?.activeOrganizationId as string | undefined;
      // If session has the active org id, fetch its name
      if (activeOrgId) {
        const orgs = await apiFetch<Array<{ id: string; name: string; slug: string }>>(
          "/api/auth/organization/list",
        );
        const org = orgs.find((o) => o.id === activeOrgId);
        if (org) return org.name;
      }
      // Fallback: use org info stored by ensureActiveOrg()
      if (storedOrg) return storedOrg.name;
      return null;
    },
    enabled: !!session,
    staleTime: 0,
  });
}
