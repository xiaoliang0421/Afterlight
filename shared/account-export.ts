export const exportSections = [
  "profile",
  "signInProfile",
  "linkedAccounts",
  "sessions",
  "stories",
  "ideas",
  "scenes",
  "speechChecks",
  "freeCredits",
  "purchasedCredits",
  "creditHistory",
  "orders",
  "purchaseHistory",
  "billingRequests",
  "savedStories",
  "watchProgress",
  "notifications",
  "reports",
  "accountRequests",
  "policyAcceptances",
  "contributionAcceptances",
  "storyChangeRequests",
  "storyChangeDecisions",
] as const;

export type ExportSection = (typeof exportSections)[number];
export interface ExportManifest {
  format: "talerelay-account-records-v1";
  accountId: string;
  startedAt: string;
  sections: { name: ExportSection; through: number; count: number }[];
  notes: string[];
}
export interface ExportPage {
  accountId: string;
  section: ExportSection;
  rows: Record<string, unknown>[];
  next: number | null;
}
