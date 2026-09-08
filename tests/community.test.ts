import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { migrateFixture, adaptD1 } from "./support/database";
import { moderation } from "../worker/moderation";
import {
  communityAccess,
  requireContributor,
  visibleStory,
} from "../worker/community";
import { getStory, getScenes, listStories } from "../worker/store";
import { normalizeError } from "../worker/errors";
import { dispatchArchives } from "../worker/archives";
import type { AppEnv } from "../worker/auth";

function setup() {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  db.exec(
    "UPDATE settings SET invitation_only=1; UPDATE users SET contribution_access='host' WHERE id='dev-studio'",
  );
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "disabled",
    STORY_ROOMS: {
      getByName: () => ({ kick: async () => {}, broadcast: async () => {} }),
    },
  } as unknown as Cloudflare.Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const id = c.req.header("X-User") || "dev-studio";
    c.set("user", {
      id,
      role: id === "dev-studio" ? "admin" : "user",
      displayName: id,
      policyAccepted: true,
    });
    await next();
  });
  app.post("/contribute", async (c) =>
    c.json({ user: (await requireContributor(c)).id }),
  );
  app.post("/host", async (c) =>
    c.json({ user: (await requireContributor(c, true)).id }),
  );
  app.route("/admin", moderation);
  app.onError((e, c) => {
    const err = normalizeError(e);
    return c.json({ error: err.code }, err.status);
  });
  const call = (path: string, body?: unknown, user = "dev-studio") =>
    app.request(
      path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { "X-User": user, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  return { db, env, call };
}
const explanation =
  "Checked the actual introduction and its content and rights.";
test("invitation checks cover both API creation and database writes, independently of studio privileges", async () => {
  const s = setup();
  try {
    assert.deepEqual(
      await communityAccess(s.env, { id: "dev-creator" } as any),
      { canContribute: false, canHost: false },
    );
    assert.equal((await s.call("/contribute", {}, "dev-creator")).status, 403);
    assert.throws(
      () =>
        s.db.exec(
          "INSERT INTO story_proposals(id,story_id,author_id,prompt,base_version,idempotency_key,terms_version,attribution_accepted_at,created_at,updated_at) VALUES('not-invited','last-light','dev-creator','An uninvited proposal.',3,'not-invited','test',1,1,1)",
        ),
      /invitation_required/,
    );
    assert.equal(
      (
        await s.call(
          "/admin/community/users/dev-creator",
          { access: "member", reason: explanation },
          "dev-creator",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await s.call("/admin/community/users/dev-creator", {
          access: "member",
          reason: explanation,
        })
      ).status,
      200,
    );
    assert.equal((await s.call("/contribute", {}, "dev-creator")).status, 200);
    assert.equal((await s.call("/host", {}, "dev-creator")).status, 403);
    await s.call("/admin/community/users/dev-creator", {
      access: "host",
      reason: explanation,
    });
    assert.equal((await s.call("/host", {}, "dev-creator")).status, 200);
    await s.call("/admin/community/users/dev-creator", {
      access: "suspended",
      reason: explanation,
    });
    assert.equal((await s.call("/contribute", {}, "dev-creator")).status, 403);
    assert.equal(
      (
        await s.call("/admin/community/users/dev-studio", {
          access: "suspended",
          reason: explanation,
        })
      ).status,
      409,
    );
  } finally {
    s.db.close();
  }
});
test("story approval checks an exact current snapshot; pending and blocked introductions stay private", async () => {
  const s = setup();
  try {
    s.db.exec(
      "UPDATE stories SET status='draft',review_status='pending' WHERE id='last-light'",
    );
    assert.throws(
      () => s.db.exec("UPDATE stories SET status='open' WHERE id='last-light'"),
      /story_review_required/,
    );
    assert.throws(() => visibleStory(awaitStory(), null), /not available/);
    function awaitStory() {
      return {
        id: "last-light",
        ownerId: "dev-studio",
        status: "draft",
        reviewStatus: "pending",
      } as any;
    }
    assert.equal(
      (await listStories(s.env)).some((x) => x.id === "last-light"),
      false,
    );
    const before = (await (
      await s.call("/admin/community/stories/last-light")
    ).json()) as any;
    s.db.exec(
      "UPDATE stories SET logline='The introduction changed after the reviewer opened the dialog.' WHERE id='last-light'",
    );
    assert.equal(
      (
        await s.call("/admin/community/stories/last-light", {
          action: "approve",
          token: before.token,
          reviewed: true,
          reason: explanation,
        })
      ).status,
      409,
    );
    const current = (await (
      await s.call("/admin/community/stories/last-light")
    ).json()) as any;
    assert.equal(
      (
        await s.call("/admin/community/stories/last-light", {
          action: "approve",
          token: current.token,
          reviewed: true,
          reason: explanation,
        })
      ).status,
      200,
    );
    visibleStory(await getStory(s.env, "last-light"), null);
    const open = (await (
      await s.call("/admin/community/stories/last-light")
    ).json()) as any;
    await s.call("/admin/community/stories/last-light", {
      action: "block",
      token: open.token,
      reviewed: true,
      reason: explanation,
    });
    assert.throws(
      () => s.db.exec("UPDATE stories SET status='open' WHERE id='last-light'"),
      /story_review_required/,
    );
    assert.equal(
      (await listStories(s.env)).some((x) => x.id === "last-light"),
      false,
    );
  } finally {
    s.db.close();
  }
});
test("public bylines keep the reviewed name until a matching review; late nickname decisions do not publish new text", async () => {
  const s = setup();
  try {
    s.db.exec(
      "UPDATE users SET display_name='A new unreviewed name' WHERE id='dev-studio'",
    );
    assert.equal(
      (await getScenes(s.env, "last-light"))[0].author,
      "Afterlight Studio",
    );
    assert.equal(
      (
        await s.call("/admin/community/users/dev-studio/name", {
          nickname: "Stale name",
          approved: true,
          reason: explanation,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await s.call("/admin/community/users/dev-studio/name", {
          nickname: "A new unreviewed name",
          approved: true,
          reason: explanation,
        })
      ).status,
      200,
    );
    assert.equal(
      (await getScenes(s.env, "last-light"))[0].author,
      "A new unreviewed name",
    );
    await s.call("/admin/community/users/dev-studio/name", {
      nickname: "A new unreviewed name",
      approved: false,
      reason: explanation,
    });
    assert.equal(
      (await getScenes(s.env, "last-light"))[0].author,
      "Storyteller",
    );
  } finally {
    s.db.close();
  }
});
test("a studio publication hold cannot be cleared by reopening; edits invalidate prior public metadata approval", () => {
  const s = setup();
  try {
    s.db.exec(
      "UPDATE stories SET status='paused',publication_hold=1 WHERE id='last-light'",
    );
    assert.throws(
      () => s.db.exec("UPDATE stories SET status='open' WHERE id='last-light'"),
      /story_review_required/,
    );
    s.db.exec(
      "UPDATE stories SET title='A different public title' WHERE id='last-light'",
    );
    assert.deepEqual(
      {
        ...s.db
          .prepare(
            "SELECT status,review_status FROM stories WHERE id='last-light'",
          )
          .get(),
      },
      { status: "draft", review_status: "pending" },
    );
  } finally {
    s.db.close();
  }
});
test("no-generation release does not dispatch paid archive workflows for uploaded publications", async () => {
  let dispatched = 0;
  await dispatchArchives({
    PROVIDER_MODE: "disabled",
    ARCHIVES: {
      create: async () => {
        dispatched++;
      },
    },
  } as unknown as Cloudflare.Env);
  assert.equal(dispatched, 0);
});
