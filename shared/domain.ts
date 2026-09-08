import { z } from "zod";
import type { GenerationMode } from "./billing";
import { majorChangeSchema, type OwnerReview } from "./governance";

export const taskStates = [
  "Draft",
  "NeedsReview",
  "Queued",
  "Preparing",
  "Generating",
  "Checking",
  "NeedsModeration",
  "Packaging",
  "Published",
  "Cancelled",
  "Failed",
  "ReconciliationNeeded",
] as const;
export type TaskState = (typeof taskStates)[number];
export const activeStates: TaskState[] = [
  "Queued",
  "Preparing",
  "Generating",
  "Checking",
  "NeedsModeration",
  "Packaging",
  "ReconciliationNeeded",
];
export const terminalStates: TaskState[] = ["Published", "Cancelled", "Failed"];
export const characterSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(60),
  description: z.string().min(10).max(1200),
  state: z.string().min(1).max(1200),
  referenceImage: z.string().url().optional(),
  voiceReference: z.string().url().optional(),
});
export const planSchema = z.object({
  englishPrompt: z.string().min(5).max(2400),
  title: z.string().min(1).max(100),
  summary: z.string().min(10).max(1200),
  bridge: z.string().max(1200),
  videoPrompt: z.string().min(20).max(6000),
  language: z.literal("en"),
  durationSeconds: z.number().min(1).max(60),
  characterIds: z.array(z.string()).max(3),
  newCharacters: z.array(characterSchema).max(2),
  proposedEvents: z.array(z.string().min(1).max(400)).max(8),
  characterUpdates: z
    .array(z.object({ id: z.string(), state: z.string().min(1).max(1200) }))
    .max(3),
  requiresReview: z.boolean(),
  majorChanges: z.array(majorChangeSchema).max(3).default([]),
  reason: z.string().max(600),
  rejected: z.boolean(),
});
export type ScenePlan = z.infer<typeof planSchema>;
export const storyInputSchema = z.object({
  title: z.string().trim().min(3).max(80),
  logline: z.string().trim().min(20).max(240),
  genre: z.enum([
    "Mystery",
    "Science fiction",
    "Fantasy",
    "Adventure",
    "Drama",
  ]),
  worldRules: z.string().trim().min(30).max(4000),
  visualStyle: z.string().trim().min(10).max(700),
  characters: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().min(10).max(1200),
        state: z.string().trim().min(5).max(1200),
      }),
    )
    .min(1)
    .max(3),
});
export const promptInputSchema = z.object({
  generationMode: z.enum(["text", "reference"]).default("text"),
  proposalIds: z.array(z.string().uuid()).max(5).default([]),
  prompt: z.string().trim().min(10).max(2000),
  idempotencyKey: z.string().uuid(),
  characterIds: z
    .array(z.string().min(1).max(80))
    .max(3)
    .default([])
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Choose each character once.",
    ),
});
export interface User {
  id: string;
  displayName: string;
  role: "user" | "admin";
  email?: string;
  policyAccepted: boolean;
}
export interface Character {
  id: string;
  storyId: string;
  name: string;
  description: string;
  state: string;
  introducedVersion: number;
  referenceImage?: string;
}
export interface Story {
  id: string;
  slug: string;
  ownerId: string;
  title: string;
  logline: string;
  genre: string;
  worldRules: string;
  visualStyle: string;
  status: "draft" | "open" | "paused";
  version: number;
  coverUrl: string;
  fixture: boolean;
  sceneCount: number;
  episodeCount: number;
  durationMs: number;
  queueCount: number;
  createdAt: number;
  updatedAt: number;
}
export interface Episode {
  id: string;
  storyId: string;
  number: number;
  title: string;
  status: "open" | "complete";
  durationMs: number;
}
export interface Scene {
  productionSource: "generated" | "upload";
  contributors: { id: string; name: string; prompt: string }[];
  id: string;
  storyId: string;
  episodeId: string;
  version: number;
  title: string;
  summary: string;
  mediaUrl: string;
  captionsUrl: string;
  thumbnailUrl: string;
  durationMs: number;
  startMs: number;
  prompt: string;
  englishPrompt: string;
  author: string;
  authorId: string;
  source: "user" | "studio";
  fixture: boolean;
  publishedAt: number;
  hidden: boolean;
}
export interface Task {
  sourceKind: "generated" | "upload";
  billingKind: "points" | "legacy-free" | "upload";
  proposalIds: string[];
  uploadReady: boolean;
  videoUrl: string | null;
  ownerReview: OwnerReview | null;
  generationMode: GenerationMode;
  quotedPoints: number;
  id: string;
  storyId: string;
  userId: string;
  author: string;
  prompt: string;
  requestedCharacterIds: string[];
  status: TaskState;
  plan: ScenePlan | null;
  baseVersion: number;
  sequence: number | null;
  queuePosition: number | null;
  reason: string;
  createdAt: number;
  updatedAt: number;
  sceneId: string | null;
}
export interface Settings {
  generationEnabled: boolean;
  dailyCredits: number;
  dailyBudgetCents: number;
  monthlyBudgetCents: number;
  taskReserveCents: number;
  maxQueuePerStory: number;
  maxStoriesPerUser: number;
  providerBalanceCents: number;
  providerCheckedAt: number;
  providerReservedCents: number;
  providerDebitedCents: number;
  policyVersion: string;
}
export interface AppConfig {
  environment: string;
  providerMode: string;
  development: boolean;
  canSignIn: boolean;
  turnstileSiteKey: string;
  generationEnabled: boolean;
  paymentsEnabled: boolean;
  referenceEnabled: boolean;
  referencePoints: number;
  textEnabled: boolean;
  textPoints: number;
  uploadsEnabled: boolean;
  supportEmail: string;
}
export interface StoryDetail {
  story: Story;
  characters: Character[];
  episodes: Episode[];
  scenes: Scene[];
  queue: Task[];
  progress?: { episodeId: string; timeMs: number; updatedAt?: number } | null;
}
export interface Credits {
  available: number;
  reserved: number;
  spent: number;
  limit: number;
  resetsAt: number;
}
export function periodKeys(now = Date.now()) {
  const iso = new Date(now).toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}
export function nextReset(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export function formatTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function sceneAt(scenes: Scene[], timeMs: number): Scene | undefined {
  return scenes.find(
    (s, i) =>
      timeMs >= s.startMs &&
      (timeMs < s.startMs + s.durationMs ||
        (i === scenes.length - 1 && timeMs === s.startMs + s.durationMs)),
  );
}
export function validatePlan(plan: ScenePlan, characters: Character[]) {
  if (
    new Set(plan.newCharacters.map((c) => c.id)).size !==
    plan.newCharacters.length
  )
    throw new Error("Duplicate character IDs.");
  const ids = new Set(characters.map((c) => c.id));
  const normalizeName = (name: string) =>
    name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const names = new Set(characters.map((c) => normalizeName(c.name)));
  for (const c of plan.newCharacters) {
    if (ids.has(c.id))
      throw new Error("A new character cannot reuse an existing ID.");
    ids.add(c.id);
    const name = normalizeName(c.name);
    if (names.has(name))
      throw new Error(
        "A character with this name already exists. Review their identity before adding a new character.",
      );
    names.add(name);
  }
  if (
    [...plan.characterIds, ...plan.characterUpdates.map((c) => c.id)].some(
      (id) => !ids.has(id),
    )
  )
    throw new Error("The plan refers to a character outside this story.");
}
