import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";
import { debug } from "./debug";
import type { Ticket } from "@mobile/shared";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://172.105.135.182:4000";

/**
 * Thin wrapper around authClient.$fetch that adds JSON headers.
 */
async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  debug.log("API", `${options.method ?? "GET"} ${url}`);

  const res = await authClient.$fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  debug.log("API", `Response ${res.status} for ${options.method ?? "GET"} ${path}`);

  if (!res.ok) {
    const err = await res.text();
    debug.error("API", `Request failed: ${options.method ?? "GET"} ${path}`, {
      status: res.status,
      body: err,
    });
    throw new Error(err);
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
