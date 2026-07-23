import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";
import { debug } from "./debug";
import { useOrgStore } from "./org-store";
import type {
  Ticket,
  TicketKind,
  TicketClosedKind,
  CommitTicketPayload,
  CloseTicketPayload,
} from "@mobile/shared";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://172.105.135.182:4000";

/**
 * better-auth's $fetch returns { data, error } (not a Response).
 */
async function authFetch<T = unknown>(
  url: string,
  options: RequestInit & { method?: string } = {},
): Promise<T> {
  const method = options.method ?? "GET";

  const result = await authClient.$fetch(url, {
    ...options,
    method,
    headers: {
      Origin: "mobileversion://",
      ...(options.body != null && { "Content-Type": "application/json" }),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (result.error) {
    const err = result.error as {
      status?: number;
      statusText?: string;
      message?: string;
    };
    debug.error("API", `${method} ${url} FAILED`, {
      status: err.status,
      message: err.message ?? err.statusText ?? "Unknown error",
    });
    throw new Error(err.message ?? `HTTP ${err.status ?? "error"}`);
  }

  return (result as { data: T }).data;
}

export async function ensureActiveOrg(): Promise<boolean> {
  debug.info("API", "ensureActiveOrg: checking session…");

  const sessionRes = await authClient.getSession();
  const session = sessionRes.data?.session as Record<string, unknown> | undefined;

  if (session?.activeOrganizationId) {
    debug.info("API", `Active org already set: ${session.activeOrganizationId}`);
    return true;
  }

  try {
    const orgs = await authFetch<Array<{ id: string; name: string; slug: string }>>(
      `${BASE_URL}/api/auth/organization/list`,
      { method: "GET" },
    );

    if (orgs.length === 0) {
      debug.warn("API", "User has no organizations");
      return false;
    }

    const orgId = orgs[0].id;
    await authFetch(`${BASE_URL}/api/auth/organization/set-active`, {
      method: "POST",
      body: JSON.stringify({ organizationId: orgId }),
    });

    useOrgStore.getState().setActiveOrg({ id: orgId, name: orgs[0].name });
    return true;
  } catch (err: any) {
    debug.error("API", "ensureActiveOrg exception", { error: err?.message ?? String(err) });
    return false;
  }
}

async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const method = options.method ?? "GET";

  try {
    const sessionData = await authClient.getSession();
    const cachedUserId = (sessionData.data?.user as any)?.id ?? "unknown";

    const meData = await authFetch<{ user?: { id?: string; name?: string } }>(
      `${BASE_URL}/api/me`,
      { method: "GET" },
    );
    const serverUserId = meData?.user?.id ?? "none";

    if (cachedUserId !== serverUserId) {
      debug.warn("API", `SESSION MISMATCH: cached=${cachedUserId} vs server=${serverUserId}`);
    }

    debug.log("API", `${method} ${path}`);
  } catch {
    debug.log("API", `${method} ${path} (no session check)`);
  }

  return authFetch<T>(url, options);
}

// ─── Tickets ─────────────────────────────────────────────────

export function useTickets() {
  return useQuery({
    queryKey: ["tickets"],
    queryFn: () => apiFetch<Ticket[]>("/api/tickets"),
    refetchInterval: 30_000,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ["tickets", id],
    queryFn: () => apiFetch<Ticket & { kind?: TicketKind; emails?: any[]; evidence?: any[] }>(`/api/tickets/${id}`),
  });
}

export function useTicketKinds() {
  return useQuery({
    queryKey: ["ticket-kinds"],
    queryFn: () => apiFetch<TicketKind[]>("/api/ticket-kinds"),
    staleTime: 5 * 60 * 1000, // kinds rarely change
  });
}

export function useCommitTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CommitTicketPayload & { ticketId: string }) =>
      apiFetch<Ticket>(`/api/tickets/${data.ticketId}/commit`, {
        method: "POST",
        body: JSON.stringify({
          steps: data.steps,
          decisionPath: data.decisionPath,
          skippedStepIds: data.skippedStepIds,
          todoStepIds: data.todoStepIds,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useCloseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CloseTicketPayload & { ticketId: string }) =>
      apiFetch<Ticket>(`/api/tickets/${data.ticketId}/close`, {
        method: "POST",
        body: JSON.stringify({
          closedKind: data.closedKind,
          closedReason: data.closedReason,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useTicketEvidence(ticketId: string) {
  return useQuery({
    queryKey: ["tickets", ticketId, "evidence"],
    queryFn: () =>
      apiFetch<{ evidence: any[]; emails: any[] }>(
        `/api/tickets/${ticketId}/evidence`,
      ),
    enabled: !!ticketId,
  });
}

// ─── Organization ────────────────────────────────────────────

export function useOrgName() {
  const { data: session } = authClient.useSession();
  const storedOrg = useOrgStore((s) => s.activeOrg);

  return useQuery({
    queryKey: [
      "org-name",
      (session?.session as any)?.activeOrganizationId ?? storedOrg?.id,
    ],
    queryFn: async () => {
      const activeOrgId = (session?.session as any)?.activeOrganizationId as
        | string
        | undefined;
      if (activeOrgId) {
        const orgs = await apiFetch<
          Array<{ id: string; name: string; slug: string }>
        >("/api/auth/organization/list");
        const org = orgs.find((o) => o.id === activeOrgId);
        if (org) return org.name;
      }
      if (storedOrg) return storedOrg.name;
      return null;
    },
    enabled: !!session,
    staleTime: 0,
  });
}
