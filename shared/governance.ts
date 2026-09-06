import { z } from "zod";
import type { ScenePlan } from "./domain";

export const majorChangeSchema = z.enum([
  "character-death",
  "identity-change",
  "world-rules",
]);
export type MajorChange = z.infer<typeof majorChangeSchema>;
export const majorChangeLabels: Record<MajorChange, string> = {
  "character-death": "Character death or resurrection",
  "identity-change": "A lasting identity change",
  "world-rules": "A change to the world’s rules",
};
export type OwnerReviewStatus =
  "pending" | "approved" | "rejected" | "expired" | "withdrawn";
export interface OwnerReview {
  id: string;
  status: OwnerReviewStatus;
  note: string;
}
export interface OwnerReviewItem extends OwnerReview {
  taskId: string;
  storyId: string;
  storyTitle: string;
  storySlug: string;
  worldRules: string;
  contextVersion: number;
  latestSummary: string | null;
  cast: { id: string; name: string; description: string; state: string }[];
  authorId: string;
  author: string;
  prompt: string;
  plan: ScenePlan;
  baseVersion: number;
  createdAt: number;
  decidedAt: number | null;
}
export function needsOwnerReview(plan: ScenePlan | null | undefined) {
  return !!plan?.majorChanges?.length;
}

// A conservative English backstop supplements the model’s semantic classification.
// It intentionally allows false positives; it is not a multilingual safety classifier.
export function detectMajorChanges(text: string): MajorChange[] {
  const changes: MajorChange[] = [];
  if (
    /\b(die[sd]?|dying|death|dead|kill(?:s|ed|ing)?|resurrect\w*|revive[sd]?|murder\w*)\b/i.test(
      text,
    )
  )
    changes.push("character-death");
  if (
    /\b(changes? (?:their |his |her )?identity|secretly (?:is|was)|replaced by|impost[eo]r|becomes? (?:a |an )?(?:different person|vampire|robot)|true identity)\b/i.test(
      text,
    )
  )
    changes.push("identity-change");
  if (
    /\b(rewrite|retcon|world rules?|time travel|teleport\w*|new (?:law|rule) of physics)\b/i.test(
      text,
    )
  )
    changes.push("world-rules");
  return changes;
}
export function flagMajorChanges(plan: ScenePlan, original = "") {
  plan.majorChanges = [
    ...new Set([
      ...(plan.majorChanges ?? []),
      ...detectMajorChanges(
        [
          original,
          plan.englishPrompt,
          plan.summary,
          plan.videoPrompt,
          ...plan.proposedEvents,
          ...plan.characterUpdates.map((c) => c.state),
        ].join("\n"),
      ),
    ]),
  ];
  return plan;
}
