import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Clock3,
  Flag,
  Globe2,
  Lightbulb,
  ListOrdered,
  LoaderCircle,
  Play,
  Plus,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import {
  activeStates,
  sceneAt,
  type Scene,
  type StoryDetail,
  type Task,
  type Character,
  formatTime,
} from "../shared/domain";
import { api, navigate, useLocation, useResource } from "./api";
import { useApp } from "./context";
import {
  Author,
  Avatar,
  Button,
  Empty,
  Link,
  Loading,
  Modal,
  Notice,
  Status,
} from "./components";
import { Player } from "./Player";
import { StoryArchive } from "./StoryArchive";
import { ShareModal } from "./ShareModal";
import { CastPicker } from "./CastPicker";
import { GenerationChoice } from "./GenerationChoice";
import type { GenerationMode } from "../shared/billing";

export function StoryPage({ slug }: { slug: string }) {
  const { boot, refresh, toast, requireLogin } = useApp(),
    detail = useResource<StoryDetail>(`/stories/${encodeURIComponent(slug)}`, [
      boot.user?.id,
    ]);
  const path = useLocation(),
    params = new URLSearchParams(path.split("?")[1]);
  const [episodeId, setEpisodeId] = useState(params.get("episode") ?? ""),
    [jumpTime, setJumpTime] = useState(Number(params.get("t") ?? 0) * 1000),
    [tab, setTab] = useState("episodes"),
    [currentVersion, setCurrentVersion] = useState(0),
    [ended, setEnded] = useState(false),
    [report, setReport] = useState(false),
    [connected, setConnected] = useState(true);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [sharing, setSharing] = useState<{ scene?: Scene } | null>(null);
  const currentTime = useRef(0),
    progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    initialProgress = useRef(false);
  const data = detail.data;
  useEffect(() => {
    if (!data || initialProgress.current) return;
    if (!data.episodes.length) return;
    initialProgress.current = true;
    let saved: {
      episodeId: string;
      timeMs: number;
      updatedAt?: number;
    } | null = null;
    try {
      saved = JSON.parse(
        localStorage.getItem(
          `afterlight:progress:${boot.user?.id ?? "guest"}:${data.story.id}`,
        ) ?? "null",
      );
    } catch {
      /* Storage may be disabled. */
    }
    if (
      data.progress &&
      (!saved || (data.progress.updatedAt ?? 0) > (saved.updatedAt ?? 0))
    )
      saved = data.progress;
    const sharedScene = params.get("scene")
      ? data.scenes.find((s) => s.id === params.get("scene"))
      : undefined;
    if (sharedScene) {
      setEpisodeId(sharedScene.episodeId);
      setJumpTime(sharedScene.startMs);
      setProgressLoaded(true);
      return;
    }
    if (
      !params.get("episode") &&
      saved &&
      data.episodes.some((e) => e.id === saved?.episodeId)
    ) {
      setEpisodeId(saved.episodeId);
      setJumpTime(
        Math.max(
          0,
          Math.min(
            saved.timeMs,
            data.episodes.find((e) => e.id === saved?.episodeId)!.durationMs,
          ),
        ),
      );
    } else if (!episodeId) setEpisodeId(data.episodes[0].id);
    setProgressLoaded(true);
  }, [data]);
  useEffect(() => {
    const sharedScene = data?.scenes.find(
      (scene) => scene.id === params.get("scene"),
    );
    if (sharedScene) {
      setEpisodeId(sharedScene.episodeId);
      setJumpTime(sharedScene.startMs);
      setEnded(false);
    } else if (params.has("episode")) {
      setEpisodeId(params.get("episode")!);
      setJumpTime(Number(params.get("t") ?? 0) * 1000);
    }
  }, [path, data?.story.id]);
  useEffect(() => {
    if (!data?.story.id) return;
    const storyId = data.story.id;
    let ws: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      stopped = false,
      delay = 2000;
    const connect = () => {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/stories/${storyId}/events`,
      );
      ws.onopen = () => {
        setConnected(true);
        delay = 2000;
        void detail.reload();
      };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const event = JSON.parse(e.data);
          if (event.storyId === storyId && event.type !== "connected") {
            void detail.reload();
            void refresh();
          }
        } catch {
          /* Ignore malformed notifications; D1 is authoritative. */
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    const poll = setInterval(() => {
      if (!document.hidden) void detail.reload();
    }, 30000);
    return () => {
      stopped = true;
      ws?.close();
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [data?.story.id]);
  useEffect(() => () => clearTimeout(progressTimer.current), []);
  const episode =
    data?.episodes.find((e) => e.id === episodeId) ?? data?.episodes[0];
  const position = useCallback(
    (time: number, version: number) => {
      currentTime.current = time;
      setCurrentVersion(version);
      if (!data || !episode) return;
      try {
        localStorage.setItem(
          `afterlight:progress:${boot.user?.id ?? "guest"}:${data.story.id}`,
          JSON.stringify({
            episodeId: episode.id,
            timeMs: Math.round(time),
            updatedAt: Date.now(),
          }),
        );
      } catch {
        /* Optional local persistence. */
      }
      if (boot.user && !progressTimer.current)
        progressTimer.current = setTimeout(() => {
          progressTimer.current = undefined;
          void api(`/stories/${data.story.id}/progress`, "PUT", {
            episodeId: episode.id,
            timeMs: Math.min(
              episode.durationMs,
              Math.round(currentTime.current),
            ),
          }).catch(() => {});
        }, 5000);
    },
    [data?.story.id, episode?.id, boot.user?.id],
  );
  if (detail.loading) return <Loading />;
  if (!data)
    return (
      <div className="page">
        <Notice danger>
          {detail.error || "This story could not be found."}
        </Notice>
        <Button onClick={() => void detail.reload()}>Try again</Button>
      </div>
    );
  const { story, scenes, queue } = data,
    saved = boot.favorites.includes(story.id),
    owner = story.ownerId === boot.user?.id || boot.user?.role === "admin";
  const episodeScenes = scenes.filter((s) => s.episodeId === episode?.id);
  const openEpisode = (id: string, time = 0) => {
    clearTimeout(progressTimer.current);
    progressTimer.current = undefined;
    setEpisodeId(id);
    setJumpTime(time);
    setEnded(false);
    window.history.replaceState(
      {},
      "",
      `/story/${story.slug}?episode=${encodeURIComponent(id)}&t=${Math.floor(time / 1000)}`,
    );
  };
  return (
    <div className="watch-page page">
      <div className="story-heading">
        <div>
          <p className="eyebrow">
            <span className="live-dot" />
            {story.genre.toUpperCase()}{" "}
            <span className="eyebrow-divider">/</span> A WORLD WE WRITE TOGETHER
          </p>
          <h1>{story.title}</h1>
          <p className="story-logline">{story.logline}</p>
        </div>
        <div className="story-actions">
          <button
            className={`icon-button outlined ${saved ? "saved" : ""}`}
            aria-label={saved ? "Unsave story" : "Save story"}
            onClick={async () => {
              if (!requireLogin()) return;
              try {
                await api(`/stories/${story.id}/favorite`, "POST", {
                  favorite: !saved,
                });
                await refresh();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <Bookmark size={18} fill={saved ? "currentColor" : "none"} />
          </button>
          <Button
            kind="secondary"
            disabled={
              story.status === "draft" || !scenes.some((s) => !s.hidden)
            }
            onClick={() => {
              const scene = sceneAt(episodeScenes, currentTime.current);
              setSharing({ scene: scene?.hidden ? undefined : scene });
            }}
          >
            <Share2 size={15} />
            Share story
          </Button>
        </div>
      </div>
      <div className="watch-grid">
        <section className="watch-content">
          {episode && episodeScenes.length > 0 ? (
            progressLoaded ? (
              <Player
                key={episode.id}
                scenes={episodeScenes}
                episode={episode}
                poster={story.coverUrl}
                fixture={story.fixture}
                startTime={jumpTime}
                onPosition={position}
                onEnd={() => setEnded(true)}
              />
            ) : (
              <Loading />
            )
          ) : (
            <div className="unwritten-world">
              <Globe2 size={44} />
              <span className="eyebrow">EVERY WORLD STARTS SOMEWHERE</span>
              <h2>The first scene is still unwritten.</h2>
              <p>
                The world and its characters are ready. Give them a beginning.
              </p>
              {owner && story.status === "draft" && (
                <Button
                  onClick={async () => {
                    try {
                      await api(`/stories/${story.id}`, "PATCH", {
                        status: "open",
                      });
                      await detail.reload();
                      await refresh();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  Open this story for its first scene <ArrowRight size={16} />
                </Button>
              )}
            </div>
          )}
          <div className="chapter-strip">
            <div>
              <span className="status-dot" />
              <strong>
                {story.status === "paused"
                  ? "This story is taking a pause"
                  : queue.length
                    ? `${queue.length} ${queue.length === 1 ? "idea" : "ideas"} in the making`
                    : ended
                      ? "You’re all caught up"
                      : "The story is still unfolding"}
              </strong>
              <span>
                {!connected
                  ? "Reconnecting to updates…"
                  : "New scenes appear here when ready."}
              </span>
            </div>
            {data.episodes.length > 0 && (
              <button
                className="text-button"
                onClick={() =>
                  openEpisode(
                    data.episodes[data.episodes.length - 1].id,
                    Math.max(
                      0,
                      data.episodes[data.episodes.length - 1].durationMs -
                        10000,
                    ),
                  )
                }
              >
                Jump to latest <ArrowRight size={14} />
              </button>
            )}
          </div>
          <div
            className="content-tabs"
            role="tablist"
            aria-label="Story information"
          >
            {[
              ["episodes", "Chapters", Play],
              ["creators", "Scene credits", Users],
              ["world", "World & characters", Globe2],
              ["queue", "Creation queue", ListOrdered],
            ].map(([key, label, Icon]) => {
              const I = Icon as typeof Play;
              return (
                <button
                  key={String(key)}
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "active" : ""}
                  onClick={() => setTab(String(key))}
                >
                  <I size={15} />
                  {String(label)}
                  {key === "queue" && queue.length > 0 && (
                    <span className="count">{queue.length}</span>
                  )}
                </button>
              );
            })}
          </div>
          {tab === "episodes" && (
            <div className="episode-list">
              {data.episodes.length ? (
                data.episodes.map((e) => (
                  <button
                    key={e.id}
                    className={`episode-card ${episode?.id === e.id ? "active" : ""}`}
                    onClick={() => openEpisode(e.id)}
                  >
                    <span
                      className="episode-art"
                      style={{ backgroundImage: `url(${story.coverUrl})` }}
                    >
                      <Play size={22} fill="currentColor" />
                    </span>
                    <span className="episode-copy">
                      <small>
                        CHAPTER {String(e.number).padStart(2, "0")}{" "}
                        {e.status === "open" && <i>UNFOLDING</i>}
                      </small>
                      <strong>{e.title}</strong>
                      <span>
                        {scenes.filter((s) => s.episodeId === e.id).length}{" "}
                        scenes · {formatTime(e.durationMs)} · English
                      </span>
                    </span>
                    {episode?.id === e.id ? (
                      <span className="now-playing">NOW WATCHING</span>
                    ) : (
                      <ArrowRight size={18} />
                    )}
                  </button>
                ))
              ) : (
                <p className="muted">
                  Chapters will appear as the first scenes are published.
                </p>
              )}
            </div>
          )}
          {tab === "creators" && (
            <div className="scene-credit-list">
              {scenes.map((s, i) => (
                <div key={s.id} className="scene-credit-row">
                  <span className="scene-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <button
                      className="text-button scene-title-button"
                      onClick={() => openEpisode(s.episodeId, s.startMs)}
                    >
                      {s.title} <Play size={12} />
                    </button>
                    <p>
                      {s.hidden
                        ? "This contribution is currently unavailable."
                        : s.englishPrompt}
                    </p>
                    <Author id={s.authorId} name={s.author} compact />
                  </div>
                  <button
                    className="icon-button"
                    disabled={s.hidden}
                    aria-label={`Share ${s.title}`}
                    onClick={() => setSharing({ scene: s })}
                  >
                    <Share2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {tab === "world" && (
            <StoryArchive
              key={`${story.updatedAt}:${currentVersion}`}
              story={story}
              scenes={scenes}
              version={currentVersion}
              jump={(s) => openEpisode(s.episodeId, s.startMs)}
            />
          )}
          {tab === "queue" && (
            <div className="queue-list">
              {queue.length ? (
                queue.map((t, i) => (
                  <div className="queue-row" key={t.id}>
                    <span className="queue-position">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Avatar name={t.author} />
                    <div>
                      <strong>{t.author}</strong>
                      <Status state={t.status} />
                    </div>
                    {t.userId === boot.user?.id && (
                      <Link to="/contributions" className="text-button">
                        Your idea <ArrowRight size={14} />
                      </Link>
                    )}
                  </div>
                ))
              ) : (
                <Empty
                  icon={<Lightbulb size={28} />}
                  title="A little room for your imagination"
                >
                  Be the next person to move this story forward.
                </Empty>
              )}
            </div>
          )}
          <div className="story-bottom-actions">
            {owner && story.status !== "draft" && (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api(`/stories/${story.id}`, "PATCH", {
                      status: story.status === "open" ? "paused" : "open",
                    });
                    await detail.reload();
                    await refresh();
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                {story.status === "open"
                  ? "Pause new scenes"
                  : "Reopen the story"}
              </button>
            )}
            <button
              className="text-button"
              onClick={() => {
                if (requireLogin()) setReport(true);
              }}
            >
              <Flag size={13} />
              Report a concern
            </button>
          </div>
        </section>
        <aside className="creation-column">
          <Composer
            characters={data.characters}
            storyId={story.id}
            title={story.title}
            status={story.status}
            queue={queue}
            onChanged={async () => {
              await detail.reload();
              await refresh();
            }}
          />
          <div className="creation-note">
            <span className="hand-drawn-star">✳</span>
            <div>
              <h3>
                A shared world.
                <br />
                Your unique mark.
              </h3>
              <p>
                Your name lives with your scene. Every viewer can discover the
                idea — and the person — behind it.
              </p>
            </div>
          </div>
        </aside>
      </div>
      {report && (
        <ReportModal storyId={story.id} close={() => setReport(false)} />
      )}
      {sharing && (
        <ShareModal
          story={story}
          scene={sharing.scene}
          close={() => setSharing(null)}
        />
      )}
    </div>
  );
}

export function Composer({
  characters,
  storyId,
  title,
  status,
  queue,
  onChanged,
}: {
  characters: Character[];
  storyId: string;
  title: string;
  status: string;
  queue: Task[];
  onChanged: () => Promise<void>;
}) {
  const { boot, requireLogin, toast } = useApp();
  const [prompt, setPrompt] = useState(""),
    [generationMode, setGenerationMode] = useState<GenerationMode>("text"),
    [selectedCast, setSelectedCast] = useState<string[]>([]),
    [task, setTask] = useState<Task | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  const savedKey = `afterlight:idea:${boot.user?.id ?? "guest"}:${storyId}`,
    idempotency = useRef(crypto.randomUUID());
  useEffect(() => {
    try {
      setPrompt(localStorage.getItem(savedKey) ?? "");
      const savedCast: unknown = JSON.parse(
        localStorage.getItem(`${savedKey}:cast`) ?? "[]",
      );
      setSelectedCast(
        Array.isArray(savedCast)
          ? [
              ...new Set(
                savedCast.filter(
                  (id): id is string =>
                    typeof id === "string" &&
                    characters.some((ch) => ch.id === id),
                ),
              ),
            ].slice(0, 3)
          : [],
      );
    } catch {
      setPrompt("");
      setSelectedCast([]);
    }
    setTask(null);
    setGenerationMode("text");
    setConsent(false);
    setError("");
    idempotency.current = crypto.randomUUID();
  }, [savedKey]);
  const trackedId =
    task && activeStates.includes(task.status) ? task.id : undefined;
  useEffect(() => {
    if (!trackedId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      try {
        const result = await api<{ task: Task }>(`/tasks/${trackedId}`);
        if (stopped) return;
        setTask(result.task);
        if (!activeStates.includes(result.task.status)) {
          await onChanged();
          return;
        }
      } catch {
        // Keep the last confirmed state; reconnect without fabricating progress.
      }
      if (!stopped) timer = setTimeout(update, document.hidden ? 30000 : 5000);
    };
    void update();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [trackedId, storyId, boot.user?.id]);
  const change = (text: string) => {
    setPrompt(text);
    setTask(null);
    setConsent(false);
    setError("");
    idempotency.current = crypto.randomUUID();
    try {
      localStorage.setItem(savedKey, text);
    } catch {
      /* Optional storage. */
    }
  };
  const changeCast = (ids: string[]) => {
    setSelectedCast(ids);
    setTask(null);
    setConsent(false);
    setError("");
    idempotency.current = crypto.randomUUID();
    try {
      localStorage.setItem(`${savedKey}:cast`, JSON.stringify(ids));
    } catch {
      /* Optional storage. */
    }
  };
  const save = async (preview: boolean) => {
    if (!requireLogin()) return;
    if (prompt.trim().length < 10) {
      setError("Give your idea a little more detail — at least 10 characters.");
      return;
    }
    setBusy(preview ? "preview" : "save");
    setError("");
    try {
      const r =
        task?.status === "Draft"
          ? { task }
          : await api<{ task: Task }>(`/stories/${storyId}/tasks`, "POST", {
              prompt,
              characterIds: selectedCast,
              generationMode,
              idempotencyKey: idempotency.current,
            });
      setTask(r.task);
      if (preview) {
        const p = await api<{ task: Task }>(
          `/tasks/${r.task.id}/preview`,
          "POST",
          {},
        );
        setTask(p.task);
      } else toast("Your idea is saved in Your contributions.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const submit = async () => {
    if (!task) return;
    setBusy("accept");
    setError("");
    try {
      const r = await api<{ task: Task }>(`/tasks/${task.id}/accept`, "POST", {
        planUpdatedAt: task.updatedAt,
        publicAttributionAccepted: consent,
      });
      setTask(r.task);
      try {
        localStorage.removeItem(savedKey);
        localStorage.removeItem(`${savedKey}:cast`);
      } catch {
        /* The server has already accepted the contribution. */
      }
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const inQueue = task && !["Draft", "NeedsReview"].includes(task.status);
  return (
    <div className="composer">
      <div className="composer-top">
        <span className="eyebrow">
          <Sparkles size={13} />
          THE NEXT SCENE
        </span>
        <span className="free-tag">
          {(task?.generationMode ?? generationMode) === "text"
            ? "FREE ALLOWANCE"
            : "CREATION POINTS"}
        </span>
      </div>
      <h2>
        {task?.status === "Published"
          ? "Your mark is in the story."
          : task?.status === "Failed" || task?.status === "Cancelled"
            ? "Your idea is still yours."
            : inQueue
              ? "Your idea is on its way."
              : "What happens\nnext?"}
      </h2>
      <p className="composer-intro">
        A strange discovery. An unexpected visitor. A choice that changes
        everything.
      </p>
      {queue.length > 0 && (
        <div className="queue-explainer" role="status">
          <Status state={queue[0].status} />
          <p>
            {queue[0].author}’s idea is first in this story’s queue. New ideas
            wait their turn, then adapt to the latest published scene.
          </p>
        </div>
      )}
      {inQueue ? (
        <div className="accepted-panel" aria-live="polite">
          <span className="accepted-icon">
            {["Preparing", "Generating", "Checking", "Packaging"].includes(
              task.status,
            ) ? (
              <LoaderCircle size={26} className="spin" />
            ) : task.status === "Published" ? (
              <Check size={26} />
            ) : (
              <Clock3 size={26} />
            )}
          </span>
          <Status state={task.status} />
          <p>
            {task.status === "Queued"
              ? "Your place is saved. Continuity will be checked again after earlier scenes are published."
              : task.status === "Published"
                ? "Your scene is part of the story, with your name in the credits."
                : task.status === "Failed" || task.status === "Cancelled"
                  ? "This scene did not enter the story. Your reserved credit has been returned."
                  : "Your contribution is saved. You can close this page and check back anytime."}
          </p>
          <Link to="/contributions" className="button primary">
            Follow your scene <ArrowRight size={16} />
          </Link>
          <button
            className="text-button"
            onClick={() => {
              setTask(null);
              setPrompt("");
              changeCast([]);
              idempotency.current = crypto.randomUUID();
            }}
          >
            Save another idea for later
          </button>
        </div>
      ) : task?.plan ? (
        <div className="plan-preview">
          <span className="eyebrow">YOUR SCENE, ADAPTED TO FIT</span>
          <h3>{task.plan.title}</h3>
          <p>{task.plan.summary}</p>
          <div className="plan-cast">
            <span>Appearing in your scene</span>
            {task.plan.characterIds.length ? (
              task.plan.characterIds.map((id) => {
                const character =
                  characters.find((ch) => ch.id === id) ??
                  task.plan!.newCharacters.find((ch) => ch.id === id);
                return (
                  <strong key={id}>
                    {character?.name ?? "Character"}
                    {task.plan!.newCharacters.some((ch) => ch.id === id)
                      ? " · new"
                      : ""}
                  </strong>
                );
              })
            ) : (
              <strong>No principal characters</strong>
            )}
          </div>
          <div className="bridge">
            <span>How it connects</span>
            {task.plan.bridge}
          </div>
          {task.plan.reason && (
            <Notice danger={task.plan.rejected}>{task.plan.reason}</Notice>
          )}
          <div className="scene-spec">
            <span>
              <Clock3 size={13} />
              About 10 seconds
            </span>
            <span>
              {task.generationMode === "reference"
                ? `${task.quotedPoints} purchased points`
                : "1 free credit"}
            </span>
            <span>English</span>
          </div>
          <p className="fine-print">
            {task.generationMode === "reference"
              ? "Uses approved visual references. Points are reserved now and used on publication. Failed or rejected scenes return the reservation. Consistency is not guaranteed."
              : "Text-to-video uses character descriptions; appearances may vary. No payment required."}
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Publish my original idea and nickname with the finished scene, as
              described in the{" "}
              <a href="/terms#rights" target="_blank" rel="noopener">
                contribution terms
              </a>{" "}
              and{" "}
              <a href="/privacy#public" target="_blank" rel="noopener">
                public information notice
              </a>
              . Small continuity edits are okay.
            </span>
          </label>
          <Button
            className="full-width"
            disabled={!consent || task.plan.rejected || status !== "open"}
            busy={busy === "accept"}
            onClick={() => void submit()}
          >
            Join the story <ArrowRight size={16} />
          </Button>
          <button
            className="text-button full-width"
            onClick={() => setTask(null)}
          >
            Back to my idea
          </button>
        </div>
      ) : (
        <>
          <GenerationChoice
            value={generationMode}
            referenceEnabled={boot.config.referenceEnabled}
            points={boot.config.referencePoints}
            disabled={!!busy}
            onChange={(mode) => {
              setGenerationMode(mode);
              setTask(null);
              setConsent(false);
              setError("");
              idempotency.current = crypto.randomUUID();
            }}
          />
          <CastPicker
            characters={characters}
            selected={selectedCast}
            onChange={changeCast}
            disabled={!!busy}
          />
          <label className="sr-only" htmlFor={`idea-${storyId}`}>
            Your idea for {title}
          </label>
          <textarea
            id={`idea-${storyId}`}
            maxLength={2000}
            rows={6}
            value={prompt}
            onChange={(e) => change(e.target.value)}
            placeholder={
              storyId === "last-light"
                ? "The radio crackles again. This time, the voice tells her not to open the door…"
                : storyId === "quiet-orbit"
                  ? "Inez opens the research log. On the first page, someone has left a warning…"
                  : "An unexpected discovery. A difficult choice. Tell us what happens next…"
            }
          />
          <div className="input-meta">
            <span>Any input language. English on screen.</span>
            <span>{prompt.length}/2000</span>
          </div>
          <Button
            className="full-width"
            busy={busy === "preview"}
            disabled={
              !!busy || (boot.config.generationEnabled && status !== "open")
            }
            onClick={() => void save(boot.config.generationEnabled)}
          >
            <Sparkles size={16} />
            {boot.config.generationEnabled
              ? "Preview your scene"
              : "Save your idea"}
            <ArrowRight size={16} />
          </Button>
          {boot.config.generationEnabled && (
            <button
              className="text-button save-idea"
              disabled={!!busy}
              onClick={() => void save(false)}
            >
              Save as an idea for later
            </button>
          )}
          {status !== "open" && (
            <Notice>
              {status === "draft"
                ? "The owner can open this world when its setup is ready."
                : "This story is paused. You can still save an idea."}
            </Notice>
          )}
          <div className="creator-byline">
            <Avatar name={boot.user?.displayName || "?"} size={28} />
            <span>
              Your scene will be credited to
              <br />
              <strong>
                {boot.user?.displayName || "your storyteller name"}
              </strong>
            </span>
          </div>
        </>
      )}
      {error && <Notice danger>{error}</Notice>}
      <div className="composer-footer">
        <span className="credit-circles">
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              className={i < (boot.credits?.available ?? 3) ? "available" : ""}
            />
          ))}
        </span>
        <span>
          {boot.user
            ? `${boot.credits?.available ?? 0} free credits left today`
            : "Sign in for your free creation credits"}
        </span>
      </div>
      <p className="fine-print">
        Ideas take turns. We check every scene against the latest story before
        it’s made. Free text-to-video needs no card.{" "}
        <Link to="/account#creation-points">About creation points</Link>
      </p>
    </div>
  );
}
function ReportModal({
  storyId,
  close,
}: {
  storyId: string;
  close: () => void;
}) {
  const { toast } = useApp();
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Tell the studio." eyebrow="CONTENT & SUPPORT" onClose={close}>
      <p className="modal-copy">
        Describe the scene or issue and include a chapter or timestamp when
        possible.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/reports", "POST", { storyId, reason });
            toast("Your report is saved for the studio to review.");
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="report-reason" className="field-label">
          What should we look at?
        </label>
        <textarea
          id="report-reason"
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <Notice danger>{error}</Notice>}
        <Button className="full-width" type="submit" busy={busy}>
          Send to the studio
        </Button>
      </form>
    </Modal>
  );
}
