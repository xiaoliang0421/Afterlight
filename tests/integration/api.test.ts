import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.AFTERLIGHT_TEST_ORIGIN;
if (!base || new URL(base).hostname !== "127.0.0.1")
  throw new Error(
    "Run npm run test:integration to use an isolated local database.",
  );
type Result = { status: number; data: any; response: Response };
function client() {
  let cookie = "";
  return async (
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Result> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Origin: base!,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.getSetCookie();
    if (set.length) cookie = set.map((s) => s.split(";")[0]).join("; ");
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, response };
  };
}
const guest = client(),
  creator = client(),
  studio = client(),
  newcomer = client();
async function ok(promise: Promise<Result>) {
  const r = await promise;
  assert.ok(
    r.status >= 200 && r.status < 300,
    JSON.stringify({ status: r.status, data: r.data }),
  );
  return r.data;
}
async function waitTask(
  call: ReturnType<typeof client>,
  id: string,
  expected: string,
) {
  const deadline = Date.now() + 35000;
  let task: any;
  do {
    task = (await ok(call(`/api/tasks/${id}`))).task;
    if (task.status === expected) return task;
    if (["Failed", "ReconciliationNeeded"].includes(task.status))
      assert.fail(JSON.stringify(task));
    await new Promise((resolve) => setTimeout(resolve, 300));
  } while (Date.now() < deadline);
  assert.fail(`Expected ${expected}: ${JSON.stringify(task)}`);
}

test("Cloudflare runtime: login, authorship, independent stories, FIFO workflow and credit accounting", async (t) => {
  await t.test(
    "public endpoints omit private emails; unknown API paths do not return SPA HTML",
    async () => {
      const publicData = await ok(guest("/api/bootstrap"));
      assert.equal(publicData.user, null);
      assert.equal(publicData.stories.length, 2);
      assert.ok(!JSON.stringify(publicData).includes("@"));
      assert.equal((await guest("/api/unknown")).status, 404);
      assert.equal((await guest("/api/admin/")).status, 401);
      assert.equal(
        (
          await guest(
            "/api/dev/login",
            "POST",
            { persona: "creator" },
            { Origin: "https://attacker.invalid" },
          )
        ).status,
        403,
      );
      await ok(creator("/api/dev/login", "POST", { persona: "creator" }));
      await ok(studio("/api/dev/login", "POST", { persona: "studio" }));
      await ok(newcomer("/api/dev/login", "POST", { persona: "newcomer" }));
      assert.equal((await creator("/api/admin/")).status, 403);
      assert.equal(
        (await creator("/api/billing/checkout", "POST", {})).status,
        403,
      );
    },
  );
  await t.test(
    "first login requires a public nickname and rejects an email as nickname",
    async () => {
      const body = {
        prompt: "Mara listens closely to the faint signal.",
        idempotencyKey: randomUUID(),
      };
      assert.equal(
        (await newcomer("/api/stories/last-light/tasks", "POST", body)).data
          .error.code,
        "nickname_required",
      );
      assert.equal(
        (
          await newcomer("/api/account/profile", "PUT", {
            nickname: "someone@example.com",
          })
        ).status,
        400,
      );
      await ok(
        newcomer("/api/account/profile", "PUT", {
          nickname: "New storyteller",
        }),
      );
      const me = await ok(newcomer("/api/bootstrap"));
      assert.equal(me.user.displayName, "New storyteller");
      assert.ok(me.user.email);
      const publicProfile = await ok(guest(`/api/people/${me.user.id}`));
      assert.ok(!JSON.stringify(publicProfile).includes("@"));
    },
  );
  let a: any, b: any, c: any;
  await t.test(
    "duplicate concurrent drafts preserve one permanent contribution ID",
    async () => {
      const body = {
        prompt: "Mara raises her lantern beside the locked brass door.",
        idempotencyKey: randomUUID(),
      };
      const [first, duplicate] = await Promise.all([
        ok(creator("/api/stories/last-light/tasks", "POST", body)),
        ok(creator("/api/stories/last-light/tasks", "POST", body)),
      ]);
      assert.equal(first.task.id, duplicate.task.id);
      a = first.task;
      assert.equal(
        (await creator("/api/stories/quiet-orbit/tasks", "POST", body)).status,
        409,
      );
      assert.equal((await studio(`/api/tasks/${a.id}`)).status, 403);
    },
  );
  await t.test(
    "FIFO admission is story-scoped; moderation in one story does not block another",
    async () => {
      a = (await ok(creator(`/api/tasks/${a.id}/preview`, "POST", {}))).task;
      await ok(
        creator(`/api/tasks/${a.id}/accept`, "POST", {
          planUpdatedAt: a.updatedAt,
          publicAttributionAccepted: true,
        }),
      );
      a = await waitTask(creator, a.id, "NeedsModeration");
      b = (
        await ok(
          creator("/api/stories/quiet-orbit/tasks", "POST", {
            prompt: "Inez turns the sealed log toward her helmet light.",
            idempotencyKey: randomUUID(),
          }),
        )
      ).task;
      b = (await ok(creator(`/api/tasks/${b.id}/preview`, "POST", {}))).task;
      assert.ok(
        b.plan.characterIds.every((id: string) =>
          ["inez-sol", "theo-ward"].includes(id),
        ),
      );
      await ok(
        creator(`/api/tasks/${b.id}/accept`, "POST", {
          planUpdatedAt: b.updatedAt,
          publicAttributionAccepted: true,
        }),
      );
      b = await waitTask(creator, b.id, "NeedsModeration");
      for (const task of [a, b]) {
        let state = "";
        for (let attempt = 0; attempt < 20; attempt++) {
          state = (await ok(studio(`/api/admin/tasks/${task.id}/runtime`)))
            .status;
          if (state === "complete") break;
          await new Promise((r) => setTimeout(r, 200));
        }
        assert.equal(
          state,
          "complete",
          "The fixture workflow must finish its durable steps.",
        );
      }
      c = (
        await ok(
          studio("/api/stories/last-light/tasks", "POST", {
            prompt: "Mara waits beside the door and studies the brass key.",
            idempotencyKey: randomUUID(),
          }),
        )
      ).task;
      c = (await ok(studio(`/api/tasks/${c.id}/preview`, "POST", {}))).task;
      c = (
        await ok(
          studio(`/api/tasks/${c.id}/accept`, "POST", {
            planUpdatedAt: c.updatedAt,
            publicAttributionAccepted: true,
          }),
        )
      ).task;
      assert.equal(c.status, "Queued");
      const own = await ok(creator("/api/bootstrap"));
      assert.equal(own.credits.reserved, 2);
      assert.equal(own.credits.spent, 0);
      const queue = await ok(guest("/api/stories/last-light"));
      assert.ok(queue.queue.every((q: any) => !q.prompt && !q.plan));
    },
  );
  await t.test(
    "unapproved footage is private and cross-story playback positions are rejected",
    async () => {
      assert.equal((await guest(`/api/scenes/${a.id}/video`)).status, 404);
      assert.equal(
        (await creator(`/api/admin/tasks/${a.id}/video`)).status,
        403,
      );
      assert.equal(
        (
          await creator("/api/stories/last-light/progress", "PUT", {
            episodeId: "quiet-orbit:episode:1",
            timeMs: 0,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "actual-content approval publishes once; next queued idea is rechecked against new canon",
    async () => {
      const review = {
        summary:
          "Development sample: a lighthouse stands above a rocky coastline.",
        events: ["The lighthouse beacon is visible."],
        englishAudio: true,
        englishText: true,
        continuity: true,
        contentSafe: true,
        captions: "",
        noDialogue: true,
        characterUpdates: [],
        newCharacterIds: [],
      };
      await ok(studio(`/api/admin/tasks/${a.id}/approve`, "POST", review));
      await ok(studio(`/api/admin/tasks/${a.id}/approve`, "POST", review));
      c = await waitTask(studio, c.id, "NeedsReview");
      assert.equal(c.baseVersion, 4);
      const story = await ok(guest("/api/stories/last-light"));
      const published = story.scenes.find((s: any) => s.id === a.id);
      assert.equal(published.authorId, "dev-creator");
      assert.equal(published.startMs, 30000);
      assert.equal(story.scenes.length, 4);
      const credits = (await ok(creator("/api/bootstrap"))).credits;
      assert.equal(credits.spent, 1);
      assert.equal(credits.reserved, 1);
      await ok(creator("/api/account/profile", "PUT", { nickname: "River" }));
      const renamed = await ok(guest("/api/stories/last-light"));
      assert.equal(
        renamed.scenes.find((s: any) => s.id === a.id).author,
        "River",
      );
      const profile = await ok(guest("/api/people/dev-creator"));
      assert.equal(profile.contributions[0].id, a.id);
      assert.ok(!JSON.stringify(profile).includes("@"));
      assert.equal(
        (await newcomer("/api/account/profile", "PUT", { nickname: "RIVER" }))
          .status,
        409,
      );
      const shared = await guest(`/story/the-last-light?scene=${a.id}`);
      assert.equal(shared.status, 200);
      assert.match(shared.data, /Imagined by River/);
      assert.equal(
        (await guest(`/api/scenes/${a.id}/video`, "HEAD")).status,
        200,
      );
    },
  );
  await t.test(
    "author can withdraw a revised idea; rejected footage returns credit",
    async () => {
      await ok(studio(`/api/tasks/${c.id}/cancel`, "POST", {}));
      await ok(
        studio(`/api/admin/tasks/${b.id}/reject`, "POST", {
          reason: "The sample does not fulfill the proposed events.",
        }),
      );
      const credits = (await ok(creator("/api/bootstrap"))).credits;
      assert.equal(credits.reserved, 0);
      assert.equal(credits.spent, 1);
      assert.equal(credits.available, 2);
    },
  );
  await t.test(
    "new worlds stay private until the owner opens them; characters and progress stay scoped",
    async () => {
      const input = {
        title: "The Paper Moon",
        logline:
          "A courier finds an unopened letter addressed to the city itself.",
        genre: "Mystery",
        worldRules:
          "A coastal city in 1978. Events follow ordinary causality and there is no established magic.",
        visualStyle: "Warm natural light and restrained film grain.",
        characters: [
          {
            name: "June",
            description: "A quiet courier wearing a charcoal jacket.",
            state: "Standing outside the post office.",
          },
        ],
      };
      const story = (await ok(newcomer("/api/stories", "POST", input))).story;
      assert.equal((await guest(`/api/stories/${story.id}`)).status, 404);
      assert.equal(
        (await creator(`/api/stories/${story.id}`, "PATCH", { status: "open" }))
          .status,
        403,
      );
      await ok(
        newcomer(`/api/stories/${story.id}`, "PATCH", { status: "open" }),
      );
      const world = await ok(guest(`/api/stories/${story.id}`));
      assert.equal(world.scenes.length, 0);
      assert.equal(world.queue.length, 0);
      assert.equal(world.characters.length, 1);
      assert.ok(world.characters[0].id.startsWith(story.id));
      await ok(
        creator("/api/stories/last-light/progress", "PUT", {
          episodeId: "last-light:episode:1",
          timeMs: 11000,
        }),
      );
      assert.equal(
        (await ok(creator("/api/stories/quiet-orbit"))).progress,
        null,
      );
    },
  );
  await t.test(
    "private account requests can be submitted and withdrawn, and are visible only to the studio",
    async () => {
      await ok(
        creator("/api/account/requests", "POST", {
          kind: "deletion",
          reason: "Local privacy workflow test.",
        }),
      );
      await ok(
        creator("/api/account/requests", "POST", {
          kind: "deletion",
          reason: "Duplicate submit.",
        }),
      );
      const own = await ok(creator("/api/account/requests"));
      assert.equal(own.requests.length, 1);
      assert.equal((await guest("/api/admin/account-requests")).status, 401);
      assert.equal((await newcomer("/api/admin/account-requests")).status, 403);
      const privateRequests = await ok(studio("/api/admin/account-requests"));
      assert.equal(privateRequests.requests[0].userId, "dev-creator");
      await ok(
        creator(
          `/api/account/requests/${own.requests[0].id}/cancel`,
          "POST",
          {},
        ),
      );
      assert.equal(
        (await ok(studio("/api/admin/account-requests"))).requests.length,
        0,
      );
    },
  );
  await t.test(
    "only the studio can approve character references and every edit has a version",
    async () => {
      const path = "/api/admin/stories/last-light/characters/mara-vale";
      assert.equal(
        (
          await creator(path, "PATCH", {
            referenceImage: "https://assets.example.com/mara.png",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await studio(path, "PATCH", {
            referenceImage: "https://127.0.0.1/private",
          })
        ).status,
        400,
      );
      await ok(
        studio(path, "PATCH", {
          referenceImage: "https://assets.example.com/mara.png",
          voiceReference: "https://assets.example.com/mara.mp3",
          voiceDurationMs: 3000,
        }),
      );
      const materials = await ok(studio("/api/admin/materials"));
      const mara = materials.characters.find((c: any) => c.id === "mara-vale");
      assert.equal(mara.materialVersion, 2);
      assert.equal(
        (
          await studio(
            "/api/admin/stories/quiet-orbit/characters/mara-vale",
            "PATCH",
            { referenceImage: "https://assets.example.com/mara.png" },
          )
        ).status,
        404,
      );
    },
  );
});
