import { z } from "zod";
import { characterSchema } from "./domain";

export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_UPLOAD_DURATION_MS = 60_000;
export const proposalInput = z.object({
  prompt: z.string().trim().min(10).max(2000),
  idempotencyKey: z.string().uuid(),
  publicAttributionAccepted: z.literal(true),
  termsVersion: z.string().min(1).max(80),
});
export const uploadInput = z.object({
  idempotencyKey: z.string().uuid(),
  proposalIds: z.array(z.string().uuid()).max(5).default([]),
  title: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(10).max(1200),
  bridge: z.string().trim().min(10).max(1200),
  events: z.array(z.string().trim().min(1).max(400)).max(8),
  characterIds: z.array(z.string().min(1).max(80)).max(3).default([]),
  newCharacters: z.array(characterSchema).max(2).default([]),
  bytes: z.number().int().min(16).max(MAX_UPLOAD_BYTES),
  rightsAccepted: z.literal(true),
});
export interface Proposal {
  id: string;
  storyId: string;
  authorId: string;
  author: string;
  prompt: string;
  baseVersion: number;
  status: "pending" | "selected" | "published" | "withdrawn" | "declined";
  taskId: string | null;
  createdAt: number;
}
