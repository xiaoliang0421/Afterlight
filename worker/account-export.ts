import { Hono } from "hono";
import { z } from "zod";
import {
  exportSections,
  type ExportSection,
  type ExportManifest,
} from "../shared/account-export";
import { requireUser, rateLimit, type AppEnv } from "./auth";
import { AppError } from "./errors";
import { audit } from "./store";

// Each section has an explicit projection and an authenticated-owner predicate.
// Never export SELECT *, OAuth tokens, provider URLs, storage keys or raw audit payloads.
const queries: Record<
  ExportSection,
  { table: string; owner: string; fields: string }
> = {
  profile: {
    table: "users",
    owner: "t.id",
    fields: "t.id,t.email,t.display_name,t.created_at",
  },
  signInProfile: {
    table: '"user"',
    owner: "t.id",
    fields:
      "t.id,t.name,t.email,t.emailVerified,t.image,t.createdAt,t.updatedAt",
  },
  linkedAccounts: {
    table: '"account"',
    owner: "t.userId",
    fields: "t.providerId,t.accountId,t.scope,t.createdAt,t.updatedAt",
  },
  sessions: {
    table: '"session"',
    owner: "t.userId",
    fields: "t.createdAt,t.updatedAt,t.expiresAt,t.ipAddress,t.userAgent",
  },
  stories: {
    table: "stories",
    owner: "t.owner_id",
    fields:
      "t.id,t.slug,t.title,t.logline,t.genre,t.world_rules,t.visual_style,t.language,t.status,t.version,t.created_at,t.updated_at",
  },
  ideas: {
    table: "tasks",
    owner: "t.user_id",
    fields:
      "t.id,t.story_id,t.prompt_original,t.plan_json,t.approved_plan_json,t.requested_character_ids_json,t.status,t.reason,t.base_version,t.queue_sequence,t.generation_mode,t.quoted_points,t.terms_version,t.attribution_accepted_at,t.created_at,t.updated_at",
  },
  scenes: {
    table: "scenes",
    owner: "t.author_id",
    fields:
      "t.id,t.story_id,t.episode_id,t.task_id,t.version,t.title,t.summary,t.duration_ms,t.start_ms,t.prompt_original,t.english_prompt,t.hidden,t.published_at",
  },
  speechChecks: {
    table: "speech_checks",
    owner: "(SELECT user_id FROM tasks WHERE id=t.task_id)",
    fields:
      "t.task_id,t.status,t.result_json,t.failure_code,t.created_at,t.updated_at",
  },
  freeCredits: {
    table: "credit_accounts",
    owner: "t.user_id",
    fields: "t.period,t.limit_units,t.reserved,t.spent",
  },
  purchasedCredits: {
    table: "paid_credit_accounts",
    owner: "t.user_id",
    fields: "t.balance,t.reserved,t.spent",
  },
  creditHistory: {
    table: "ledger",
    owner: "t.user_id",
    fields: "t.id,t.task_id,t.kind,t.units,t.policy_version,t.created_at",
  },
  orders: {
    table: "payment_orders",
    owner: "t.user_id",
    fields:
      "t.id,t.package_id,t.environment,t.points,t.amount_cents,t.currency,t.provider_transaction_id,t.status,t.terms_version,t.accepted_at,t.granted_points,t.billing_hold,t.total_paid_cents,t.tax_cents,t.created_at,t.updated_at",
  },
  purchaseHistory: {
    table: "paid_credit_ledger",
    owner: "t.user_id",
    fields: "t.id,t.order_id,t.points_delta,t.created_at",
  },
  billingRequests: {
    table: "billing_requests",
    owner: "t.user_id",
    fields:
      "t.id,t.order_id,t.reason,t.status,t.response,t.created_at,t.resolved_at",
  },
  savedStories: {
    table: "favorites",
    owner: "t.user_id",
    fields: "t.story_id",
  },
  watchProgress: {
    table: "watch_progress",
    owner: "t.user_id",
    fields: "t.story_id,t.episode_id,t.time_ms,t.updated_at",
  },
  notifications: {
    table: "notifications",
    owner: "t.user_id",
    fields: "t.id,t.story_id,t.task_id,t.message,t.read_at,t.created_at",
  },
  reports: {
    table: "reports",
    owner: "t.user_id",
    fields: "t.id,t.story_id,t.scene_id,t.reason,t.status,t.created_at",
  },
  accountRequests: {
    table: "account_requests",
    owner: "t.user_id",
    fields:
      "t.id,t.kind,t.reason,t.status,t.response,t.responded_at,t.created_at,t.resolved_at",
  },
  policyAcceptances: {
    table: "policy_acceptances",
    owner: "t.user_id",
    fields:
      "t.version,t.accepted_at,t.terms_accepted,t.privacy_acknowledged,(SELECT document_json FROM policy_documents WHERE version=t.version) AS document_json",
  },
  contributionAcceptances: {
    table: "contribution_acceptances",
    owner: "t.user_id",
    fields:
      "t.task_id,t.queue_sequence,t.terms_version,t.plan_version,t.approved_plan_json,t.accepted_at",
  },
  storyChangeRequests: {
    table: "owner_reviews",
    owner: "t.requester_id",
    fields:
      "t.id,t.task_id,t.story_id,t.plan_revision,t.plan_json,t.base_version,t.status,t.note,t.created_at,t.decided_at",
  },
  storyChangeDecisions: {
    table: "owner_reviews",
    owner: "t.decided_by",
    fields: "t.id,t.task_id,t.story_id,t.status,t.note,t.decided_at",
  },
};

export const accountExport = new Hono<AppEnv>();
accountExport.post("/", async (c) => {
  const user = requireUser(c);
  await rateLimit(c.env, `account-export:${user.id}`, 6, 3600000);
  const startedAt = new Date().toISOString();
  const bounds = await c.env.DB.batch<{ through: number; count: number }>(
    exportSections.map((name) => {
      const q = queries[name];
      return c.env.DB.prepare(
        `SELECT COALESCE(MAX(t.rowid),0) AS through,COUNT(*) AS count FROM ${q.table} t WHERE ${q.owner}=?`,
      ).bind(user.id);
    }),
  );
  await audit(c.env, user.id, "account.export-started", user.id);
  const manifest: ExportManifest = {
    format: "talerelay-account-records-v1",
    accountId: user.id,
    startedAt,
    sections: exportSections.map((name, i) => ({
      name,
      ...bounds[i].results[0],
    })),
    notes: [
      "This file contains private account information. Store and share it carefully.",
      "Records are read while the export runs; updates or removals during download may be reflected. This is not a database snapshot.",
      "Includes your account profiles, sign-in session metadata, story and scene text, submitted ideas, credits, orders, saved stories, viewing progress, reports, requests and acceptance records.",
      "Video and reference files are not bundled. Authentication secrets, other contributors' private drafts, internal security logs and records held separately by service providers are not included. Contact support for additional access requests.",
      "Fields ending in _json contain JSON-encoded text. Monetary amounts are in the stated currency's smallest unit; credits and creation points are separate units.",
    ],
  };
  return c.json(manifest);
});

accountExport.post("/page", async (c) => {
  const user = requireUser(c);
  const input = z
    .object({
      accountId: z.string().min(1).max(200),
      section: z.enum(exportSections),
      after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict()
    .parse(await c.req.json());
  if (input.accountId !== user.id)
    throw new AppError(
      "export_account_changed",
      "The signed-in account changed. Start a new download.",
      409,
    );
  if (input.after > input.through)
    throw new AppError("invalid_input", "The export cursor is invalid.", 400);
  await rateLimit(c.env, `account-export-page:${user.id}`, 240);
  const q = queries[input.section];
  const result = await c.env.DB.prepare(
    `SELECT t.rowid AS export_cursor,${q.fields} FROM ${q.table} t WHERE ${q.owner}=? AND t.rowid>? AND t.rowid<=? ORDER BY t.rowid LIMIT 101`,
  )
    .bind(user.id, input.after, input.through)
    .all<Record<string, unknown> & { export_cursor: number }>();
  const rows = result.results.slice(0, 100);
  return c.json({
    accountId: user.id,
    section: input.section,
    rows: rows.map(({ export_cursor: _cursor, ...row }) => row),
    next:
      result.results.length > 100 ? rows[rows.length - 1].export_cursor : null,
  });
});
