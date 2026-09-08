import { useState } from "react";
import { api, useResource } from "./api";
import { Button, Modal, Notice, Loading } from "./components";
import type { Story, Character } from "../shared/domain";

type Member = {
  id: string;
  email: string;
  nickname: string;
  publicName: string;
  reviewNote: string;
  access: string;
  role: string;
};
type Review = { story: Story; characters: Character[]; token: string };
export function CommunityPanel() {
  const r = useResource<{
    users: Member[];
    stories: (Story & { host: string })[];
  }>("/admin/community");
  const [user, setUser] = useState<Member | null>(null),
    [story, setStory] = useState<Review | null>(null),
    [error, setError] = useState("");
  if (!r.data)
    return (
      <>
        {r.error ? <Notice danger>{r.error}</Notice> : <Loading />}
        <Button onClick={() => void r.reload()}>Refresh community</Button>
      </>
    );
  return (
    <section className="community-panel">
      <h2>Stories & community</h2>
      <p>
        Review every public story introduction and nickname. Invitations allow
        participation; they never grant publication or studio authority.
      </p>
      {error && <Notice danger>{error}</Notice>}
      <h3>Story publication</h3>
      <div className="community-list">
        {r.data.stories.map((s) => (
          <article key={s.id}>
            <div>
              <strong>{s.title}</strong>
              <p>{s.logline}</p>
              <small>
                {s.reviewStatus}
                {s.publicationHold ? " · Publishing held by studio" : ""}
              </small>
            </div>
            <Button
              kind="secondary"
              onClick={() =>
                void api<Review>(`/admin/community/stories/${s.id}`)
                  .then(setStory)
                  .catch((e) => setError(e.message))
              }
            >
              Review story
            </Button>
          </article>
        ))}
      </div>
      <h3>Invitations & public names</h3>
      <p className="fine-print">
        Ask an invited person to sign in first, then find their exact account
        email here. A login alone cannot create or publish.
      </p>
      <div className="community-list">
        {r.data.users.map((u) => (
          <article key={u.id}>
            <div>
              <strong>{u.nickname || "No nickname yet"}</strong>
              <p>{u.email}</p>
              <small>
                {u.access} · Public name:{" "}
                {u.publicName || "Storyteller (not approved)"}
              </small>
            </div>
            <Button kind="secondary" onClick={() => setUser(u)}>
              Review account
            </Button>
          </article>
        ))}
      </div>
      {user && (
        <Modal
          title="Account invitation & public name"
          onClose={() => setUser(null)}
        >
          <MemberReview
            member={user}
            done={async () => {
              setUser(null);
              await r.reload();
            }}
          />
        </Modal>
      )}
      {story && (
        <Modal title="Review story introduction" onClose={() => setStory(null)}>
          <StoryReview
            review={story}
            done={async () => {
              setStory(null);
              await r.reload();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
function MemberReview({
  member,
  done,
}: {
  member: Member;
  done: () => Promise<void>;
}) {
  const [access, setAccess] = useState(member.access),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const act = async (kind: "access" | "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await api(
        `/admin/community/users/${member.id}${kind === "access" ? "" : "/name"}`,
        "POST",
        kind === "access"
          ? { access, reason }
          : { nickname: member.nickname, approved: kind === "approve", reason },
      );
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>{member.email}</p>
      <dl>
        <dt>Requested public nickname</dt>
        <dd>{member.nickname || "Not chosen"}</dd>
        <dt>Currently public</dt>
        <dd>{member.publicName || "Storyteller"}</dd>
      </dl>
      <label className="field-label">
        Reason for this decision
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={10}
          maxLength={600}
        />
      </label>
      {error && <Notice danger>{error}</Notice>}
      <div className="form-actions">
        <Button
          busy={busy}
          disabled={reason.trim().length < 10 || member.nickname.length < 2}
          onClick={() => void act("approve")}
        >
          Approve this public name
        </Button>
        <Button
          kind="danger"
          busy={busy}
          disabled={reason.trim().length < 10 || member.nickname.length < 2}
          onClick={() => void act("reject")}
        >
          Remove public name
        </Button>
      </div>
      <label className="field-label">
        Contribution access
        <select
          value={access}
          disabled={member.role === "admin"}
          onChange={(e) => setAccess(e.target.value)}
        >
          <option value="none">Watching only</option>
          <option value="member">Invited participant · propose ideas</option>
          <option value="host">Invited host · create stories and upload</option>
          <option value="suspended">Suspend contributions</option>
        </select>
      </label>
      <p className="fine-print">
        Suspension stops new creative work and publication. Account requests and
        deletion remain available. Remove an unsafe public name or block a story
        separately when required.
      </p>
      <Button
        busy={busy}
        disabled={reason.trim().length < 10 || member.role === "admin"}
        onClick={() => void act("access")}
      >
        Save contribution access
      </Button>
    </>
  );
}
function StoryReview({
  review,
  done,
}: {
  review: Review;
  done: () => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const act = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/community/stories/${review.story.id}`, "POST", {
        action,
        reason,
        reviewed: checked,
        token: review.token,
      });
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>{review.story.title}</h3>
      <p>{review.story.logline}</p>
      <p>
        <strong>Genre:</strong> {review.story.genre}
      </p>
      <h4>World rules</h4>
      <p className="preserve-lines">{review.story.worldRules}</p>
      <h4>Visual style</h4>
      <p>{review.story.visualStyle}</p>
      <h4>Cover</h4>
      {review.story.coverUrl && (
        <img
          className="community-cover"
          src={review.story.coverUrl}
          alt="Story cover under review"
        />
      )}
      <h4>Characters</h4>
      {review.characters.map((c) => (
        <article key={c.id}>
          <strong>{c.name}</strong>
          <p>{c.description}</p>
          <p>{c.state}</p>
          {c.referenceImage && (
            <img
              className="community-cover"
              src={c.referenceImage}
              alt={`${c.name} reference under review`}
            />
          )}
        </article>
      ))}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>
          I reviewed the title, introduction, world rules, character text,
          images and publication restrictions for content safety, privacy,
          rights and English-language suitability.
        </span>
      </label>
      <label className="field-label">
        Decision reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={600}
        />
      </label>
      {error && <Notice danger>{error}</Notice>}
      <div className="form-actions">
        {[
          ["approve", "Approve & open"],
          ["reject", "Reject introduction"],
          ["block", "Block public access"],
        ].map(([action, label]) => (
          <Button
            key={action}
            kind={action === "block" ? "danger" : "secondary"}
            busy={busy}
            disabled={!checked || reason.trim().length < 10}
            onClick={() => void act(action)}
          >
            {label}
          </Button>
        ))}
      </div>
    </>
  );
}
