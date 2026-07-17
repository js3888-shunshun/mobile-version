import { create } from "zustand";

type OrgInfo = { id: string; name: string };

type OrgStore = {
  activeOrg: OrgInfo | null;
  setActiveOrg: (org: OrgInfo | null) => void;
};

export const useOrgStore = create<OrgStore>((set) => ({
  activeOrg: null,
  setActiveOrg: (org) => set({ activeOrg: org }),
}));
