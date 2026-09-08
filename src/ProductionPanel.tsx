import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles, Upload, MessageSquare, ArrowRight } from "lucide-react";
import type {
  Character,
  ScenePlan,
  Story,
  StoryDetail,
  Task,
} from "../shared/domain";
import type { Proposal } from "../shared/production";
import { MAX_UPLOAD_BYTES } from "../shared/production";
import policies from "../shared/policies.json";
import { api, useResource } from "./api";
import { useApp } from "./context";
import { Button, Link, Modal, Notice, Status } from "./components";
import { CastPicker } from "./CastPicker";

export function ProductionPanel({
  story,
  characters,
  renderGeneration,
  onChanged,
}: {
  story: Story;
  characters: Character[];
  renderGeneration: (ids: string[], prompt: string) => ReactNode;
  onChanged: () => Promise<void>;
}) {
  const { boot } = useApp(),
    host = boot.user?.id === story.ownerId && boot.config.canHost,
    generationAvailable =
      boot.config.textEnabled || boot.config.referenceEnabled;
  const [tab, setTab] = useState<"ideas" | "make">("ideas"),
    [method, setMethod] = useState<"generate" | "upload">("generate"),
    [selected, setSelected] = useState<string[]>([]);
  const proposals = useResource<{ proposals: Proposal[] }>(
    boot.user ? `/stories/${story.id}/proposals` : null,
    [boot.user?.id],
  );
  const picked =
    proposals.data?.proposals.filter((p) => selected.includes(p.id)) ?? [];
  return (
    <section className="production-panel">
      {host && (
        <div className="production-tabs" aria-label="Story host workspace">
          <button
            className={tab === "ideas" ? "selected" : ""}
            onClick={() => {
              setTab("ideas");
              void proposals.reload();
            }}
          >
            <MessageSquare size={16} /> Audience ideas
          </button>
          <button
            className={tab === "make" ? "selected" : ""}
            onClick={() => setTab("make")}
          >
            <Sparkles size={16} /> Make a scene
          </button>
        </div>
      )}
      {tab === "ideas" ? (
        <>
          <ProposalForm story={story} onSaved={proposals.reload} />
          {host && (
            <div className="proposal-inbox">
              <h3>Choose what happens next.</h3>
              <p className="fine-print">
                Select up to five ideas to credit in your next scene.
                {generationAvailable &&
                  " Your account pays if you choose platform generation."}
              </p>
              {proposals.error && <Notice danger>{proposals.error}</Notice>}
              {proposals.data?.proposals
                .filter((p) => p.status === "pending")
                .map((p) => (
                  <label className="proposal-choice" key={p.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      disabled={
                        !selected.includes(p.id) && selected.length >= 5
                      }
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span>
                      <strong>{p.author}</strong>
                      <span>{p.prompt}</span>
                      <small>Based on story version {p.baseVersion}</small>
                    </span>
                  </label>
                ))}
              {!proposals.loading &&
                !proposals.data?.proposals.some(
                  (p) => p.status === "pending",
                ) && (
                  <p className="empty-copy">
                    No audience ideas yet. You can start the next scene with
                    your own idea.
                  </p>
                )}
              <Button onClick={() => setTab("make")}>
                {selected.length
                  ? `Make a scene with ${selected.length} selected ${selected.length === 1 ? "idea" : "ideas"}`
                  : "Make the next scene"}
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          {!host && (
            <ProposalList
              proposals={proposals.data?.proposals ?? []}
              onChanged={proposals.reload}
            />
          )}
        </>
      ) : (
        <>
          {picked.length > 0 && (
            <div className="selected-ideas">
              <span className="eyebrow">AUDIENCE CONTRIBUTIONS</span>
              {picked.map((p) => (
                <p key={p.id}>
                  <strong>{p.author}</strong> — {p.prompt}
                </p>
              ))}
              <small>
                These ideas will be credited if the scene is published.
              </small>
            </div>
          )}
          {generationAvailable && (
            <div
              className="production-methods"
              aria-label="Video production method"
            >
              <button
                className={method === "generate" ? "selected" : ""}
                onClick={() => setMethod("generate")}
              >
                <Sparkles size={16} /> Generate with points
              </button>
              <button
                className={method === "upload" ? "selected" : ""}
                onClick={() => setMethod("upload")}
              >
                <Upload size={16} /> Upload a finished video
              </button>
            </div>
          )}
          {generationAvailable && method === "generate" ? (
            renderGeneration(
              selected,
              picked
                .map((p) => p.prompt)
                .join("\n")
                .slice(0, 2000),
            )
          ) : (
            <UploadEditor
              key={selected.join(",")}
              story={story}
              characters={characters}
              proposalIds={selected}
              onChanged={onChanged}
            />
          )}
        </>
      )}
    </section>
  );
}

function ProposalForm({
  story,
  onSaved,
}: {
  story: Story;
  onSaved: () => Promise<void>;
}) {
  const { boot, requireLogin } = useApp();
  const [text, setText] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const send = async () => {
    if (!requireLogin()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/stories/${story.id}/proposals`, "POST", {
        prompt: text,
        idempotencyKey: key.current,
        publicAttributionAccepted: consent,
        termsVersion: policies.version,
      });
      setText("");
      setConsent(false);
      key.current = crypto.randomUUID();
      setMessage(
        "Your idea is with the host. You can follow it in Your contributions.",
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (boot.user && !boot.config.canContribute)
    return (
      <Notice>
        Watching is open. Sharing ideas and hosting stories are by invitation
        during early access. Contact the studio from Help to request access.
      </Notice>
    );
  return (
    <div className="proposal-form">
      <span className="eyebrow">HELP SHAPE THE NEXT SCENE</span>
      <h2>What happens next?</h2>
      <p>
        A discovery. A difficult choice. Share an idea for the host to consider.
      </p>
      <textarea
        aria-label="Your proposal"
        maxLength={2000}
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          key.current = crypto.randomUUID();
          setMessage("");
        }}
        placeholder="What should happen after this scene?"
      />
      <p className="fine-print">
        Free to propose. Sharing an idea does not start generation or spend
        points.
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          Share this idea privately with the host. If adopted, publish my
          original idea and nickname with the scene under the{" "}
          <a href="/terms#rights" target="_blank" rel="noopener">
            contribution terms
          </a>
          .
        </span>
      </label>
      {error && <Notice danger>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <Button
        busy={busy}
        disabled={
          !consent || text.trim().length < 10 || story.status !== "open"
        }
        onClick={() => void send()}
      >
        Send idea to host
        <ArrowRight size={16} />
      </Button>
    </div>
  );
}
export function ProposalList({
  proposals,
  onChanged,
}: {
  proposals: Proposal[];
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <div className="proposal-list">
      {proposals.length > 0 && <h3>Your proposals</h3>}
      {error && <Notice danger>{error}</Notice>}
      {proposals.map((p) => (
        <article className="proposal-card" key={p.id}>
          <div>
            <span className="eyebrow">{p.status}</span>
            <p>{p.prompt}</p>
          </div>
          {p.status === "pending" && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api(`/proposals/${p.id}/decision`, "POST", {
                    action: "withdraw",
                  });
                  await onChanged();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Withdraw
            </button>
          )}
          {p.status === "published" && (
            <Link to={`/story/${p.storyId}?scene=${p.taskId}`}>
              See the published scene
            </Link>
          )}
        </article>
      ))}
    </div>
  );
}
export function MyProposals() {
  const { boot } = useApp();
  const r = useResource<{ proposals: Proposal[] }>(
    boot.user ? "/proposals" : null,
    [boot.user?.id],
  );
  return (
    <>
      {r.error && <Notice danger>{r.error}</Notice>}
      <ProposalList proposals={r.data?.proposals ?? []} onChanged={r.reload} />
    </>
  );
}

export function uploadFile(
  task: Task,
  file: File,
  onProgress: (n: number) => void,
  signal?: AbortSignal,
): Promise<Task> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/production/${task.id}/file`);
    xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.timeout = 120000;
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          throw new Error(body.error?.message ?? "Upload failed.");
        resolve(body.task);
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "The connection was interrupted. Keep this file and retry the upload.",
        ),
      );
    xhr.ontimeout = () =>
      reject(new Error("The upload timed out. Keep this file and retry."));
    xhr.onabort = () =>
      reject(new Error("Upload stopped. Your draft is saved."));
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    if (signal?.aborted) {
      reject(new Error("Upload stopped."));
      return;
    }
    xhr.send(file);
  });
}
function UploadEditor({
  story,
  characters,
  proposalIds,
  onChanged,
}: {
  story: Story;
  characters: Character[];
  proposalIds: string[];
  onChanged: () => Promise<void>;
}) {
  const { boot } = useApp();
  const [title, setTitle] = useState(""),
    [summary, setSummary] = useState(""),
    [bridge, setBridge] = useState(""),
    [events, setEvents] = useState(""),
    [cast, setCast] = useState<string[]>([]),
    [file, setFile] = useState<File | null>(null),
    [rights, setRights] = useState(false),
    [task, setTask] = useState<Task | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const [newCast, setNewCast] = useState<ScenePlan["newCharacters"]>([]);
  const create = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ task: Task }>(
        `/stories/${story.id}/uploads`,
        "POST",
        {
          idempotencyKey: key.current,
          proposalIds,
          title,
          summary,
          bridge,
          events: events
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          characterIds: cast,
          newCharacters: newCast,
          bytes: file.size,
          rightsAccepted: rights,
        },
      );
      setTask(r.task);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (task)
    return (
      <UploadedScene
        task={task}
        initialFile={file}
        onChanged={async (next) => {
          setTask(next);
          await onChanged();
        }}
      />
    );
  return (
    <div className="upload-editor">
      <span className="eyebrow">YOUR FINISHED VIDEO</span>
      <h2>Bring the next scene.</h2>
      <p>
        Upload your own film or a clip made elsewhere. No platform generation
        points are used.
      </p>
      {!boot.config.uploadsEnabled && (
        <Notice>Finished-video uploads are being prepared.</Notice>
      )}
      <label className="field-label">
        MP4 video
        <input
          type="file"
          accept="video/mp4,.mp4"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            key.current = crypto.randomUUID();
          }}
        />
        <small>
          Up to 60 seconds and 64 MiB. H.264 video, AAC audio or no audio.
          English dialogue and readable text.
        </small>
      </label>
      <label className="field-label">
        Scene title
        <input
          maxLength={100}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            key.current = crypto.randomUUID();
          }}
        />
      </label>
      <label className="field-label">
        What actually happens
        <textarea
          rows={3}
          maxLength={1200}
          value={summary}
          onChange={(e) => {
            setSummary(e.target.value);
            key.current = crypto.randomUUID();
          }}
        />
      </label>
      <label className="field-label">
        How it continues the latest scene
        <textarea
          rows={2}
          maxLength={1200}
          value={bridge}
          onChange={(e) => {
            setBridge(e.target.value);
            key.current = crypto.randomUUID();
          }}
        />
      </label>
      <label className="field-label">
        New story facts · one per line
        <textarea
          rows={3}
          value={events}
          onChange={(e) => {
            setEvents(e.target.value);
            key.current = crypto.randomUUID();
          }}
        />
      </label>
      <CastPicker
        disabled={busy}
        characters={characters}
        selected={cast}
        onChange={(ids) => {
          setCast(ids);
          key.current = crypto.randomUUID();
        }}
      />
      {newCast.map((person, index) => (
        <fieldset className="new-cast" key={person.id}>
          <legend>New character {index + 1}</legend>
          {(["name", "description", "state"] as const).map((field) => (
            <label className="field-label" key={field}>
              {field === "name"
                ? "Name"
                : field === "description"
                  ? "Appearance and identity"
                  : "State at the end of this scene"}
              <input
                value={person[field]}
                maxLength={field === "name" ? 60 : 1200}
                onChange={(e) => {
                  setNewCast((people) =>
                    people.map((p, i) =>
                      i === index ? { ...p, [field]: e.target.value } : p,
                    ),
                  );
                  key.current = crypto.randomUUID();
                }}
              />
            </label>
          ))}
          <button
            className="text-button"
            onClick={() => {
              setNewCast((people) => people.filter((_, i) => i !== index));
              key.current = crypto.randomUUID();
            }}
          >
            Remove character
          </button>
        </fieldset>
      ))}
      {newCast.length < 2 && (
        <button
          className="text-button"
          onClick={() => {
            setNewCast((people) => [
              ...people,
              { id: crypto.randomUUID(), name: "", description: "", state: "" },
            ]);
            key.current = crypto.randomUUID();
          }}
        >
          Add a character introduced in this video
        </button>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={rights}
          onChange={(e) => setRights(e.target.checked)}
        />
        <span>
          I have permission to publish this video, including its images, music
          and voices, and the information above describes the actual footage.
        </span>
      </label>
      {error && <Notice danger>{error}</Notice>}
      <Button
        busy={busy}
        disabled={
          !boot.config.uploadsEnabled ||
          !file ||
          file.size > MAX_UPLOAD_BYTES ||
          !rights ||
          !title.trim() ||
          summary.trim().length < 10 ||
          bridge.trim().length < 10 ||
          newCast.some(
            (p) =>
              !p.name.trim() ||
              p.description.trim().length < 10 ||
              !p.state.trim(),
          )
        }
        onClick={() => void create()}
      >
        Prepare upload
        <Upload size={16} />
      </Button>
    </div>
  );
}
export function UploadedScene({
  task,
  initialFile = null,
  onChanged,
}: {
  task: Task;
  initialFile?: File | null;
  onChanged: (task: Task) => Promise<void>;
}) {
  const story = useResource<StoryDetail>(`/stories/${task.storyId}`, [
    task.updatedAt,
  ]);
  const [file, setFile] = useState(initialFile),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [watched, setWatched] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const send = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      await onChanged(
        await uploadFile(task, file, setProgress, controller.current.signal),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };
  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      let ready = task;
      if (story.data && story.data.story.version !== task.baseVersion) {
        ready = (
          await api<{ task: Task }>(
            `/production/${task.id}/review-continuity`,
            "POST",
            { version: story.data.story.version, continuityAccepted: true },
          )
        ).task;
      }
      const result = await api<{ task: Task }>(
        `/tasks/${task.id}/accept`,
        "POST",
        { planUpdatedAt: ready.updatedAt, publicAttributionAccepted: true },
      );
      await onChanged(result.task);
      setConsent(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const active = !["Draft", "NeedsReview"].includes(task.status);
  return (
    <div className="upload-review">
      <h3>{task.plan?.title ?? "Your uploaded scene"}</h3>
      <Status state={task.status} />
      {task.reason && <p>{task.reason}</p>}
      {task.uploadReady ? (
        <>
          <video
            className="review-video"
            src={task.videoUrl ?? ""}
            controls
            playsInline
            onEnded={() => setWatched(true)}
          />
          <p>{task.plan?.summary}</p>
          <p className="fine-print">{task.plan?.bridge}</p>
        </>
      ) : (
        <>
          <label className="field-label">
            Choose the saved draft’s MP4 file
            <input
              type="file"
              accept="video/mp4,.mp4"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && <p>{file.name}</p>}
          {busy && (
            <>
              <progress max={100} value={progress} />
              <p role="status">
                {progress < 100
                  ? `Uploading · ${progress}%`
                  : "Checking the uploaded video…"}
              </p>
            </>
          )}
          <Button
            busy={busy}
            disabled={!file || active}
            onClick={() => void send()}
          >
            Upload video
          </Button>
          {busy && (
            <button
              className="text-button"
              onClick={() => controller.current?.abort()}
            >
              Stop upload
            </button>
          )}
        </>
      )}
      {task.uploadReady && !active && (
        <>
          <div className="bridge">
            <strong>Latest story</strong>
            <p>{story.data?.scenes.at(-1)?.summary ?? "Opening scene"}</p>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={watched}
              onChange={(e) => setWatched(e.target.checked)}
            />
            <span>
              I watched the full uploaded video and verified playback, English
              audio/text and its connection to the latest story.
            </span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Submit this video for publication with my producer credit and the
              selected contributors. The scene information may be published
              under the <a href="/terms#rights">contribution terms</a>.
            </span>
          </label>
          <Button
            busy={busy}
            disabled={
              !watched ||
              !consent ||
              !story.data ||
              story.data.story.status !== "open"
            }
            onClick={() => void accept()}
          >
            Submit for story review
          </Button>
        </>
      )}
      {active && (
        <Link to="/contributions">Follow this scene in Your contributions</Link>
      )}
      {error && <Notice danger>{error}</Notice>}
    </div>
  );
}
export function UploadReviewModal({
  task,
  close,
  onChanged,
}: {
  task: Task;
  close: () => void;
  onChanged: () => Promise<void>;
}) {
  const [current, setCurrent] = useState(task);
  return (
    <Modal wide title="Your uploaded scene" onClose={close}>
      <UploadedScene
        task={current}
        onChanged={async (next) => {
          setCurrent(next);
          await onChanged();
        }}
      />
    </Modal>
  );
}
