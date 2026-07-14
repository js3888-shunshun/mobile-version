export type Id = string;

export interface Ticket {
  id: string;
  orgId: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  userId: string;
  role: string;
  name?: string;
  email?: string;
}
