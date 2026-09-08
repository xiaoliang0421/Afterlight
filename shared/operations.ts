export const operationLabels = {
  payments: "Payment reconciliation",
  "privacy-media": "Private media cleanup",
  speech: "Speech result checks",
  "provider-balance": "Provider balance",
  "story-queues": "Story queue recovery",
  archives: "Story archive recovery",
  outbox: "Story update delivery",
  housekeeping: "Expired session cleanup",
} as const;

export type OperationName = keyof typeof operationLabels;
export type OperationResult = {
  name: string;
  status: "unknown" | "running" | "succeeded" | "failed" | "skipped";
  startedAt: number;
  completedAt: number;
  failureAt: number;
};
