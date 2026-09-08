import { t as tr } from "./i18n";
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
        {r.error ? <Notice danger>{tr(r.error)}</Notice> : <Loading />}
        <Button onClick={() => void r.reload()}>
          {tr("Refresh community")}
        </Button>
      </>
    );
  return (
    <section className="community-panel">
      <h2>{tr("Stories & community")}</h2>
      <p>
        {tr(
          "Review every public story introduction and nickname. Invitations allow participation; they never grant publication or studio authority.",
        )}
      </p>
      {error && <Notice danger>{tr(error)}</Notice>}
      <h3>{tr("Story publication")}</h3>
      <div className="community-list">
        {r.data.stories.map((s) => (
          <article key={s.id}>
            <div>
              <strong>{s.title}</strong>
              <p>{s.logline}</p>
              <small>
                {tr(s.reviewStatus ?? "")}
                {s.publicationHold ? tr(" · Publishing held by studio") : ""}
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
              {tr("Review story")}
            </Button>
          </article>
        ))}
      </div>
      <h3>{tr("Invitations & public names")}</h3>
      <p className="fine-print">
        {tr(
          "Ask an invited person to sign in first, then find their exact account email here. A login alone cannot create or publish.",
        )}
      </p>
      <div className="community-list">
        {r.data.users.map((u) => (
          <article key={u.id}>
            <div>
              <strong>{u.nickname || tr("No nickname yet")}</strong>
              <p>{u.email}</p>
              <small>
                {tr(u.access)} {tr("· Public name:")}{" "}
                {u.publicName || tr("Storyteller (not approved)")}
              </small>
            </div>
            <Button kind="secondary" onClick={() => setUser(u)}>
              {tr("Review account")}
            </Button>
          </article>
        ))}
      </div>
      {user && (
        <Modal
          title={tr("Account invitation & public name")}
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
        <Modal
          title={tr("Review story introduction")}
          onClose={() => setStory(null)}
        >
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
        <dt>{tr("Requested public nickname")}</dt>
        <dd>{member.nickname || tr("Not chosen")}</dd>
        <dt>{tr("Currently public")}</dt>
        <dd>{member.publicName || tr("Storyteller")}</dd>
      </dl>
      <label className="field-label">
        {tr("Reason for this decision")}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={10}
          maxLength={600}
        />
      </label>
      {error && <Notice danger>{tr(error)}</Notice>}
      <div className="form-actions">
        <Button
          busy={busy}
          disabled={reason.trim().length < 10 || member.nickname.length < 2}
          onClick={() => void act("approve")}
        >
          {tr("Approve this public name")}
        </Button>
        <Button
          kind="danger"
          busy={busy}
          disabled={reason.trim().length < 10 || member.nickname.length < 2}
          onClick={() => void act("reject")}
        >
          {tr("Remove public name")}
        </Button>
      </div>
      <label className="field-label">
        {tr("Contribution access")}
        <select
          value={access}
          disabled={member.role === "admin"}
          onChange={(e) => setAccess(e.target.value)}
        >
          <option value="none">{tr("Watching only")}</option>
          <option value="member">
            {tr("Invited participant · propose ideas")}
          </option>
          <option value="host">
            {tr("Invited host · create stories and upload")}
          </option>
          <option value="suspended">{tr("Suspend contributions")}</option>
        </select>
      </label>
      <p className="fine-print">
        {tr(
          "Suspension stops new creative work and publication. Account requests and deletion remain available. Remove an unsafe public name or block a story separately when required.",
        )}
      </p>
      <Button
        busy={busy}
        disabled={reason.trim().length < 10 || member.role === "admin"}
        onClick={() => void act("access")}
      >
        {tr("Save contribution access")}
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
        <strong>{tr("Genre:")}</strong> {review.story.genre}
      </p>
      <h4>{tr("World rules")}</h4>
      <p className="preserve-lines">{review.story.worldRules}</p>
      <h4>{tr("Visual style")}</h4>
      <p>{review.story.visualStyle}</p>
      <h4>{tr("Cover")}</h4>
      {review.story.coverUrl && (
        <img
          className="community-cover"
          src={review.story.coverUrl}
          alt={tr("Story cover under review")}
        />
      )}
      <h4>{tr("Characters")}</h4>
      {review.characters.map((c) => (
        <article key={c.id}>
          <strong>{c.name}</strong>
          <p>{c.description}</p>
          <p>{c.state}</p>
          {c.referenceImage && (
            <img
              className="community-cover"
              src={c.referenceImage}
              alt={tr("{0} reference under review", c.name)}
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
          {tr(
            "I reviewed the title, introduction, world rules, character text, images and publication restrictions for content safety, privacy, rights and English-language suitability.",
          )}
        </span>
      </label>
      <label className="field-label">
        {tr("Decision reason")}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={600}
        />
      </label>
      {error && <Notice danger>{tr(error)}</Notice>}
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
            {tr(label)}
          </Button>
        ))}
      </div>
    </>
  );
}
