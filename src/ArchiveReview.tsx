import { useState } from "react";
import { BookOpen, Plus, RefreshCw } from "lucide-react";
import type { Archive, ArchiveContext } from "../shared/archive";
import { fallbackArchive } from "../shared/archive";
import { api, useResource } from "./api";
import { Button, Empty, Loading, Modal, Notice } from "./components";
import { useApp } from "./context";
interface Item {
  id: string;
  storyId: string;
  storyTitle: string;
  version: number;
  status: string;
  reason: string;
  model: string | null;
  context: ArchiveContext | null;
  draft: Archive | null;
  approved: Archive | null;
}
export function ArchiveReview() {
  const r = useResource<{ archives: Item[] }>("/admin/archives");
  const [selected, setSelected] = useState<Item | null>(null);
  if (r.loading) return <Loading />;
  if (!r.data) return <Notice danger>{r.error}</Notice>;
  return (
    <section>
      <div className="section-heading">
        <p className="muted">
          New scenes create an archive draft automatically. Review the recap,
          character development and evidence before readers see it.
        </p>
        <Button kind="secondary" onClick={() => void r.reload()}>
          <RefreshCw size={15} />
          Refresh
        </Button>
      </div>
      <div className="studio-tasks">
        {r.data.archives.map((a) => (
          <article className="studio-task" key={a.id}>
            <p className="eyebrow">
              {a.storyTitle} · SCENE {a.version}
            </p>
            <h3>
              {a.status === "approved"
                ? "Published story guide"
                : "Story guide update"}
            </h3>
            <span className="status-badge">{a.status}</span>
            <p>{a.reason}</p>
            {a.context && (
              <Button kind="secondary" onClick={() => setSelected(a)}>
                {a.approved ? "Read accepted version" : "Review story guide"}
              </Button>
            )}
          </article>
        ))}
      </div>
      {!r.data.archives.length && (
        <Empty icon={<BookOpen size={30} />} title="A story to grow into.">
          Publish a scene to prepare its first story guide.
        </Empty>
      )}
      {selected && (
        <Review
          item={selected}
          close={() => setSelected(null)}
          done={async () => {
            setSelected(null);
            await r.reload();
          }}
        />
      )}
    </section>
  );
}
function Review({
  item,
  close,
  done,
}: {
  item: Item;
  close: () => void;
  done: () => Promise<void>;
}) {
  const { boot } = useApp(),
    context = item.context!;
  const [draft, setDraft] = useState<Archive>(
    item.approved ?? item.draft ?? fallbackArchive(context),
  );
  const [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const editable = ["review", "failed"].includes(item.status);
  const change = (fn: (d: Archive) => void) => {
    const copy = structuredClone(draft);
    fn(copy);
    setDraft(copy);
    setChecked(false);
  };
  const sourcePicker = (ids: string[], update: (ids: string[]) => void) => (
    <details className="archive-source-picker">
      <summary>Source scenes ({ids.length})</summary>
      {context.scenes.map((s) => (
        <label className="checkbox-label" key={s.id}>
          <input
            type="checkbox"
            checked={ids.includes(s.id)}
            onChange={(e) =>
              update(
                e.target.checked
                  ? [...ids, s.id]
                  : ids.filter((x) => x !== s.id),
              )
            }
          />
          <span>
            {s.version}. {s.title}
          </span>
        </label>
      ))}
    </details>
  );
  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await api(
        `/admin/archives/${encodeURIComponent(item.id)}/review`,
        "POST",
        { action, content: draft, english: checked, sourcesChecked: checked },
      );
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const slug = boot.stories.find((s) => s.id === item.storyId)?.slug;
  return (
    <Modal
      title="Keep the story true."
      eyebrow={`${item.storyTitle.toUpperCase()} · SCENE ${item.version}`}
      onClose={close}
    >
      <p className="modal-copy">
        Compare the draft with the published scenes. Resolve uncertain
        identities and contradictions; preserve each character’s existing
        identity.
      </p>
      <details className="archive-evidence">
        <summary>Read the published evidence</summary>
        {context.scenes.map((s) => (
          <article key={s.id}>
            <h4>
              {s.version}. {s.title}
            </h4>
            <p>{s.summary}</p>
            {slug && (
              <a
                href={`/story/${slug}?scene=${encodeURIComponent(s.id)}`}
                target="_blank"
                rel="noopener"
              >
                Watch source scene ↗
              </a>
            )}
          </article>
        ))}
      </details>
      <fieldset disabled={!editable || busy} className="archive-fields">
        <label className="field-label" htmlFor="archive-recap">
          Story recap
        </label>
        <textarea
          id="archive-recap"
          rows={4}
          maxLength={1200}
          value={draft.recap.text}
          onChange={(e) =>
            change((d) => {
              d.recap.text = e.target.value;
            })
          }
        />
        {sourcePicker(draft.recap.sceneIds, (ids) =>
          change((d) => {
            d.recap.sceneIds = ids;
          }),
        )}
        <h3>Character development</h3>
        {draft.characters.map((ch, i) => (
          <section className="archive-edit-character" key={ch.id}>
            <div className="section-heading">
              <h4>{context.characters.find((c) => c.id === ch.id)?.name}</h4>
              <button
                className="text-button"
                onClick={() =>
                  change((d) => {
                    d.characters.splice(i, 1);
                  })
                }
              >
                Remove from this update
              </button>
            </div>
            <label className="field-label" htmlFor={`intro-${i}`}>
              Introduction
            </label>
            <textarea
              id={`intro-${i}`}
              rows={3}
              maxLength={1200}
              value={ch.introduction}
              onChange={(e) =>
                change((d) => {
                  d.characters[i].introduction = e.target.value;
                })
              }
            />
            <label className="field-label" htmlFor={`growth-${i}`}>
              Growth and changes
            </label>
            <textarea
              id={`growth-${i}`}
              rows={3}
              maxLength={1200}
              value={ch.development}
              onChange={(e) =>
                change((d) => {
                  d.characters[i].development = e.target.value;
                })
              }
            />
            {sourcePicker(ch.sceneIds, (ids) =>
              change((d) => {
                d.characters[i].sceneIds = ids;
              }),
            )}
            {ch.relationships.map((rel, j) => (
              <div key={j}>
                <label
                  className="field-label"
                  htmlFor={`relationship-${i}-${j}`}
                >
                  Relationship with{" "}
                  {
                    context.characters.find((c) => c.id === rel.characterId)
                      ?.name
                  }
                </label>
                <textarea
                  id={`relationship-${i}-${j}`}
                  rows={2}
                  maxLength={1200}
                  value={rel.description}
                  onChange={(e) =>
                    change((d) => {
                      d.characters[i].relationships[j].description =
                        e.target.value;
                    })
                  }
                />
                {sourcePicker(rel.sceneIds, (ids) =>
                  change((d) => {
                    d.characters[i].relationships[j].sceneIds = ids;
                  }),
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    change((d) => {
                      d.characters[i].relationships.splice(j, 1);
                    })
                  }
                >
                  Remove relationship
                </button>
              </div>
            ))}
            <label className="field-label" htmlFor={`add-relation-${i}`}>
              Add an observed relationship
            </label>
            <select
              id={`add-relation-${i}`}
              value=""
              onChange={(e) =>
                change((d) => {
                  d.characters[i].relationships.push({
                    characterId: e.target.value,
                    description: "",
                    sceneIds: [context.scenes.at(-1)!.id],
                  });
                })
              }
            >
              <option value="" disabled>
                Choose an existing character
              </option>
              {context.characters
                .filter(
                  (c) =>
                    c.id !== ch.id &&
                    !ch.relationships.some((r) => r.characterId === c.id),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </section>
        ))}
        <label className="field-label" htmlFor="archive-add-character">
          Add a character to this update
        </label>
        <select
          id="archive-add-character"
          value=""
          onChange={(e) => {
            const ch = context.characters.find((c) => c.id === e.target.value)!;
            change((d) => {
              d.characters.push({
                id: ch.id,
                introduction: ch.description,
                development: ch.state,
                sceneIds: [context.scenes.at(-1)!.id],
                relationships: [],
              });
            });
          }}
        >
          <option value="" disabled>
            Choose an established character
          </option>
          {context.characters
            .filter((c) => !draft.characters.some((x) => x.id === c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        {(["openThreads", "concerns"] as const).map((key) => (
          <section key={key}>
            <h3>
              {key === "openThreads"
                ? "Unanswered questions"
                : "Concerns to resolve"}
            </h3>
            {draft[key].map((entry, i) => (
              <div key={i}>
                <label className="field-label" htmlFor={`${key}-${i}`}>
                  {key === "openThreads" ? "Question" : "Concern"} {i + 1}
                </label>
                <textarea
                  id={`${key}-${i}`}
                  rows={2}
                  maxLength={1200}
                  value={entry.text}
                  onChange={(e) =>
                    change((d) => {
                      d[key][i].text = e.target.value;
                    })
                  }
                />
                {sourcePicker(entry.sceneIds, (ids) =>
                  change((d) => {
                    d[key][i].sceneIds = ids;
                  }),
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    change((d) => {
                      d[key].splice(i, 1);
                    })
                  }
                >
                  {key === "concerns"
                    ? "Resolved against the source — remove"
                    : "Remove question"}
                </button>
              </div>
            ))}
            {key === "openThreads" && (
              <Button
                kind="secondary"
                onClick={() =>
                  change((d) => {
                    d.openThreads.push({
                      text: "",
                      sceneIds: [context.scenes.at(-1)!.id],
                    });
                  })
                }
              >
                <Plus size={14} />
                Add question
              </Button>
            )}
          </section>
        ))}
      </fieldset>
      {editable && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>
              I checked the cited scenes, confirmed English text and resolved
              every concern. This guide accurately describes the published
              story.
            </span>
          </label>
          {error && <Notice danger>{error}</Notice>}
          <div className="share-actions">
            <Button
              busy={busy}
              disabled={!checked || draft.concerns.length > 0}
              onClick={() => void act("approve")}
            >
              Publish reviewed guide
            </Button>
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() => void act("reject")}
            >
              Discard draft
            </Button>
          </div>
        </>
      )}
      {!editable && (
        <p className="fine-print">
          This reviewed version is preserved. Later scenes can add a new
          version.
        </p>
      )}
    </Modal>
  );
}
