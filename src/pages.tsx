import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Clapperboard,
  Film,
  Globe2,
  LogOut,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  formatTime,
  type ScenePlan,
  type Story,
  type Task,
} from "../shared/domain";
import { api, navigate, useResource } from "./api";
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

export function DiscoverPage({ saved = false }: { saved?: boolean }) {
  const { boot, requireLogin } = useApp();
  const [query, setQuery] = useState(""),
    [genre, setGenre] = useState("All stories");
  const stories = boot.stories.filter(
    (s) =>
      (!saved || boot.favorites.includes(s.id)) &&
      (genre === "All stories" || s.genre === genre) &&
      `${s.title} ${s.logline}`.toLowerCase().includes(query.toLowerCase()),
  );
  const featured = boot.stories[0];
  return (
    <div className="page discover-page">
      {!saved && featured && (
        <section
          className="discover-hero"
          style={{
            backgroundImage: `linear-gradient(90deg,rgba(13,19,17,.97),rgba(13,19,17,.1)),url(${featured.coverUrl})`,
          }}
        >
          <div>
            <p className="eyebrow">
              <span className="live-dot" />
              WATCH. IMAGINE. BELONG.
            </p>
            <h1>
              The story is still
              <br />
              <em>being written.</em>
            </h1>
            <p>
              Step into an unfolding world.
              <br />
              Leave a little of yourself in what happens next.
            </p>
            <Link to={`/story/${featured.slug}`} className="button primary">
              Find your place in the story <ArrowRight size={17} />
            </Link>
            <span className="hero-footnote">
              Free to watch · Made together · Always a new possibility
            </span>
          </div>
          <span className="hero-credit">
            FEATURED WORLD
            <br />
            <strong>{featured.title}</strong>
          </span>
        </section>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {saved
              ? "SOMEWHERE TO RETURN TO"
              : "ONE PLATFORM. ENDLESS POSSIBILITIES."}
          </p>
          <h2>{saved ? "Your library" : "Find a world to get lost in."}</h2>
        </div>
        <Link to="/create" className="button secondary">
          <Plus size={16} />
          Start a new story
        </Link>
      </div>
      <div className="discovery-controls">
        <div className="filter-pills">
          {["All stories", ...new Set(boot.stories.map((s) => s.genre))].map(
            (g) => (
              <button
                key={g}
                className={genre === g ? "active" : ""}
                onClick={() => setGenre(g)}
              >
                {g}
              </button>
            ),
          )}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search stories"
            placeholder="Find a story…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {saved && !boot.user ? (
        <Empty
          icon={<BookOpen size={30} />}
          title="Keep your favorite worlds close."
          action={
            <Button onClick={requireLogin}>Sign in to save stories</Button>
          }
        >
          Your saved stories and viewing progress will be here.
        </Empty>
      ) : stories.length ? (
        <div className="story-card-grid">
          {stories.map((s) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Globe2 size={30} />}
          title={
            saved ? "Your next favorite is out there." : "A little quiet here."
          }
          action={
            <Link
              to={saved ? "/discover" : "/create"}
              className="button secondary"
            >
              {saved ? "Discover stories" : "Create a story"}
              <ArrowRight size={15} />
            </Link>
          }
        >
          {query
            ? "Try another title or genre."
            : saved
              ? "Save a story with the bookmark beside its title."
              : "Be the first to give this world a beginning."}
        </Empty>
      )}
      {!saved && (
        <div className="how-it-works-strip">
          {[
            [
              "01",
              "Step into a world",
              "Watch from the beginning, or catch the newest chapter.",
            ],
            [
              "02",
              "Imagine what’s next",
              "Add an idea. The story editor helps it find its place.",
            ],
            [
              "03",
              "Leave your mark",
              "Your scene becomes part of the story, with your name on it.",
            ],
          ].map(([n, title, copy]) => (
            <div key={n}>
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function StoryCard({ story: s }: { story: Story }) {
  return (
    <Link to={`/story/${s.slug}`} className="story-card">
      <div
        className="story-card-image"
        style={{
          backgroundImage: s.coverUrl ? `url(${s.coverUrl})` : undefined,
        }}
      >
        <span className="genre-tag">{s.genre}</span>
        <span className="story-card-arrow">
          <ArrowUpRight size={21} />
        </span>
      </div>
      <div className="story-card-body">
        <span className="eyebrow">
          <i className={s.status === "open" ? "live-dot" : "quiet-dot"} />
          {s.status === "open"
            ? "UNFOLDING"
            : s.status === "paused"
              ? "ON A PAUSE"
              : "A NEW BEGINNING"}
        </span>
        <h3>{s.title}</h3>
        <p>{s.logline}</p>
        <div>
          <span>
            {s.episodeCount} {s.episodeCount === 1 ? "chapter" : "chapters"} ·{" "}
            {s.sceneCount} scenes
          </span>
          <span>{s.fixture ? "Studio sample" : "Community story"}</span>
        </div>
      </div>
    </Link>
  );
}

export function CreateStoryPage() {
  const { boot, requireLogin, refresh } = useApp();
  const [step, setStep] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [title, setTitle] = useState(""),
    [logline, setLogline] = useState(""),
    [genre, setGenre] = useState("Mystery"),
    [rules, setRules] = useState(""),
    [style, setStyle] = useState(
      "Cinematic, natural lighting, distinct character appearances, clear English dialogue.",
    );
  const [characters, setCharacters] = useState([
    { name: "", description: "", state: "" },
  ]);
  const changeCharacter = (index: number, field: string, value: string) =>
    setCharacters((cs) =>
      cs.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  const submit = async () => {
    if (!requireLogin()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ story: Story }>("/stories", "POST", {
        title,
        logline,
        genre,
        worldRules: rules,
        visualStyle: style,
        characters,
      });
      await refresh();
      navigate(`/story/${result.story.slug}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page create-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A WORLD THAT STARTS WITH YOU</p>
          <h1>Give a story its beginning.</h1>
          <p>
            Its own characters. Its own possibilities. One shared way to bring
            it to life.
          </p>
        </div>
      </div>
      <div className="create-layout">
        <section className="form-panel">
          <div className="step-indicator">
            {["The premise", "The world", "The people"].map((s, i) => (
              <button
                key={s}
                className={step === i + 1 ? "active" : ""}
                onClick={() => setStep(i + 1)}
              >
                <span>{step > i + 1 ? <Check size={12} /> : i + 1}</span>
                {s}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step < 3) setStep(step + 1);
              else void submit();
            }}
          >
            {step === 1 && (
              <>
                <p className="eyebrow">01 / THE PREMISE</p>
                <h2>What draws us in?</h2>
                <label className="field-label" htmlFor="story-title">
                  Story title
                </label>
                <input
                  id="story-title"
                  required
                  minLength={3}
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A name with a little possibility"
                />
                <label className="field-label" htmlFor="story-logline">
                  The one-sentence invitation
                </label>
                <textarea
                  id="story-logline"
                  rows={3}
                  required
                  minLength={20}
                  maxLength={240}
                  value={logline}
                  onChange={(e) => setLogline(e.target.value)}
                  placeholder="A place, a person, and something that changes everything…"
                />
                <label className="field-label" htmlFor="story-genre">
                  Genre
                </label>
                <select
                  id="story-genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                >
                  {[
                    "Mystery",
                    "Science fiction",
                    "Fantasy",
                    "Adventure",
                    "Drama",
                  ].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </>
            )}
            {step === 2 && (
              <>
                <p className="eyebrow">02 / THE WORLD</p>
                <h2>A few rules. Room to grow.</h2>
                <label className="field-label" htmlFor="world-rules">
                  Setting & boundaries
                </label>
                <textarea
                  id="world-rules"
                  rows={7}
                  required
                  minLength={30}
                  maxLength={4000}
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  placeholder="Where and when are we? What is possible here? Which facts should every new scene respect?"
                />
                <p className="field-help">
                  These rules belong only to this story. Leave room for other
                  people to add discoveries.
                </p>
                <label className="field-label" htmlFor="visual-style">
                  Visual direction
                </label>
                <textarea
                  id="visual-style"
                  rows={3}
                  required
                  minLength={10}
                  maxLength={700}
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                />
                <Notice>
                  Every world uses English dialogue, narration and captions.
                  Contributor prompts can begin in any language.
                </Notice>
              </>
            )}
            {step === 3 && (
              <>
                <p className="eyebrow">03 / THE PEOPLE</p>
                <h2>Who do we meet first?</h2>
                {characters.map((ch, i) => (
                  <div className="character-form" key={i}>
                    <div className="section-heading">
                      <strong>Character {i + 1}</strong>
                      {characters.length > 1 && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove character ${i + 1}`}
                          onClick={() =>
                            setCharacters((cs) => cs.filter((_, n) => n !== i))
                          }
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                    <label className="field-label" htmlFor={`name-${i}`}>
                      English name
                    </label>
                    <input
                      id={`name-${i}`}
                      required
                      minLength={2}
                      maxLength={60}
                      value={ch.name}
                      onChange={(e) =>
                        changeCharacter(i, "name", e.target.value)
                      }
                    />
                    <label className="field-label" htmlFor={`description-${i}`}>
                      Appearance & personality
                    </label>
                    <textarea
                      id={`description-${i}`}
                      required
                      minLength={10}
                      rows={3}
                      value={ch.description}
                      onChange={(e) =>
                        changeCharacter(i, "description", e.target.value)
                      }
                      placeholder="Distinctive appearance, voice, motivation…"
                    />
                    <label className="field-label" htmlFor={`state-${i}`}>
                      Where their story begins
                    </label>
                    <input
                      id={`state-${i}`}
                      required
                      minLength={5}
                      value={ch.state}
                      onChange={(e) =>
                        changeCharacter(i, "state", e.target.value)
                      }
                      placeholder="Location, what they know, what they carry"
                    />
                  </div>
                ))}
                {characters.length < 3 && (
                  <Button
                    type="button"
                    kind="secondary"
                    onClick={() =>
                      setCharacters((cs) => [
                        ...cs,
                        { name: "", description: "", state: "" },
                      ])
                    }
                  >
                    <Plus size={15} />
                    Add a character
                  </Button>
                )}
                <p className="fine-print">
                  Your world starts as a draft. Open it when ready; video
                  generation starts only after a scene is reviewed and queued.
                </p>
              </>
            )}
            {error && <Notice danger>{error}</Notice>}
            <div className="form-actions">
              {step > 1 && (
                <Button
                  type="button"
                  kind="ghost"
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </Button>
              )}
              <Button type="submit" busy={busy}>
                {step < 3
                  ? "Continue"
                  : boot.user
                    ? "Create this world"
                    : "Sign in to create"}
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
        </section>
        <aside className="world-preview">
          <span className="eyebrow">YOUR WORLD, TAKING SHAPE</span>
          <div className="world-preview-art">
            <Globe2 size={54} />
            <span>{genre}</span>
          </div>
          <h2>{title || "An unwritten story"}</h2>
          <p>
            {logline || "A small idea can become a world someone returns to."}
          </p>
          <div className="preview-cast">
            {characters
              .filter((c) => c.name)
              .map((c, i) => (
                <span key={i}>
                  <Avatar name={c.name} size={26} />
                  {c.name}
                </span>
              ))}
          </div>
          <div className="world-independence">
            <Check size={16} />
            <p>
              Independent characters, history and queue. Your other stories stay
              exactly as they are.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ContributionsPage() {
  const { boot, requireLogin, refresh, toast } = useApp(),
    resource = useResource<{ tasks: Task[] }>(boot.user ? "/tasks" : null, [
      boot.user?.id,
    ]);
  const [review, setReview] = useState<Task | null>(null),
    [filter, setFilter] = useState("All contributions");
  const reload = async () => {
    await resource.reload();
    await refresh();
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE MARK YOU LEAVE</p>
          <h1>Your contributions.</h1>
          <p>
            Every idea has a home. Follow yours from the first spark to the
            final scene.
          </p>
        </div>
        <Button kind="secondary" onClick={() => void reload()}>
          Refresh status
        </Button>
      </div>
      {!boot.user ? (
        <Empty
          icon={<Sparkles size={30} />}
          title="Your imagination belongs here."
          action={<Button onClick={requireLogin}>Sign in to begin</Button>}
        >
          Your ideas, queue updates and scene credits will appear here.
        </Empty>
      ) : resource.loading ? (
        <Loading />
      ) : (
        <>
          <div className="filter-pills contribution-filters">
            {[
              "All contributions",
              "In progress",
              "Published",
              "Saved ideas",
            ].map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {resource.error && <Notice danger>{resource.error}</Notice>}
          <div className="contribution-list">
            {resource.data?.tasks
              .filter(
                (t) =>
                  filter === "All contributions" ||
                  (filter === "Published"
                    ? t.status === "Published"
                    : filter === "Saved ideas"
                      ? t.status === "Draft"
                      : !["Draft", "Published", "Cancelled", "Failed"].includes(
                          t.status,
                        )),
              )
              .map((t) => {
                const story = boot.stories.find((s) => s.id === t.storyId);
                return (
                  <article className="contribution-card" key={t.id}>
                    <div className="section-heading">
                      <Link
                        to={`/story/${story?.slug ?? t.storyId}`}
                        className="eyebrow"
                      >
                        {story?.title ?? "Your story"}{" "}
                        <ArrowUpRight size={13} />
                      </Link>
                      <Status state={t.status} />
                    </div>
                    <h3>{t.plan?.title || "A saved possibility"}</h3>
                    <p className="contribution-prompt">“{t.prompt}”</p>
                    {t.reason && <Notice>{t.reason}</Notice>}
                    <div className="contribution-meta">
                      <Author id={t.userId} name={t.author} compact />
                      <span>
                        {new Date(t.createdAt).toLocaleDateString("en", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <div className="contribution-actions">
                        {["Draft", "NeedsReview"].includes(t.status) && (
                          <Button kind="secondary" onClick={() => setReview(t)}>
                            {t.status === "Draft"
                              ? "Preview & continue"
                              : "Review new plan"}
                          </Button>
                        )}
                        {["Draft", "NeedsReview", "Queued"].includes(
                          t.status,
                        ) && (
                          <button
                            className="text-button"
                            onClick={async () => {
                              try {
                                await api(`/tasks/${t.id}/cancel`, "POST", {});
                                await reload();
                                toast(
                                  "Contribution withdrawn. Any reserved credit was returned.",
                                );
                              } catch (e) {
                                toast((e as Error).message);
                              }
                            }}
                          >
                            Withdraw
                          </button>
                        )}
                        {t.status === "Published" && (
                          <Link
                            to={`/story/${story?.slug ?? t.storyId}?scene=${encodeURIComponent(t.id)}`}
                            className="button secondary"
                          >
                            Watch your scene <ArrowRight size={14} />
                          </Link>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
          {!resource.data?.tasks.length && (
            <Empty
              icon={<Clapperboard size={30} />}
              title="Your first scene is waiting."
              action={
                <Link to="/discover" className="button primary">
                  Find a story <ArrowRight size={15} />
                </Link>
              }
            >
              Begin with a world that catches your imagination.
            </Empty>
          )}
        </>
      )}
      {review && (
        <ReviewModal
          initial={review}
          close={() => setReview(null)}
          done={reload}
        />
      )}
    </div>
  );
}
function ReviewModal({
  initial,
  close,
  done,
}: {
  initial: Task;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [task, setTask] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  return (
    <Modal
      title={task.plan?.title || "Find your idea’s place."}
      eyebrow="YOUR CONTRIBUTION"
      onClose={close}
    >
      <p className="modal-copy">{task.plan?.summary || task.prompt}</p>
      {task.plan && (
        <div className="bridge">
          <span>Connecting to the story</span>
          {task.plan.bridge}
        </div>
      )}
      {task.reason && <Notice>{task.reason}</Notice>}
      {task.plan && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Publish my original idea and nickname with this scene. I approve
            this plan and small continuity edits.
          </span>
        </label>
      )}
      {error && <Notice danger>{error}</Notice>}
      <Button
        className="full-width"
        disabled={!!task.plan && (!consent || task.plan.rejected)}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            if (!task.plan) {
              const r = await api<{ task: Task }>(
                `/tasks/${task.id}/preview`,
                "POST",
                {},
              );
              setTask(r.task);
            } else {
              await api(`/tasks/${task.id}/accept`, "POST", {
                planUpdatedAt: task.updatedAt,
                publicAttributionAccepted: consent,
              });
              await done();
              close();
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {task.plan ? "Join the queue · 1 free credit" : "Prepare my scene plan"}
        <ArrowRight size={16} />
      </Button>
    </Modal>
  );
}

export function AccountPage() {
  const { boot, requireLogin, refresh, toast } = useApp();
  const [nickname, setNickname] = useState(boot.user?.displayName ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!boot.user)
    return (
      <div className="page">
        <Empty
          icon={<Avatar name="?" size={48} />}
          title="Your storyteller account"
          action={<Button onClick={requireLogin}>Sign in</Button>}
        >
          A name in the credits. A place in the story.
        </Empty>
      </div>
    );
  return (
    <div className="page account-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR PLACE IN THE STORY</p>
          <h1>Your storyteller account.</h1>
        </div>
      </div>
      <div className="account-grid">
        <section className="form-panel">
          <div className="profile-heading">
            <Avatar name={boot.user.displayName} size={64} />
            <div>
              <h2>{boot.user.displayName}</h2>
              <Link to={`/people/${boot.user.id}`} className="text-button">
                View your public credits <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/account/profile", "PUT", { nickname });
                await refresh();
                toast(
                  "Your public nickname has been updated across your scene credits.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field-label" htmlFor="nickname">
              Public nickname
            </label>
            <input
              id="nickname"
              value={nickname}
              minLength={2}
              maxLength={30}
              onChange={(e) => setNickname(e.target.value)}
              required
            />
            <p className="field-help">
              You can change this name. Your permanent author ID keeps every
              contribution connected to you.
            </p>
            <label className="field-label" htmlFor="email">
              Account email · only visible to you
            </label>
            <input id="email" value={boot.user.email ?? ""} readOnly />
            <p className="field-help">
              Your email is never shown in scene credits or on your public
              profile.
            </p>
            {error && <Notice danger>{error}</Notice>}
            <Button type="submit" busy={busy}>
              Save profile
            </Button>
          </form>
        </section>
        <section className="credit-panel">
          <span className="eyebrow">YOUR DAILY IMAGINATION ALLOWANCE</span>
          <strong>
            {boot.credits?.available ?? 0}
            <small>free credits available</small>
          </strong>
          <div className="credit-details">
            <span>
              Reserved for scenes in progress{" "}
              <b>{boot.credits?.reserved ?? 0}</b>
            </span>
            <span>
              Used on delivered scenes <b>{boot.credits?.spent ?? 0}</b>
            </span>
          </div>
          <p>
            Resets{" "}
            {new Date(boot.credits?.resetsAt ?? Date.now()).toLocaleString(
              "en",
              {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              },
            )}
            .
          </p>
          <Notice>
            No purchases or subscriptions are active. We’ll ask before offering
            anything paid.
          </Notice>
        </section>
      </div>
      <AccountRequests />
      <div className="account-bottom">
        <Button
          kind="secondary"
          onClick={async () => {
            try {
              await api("/logout", "POST", {});
              await refresh();
              navigate("/discover");
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          <LogOut size={16} />
          Sign out
        </Button>
        <Link to="/about?section=privacy" className="text-button">
          Privacy & account deletion
        </Link>
      </div>
    </div>
  );
}
export function PersonPage({ id }: { id: string }) {
  const r = useResource<{
    person: { id: string; displayName: string; joinedAt: number };
    contributions: {
      id: string;
      title: string;
      storyTitle: string;
      storySlug: string;
      episodeId: string;
      startMs: number;
      durationMs: number;
      thumbnailUrl: string;
    }[];
  }>(`/people/${encodeURIComponent(id)}`);
  if (r.loading) return <Loading />;
  if (!r.data)
    return (
      <div className="page">
        <Notice danger>{r.error}</Notice>
      </div>
    );
  const { person, contributions } = r.data;
  return (
    <div className="page">
      <div className="public-profile-heading">
        <Avatar name={person.displayName} size={84} />
        <p className="eyebrow">A VOICE IN THESE WORLDS</p>
        <h1>{person.displayName}</h1>
        <p>
          {contributions.length}{" "}
          {contributions.length === 1 ? "scene" : "scenes"} imagined. Part of
          something bigger.
        </p>
      </div>
      <div className="page-heading">
        <h2>Their place in the story.</h2>
      </div>
      <div className="story-card-grid">
        {contributions.map((c) => (
          <Link
            key={c.id}
            className="story-card"
            to={`/story/${c.storySlug}?episode=${encodeURIComponent(c.episodeId)}&t=${Math.floor(c.startMs / 1000)}`}
          >
            <div
              className="story-card-image"
              style={{ backgroundImage: `url(${c.thumbnailUrl})` }}
            >
              <span className="story-card-arrow">
                <Film size={19} />
              </span>
            </div>
            <div className="story-card-body">
              <span className="eyebrow">{c.storyTitle}</span>
              <h3>{c.title}</h3>
              <p>
                Imagined by {person.displayName} · {formatTime(c.durationMs)}
              </p>
            </div>
          </Link>
        ))}
      </div>
      {!contributions.length && (
        <Empty icon={<Sparkles size={28} />} title="A story yet to be told.">
          Published scene credits will appear here.
        </Empty>
      )}
    </div>
  );
}
export function AboutPage() {
  const { boot } = useApp();
  return (
    <div className="page about-page">
      <p className="eyebrow">A SMALL GUIDE TO A SHARED WORLD</p>
      <h1>
        Stories belong to the people
        <br />
        who imagine them.
      </h1>
      <section>
        <h2>How a scene becomes part of the story</h2>
        <ol>
          <li>
            Watch a world and get to know its characters. You can always start
            at the beginning.
          </li>
          <li>
            Write an idea in any language. The story editor turns it into an
            English scene plan.
          </li>
          <li>
            Approve the plan and reserve one free credit. Ideas take turns
            within their own story.
          </li>
          <li>
            Before generation, we check the latest story again. Major changes
            return to you for review.
          </li>
          <li>
            The finished video is checked and published with your nickname and
            creative prompt. Failed delivery returns your credit.
          </li>
        </ol>
      </section>
      <section id="attribution">
        <h2>Your name stays with your scene</h2>
        <p>
          Your contribution appears beside the video, in its timeline and on
          your public storyteller profile. The original idea and its English
          translation are labeled separately. System-created transitions are not
          presented as your words.
        </p>
      </section>
      <section id="privacy">
        <h2>Your email is private. Your creativity is public.</h2>
        <p>
          Your email supports sign-in and account recovery. Your chosen
          nickname, published prompts and scene credits are public. Do not
          include passwords, contact details or other private information in a
          creative prompt.
        </p>
        <p>
          Request account deletion from your Account page. To request correction
          or prompt removal, use “Report a concern” on a story. The studio can
          review your request while preserving an understandable record of the
          shared story.
        </p>
      </section>
      <section id="terms">
        <h2>A few shared agreements</h2>
        <p>
          Submit original ideas and reference material you have permission to
          use. By approving a scene, you allow the platform to adapt your idea,
          generate and publicly show the resulting scene, and retain its
          contribution credit as part of the story. AI generation can differ
          from the plan; you can report a result that needs review.
        </p>
        <p>
          Do not use the platform for harassment, exploitation, sexual content
          involving minors, hateful attacks, or graphic violence. Stories can be
          paused and content removed after review.
        </p>
        <p>
          Free credits have limits. There is no automatic purchase, subscription
          or charge to a user account. Paid features, if introduced later,
          require a separate choice.
        </p>
      </section>
      <section>
        <h2>Need a hand?</h2>
        <p>
          Sign in and choose “Report a concern” on the relevant story. Include
          the chapter, timestamp and what you need help with.
        </p>
        {boot.config.supportEmail && (
          <a
            href={`mailto:${boot.config.supportEmail}`}
            className="text-button"
          >
            Email the studio <ArrowRight size={15} />
          </a>
        )}
      </section>
    </div>
  );
}
import { useState } from "react";
import { AccountRequests } from "./AccountRequests";
