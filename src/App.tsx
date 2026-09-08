import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  BookOpen,
  ChevronDown,
  Compass,
  Film,
  HelpCircle,
  Layers3,
  Menu,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { api, navigate, useLocation, useResource } from "./api";
import { Avatar, Button, Link, Loading, Modal, Notice } from "./components";
import { AppContext, type Bootstrap } from "./context";
import { StoryPage } from "./StoryPage";
import {
  AccountPage,
  ContributionsPage,
  CreateStoryPage,
  DiscoverPage,
  PersonPage,
  AboutPage,
} from "./pages";
import { StudioPage } from "./StudioPage";
import { LegalPage } from "./LegalPage";
import policies from "../shared/policies.json";
import { brand } from "../shared/brand";

export function App() {
  const path = useLocation(),
    resource = useResource<Bootstrap>("/bootstrap");
  const [login, setLogin] = useState(false),
    [menu, setMenu] = useState(false),
    [switcher, setSwitcher] = useState(false),
    [notifications, setNotifications] = useState(false),
    [message, setMessage] = useState("");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width:760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width:760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (resource.data && window.location.pathname === "/")
      navigate(
        resource.data.stories[0]
          ? `/story/${resource.data.stories[0].slug}`
          : "/discover",
        true,
      );
  }, [resource.data]);
  useEffect(() => {
    setMenu(false);
    setSwitcher(false);
    setNotifications(false);
  }, [path]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(id);
  }, [message]);
  const legalKind =
    path.split(/[?#]/)[0] === "/privacy"
      ? "privacy"
      : path.split(/[?#]/)[0] === "/terms"
        ? "terms"
        : null;
  if (!resource.data && legalKind) return <LegalPage kind={legalKind} />;
  if (!resource.data)
    return (
      <div className="boot-screen">
        <Brand />
        <Loading />
        {resource.error && (
          <>
            <Notice danger>{resource.error}</Notice>
            <Button onClick={() => void resource.reload()}>Try again</Button>
          </>
        )}
      </div>
    );
  const boot = resource.data;
  const story = boot.stories.find(
    (s) => path.split("?")[0] === `/story/${s.slug}`,
  );
  const needsOnboarding =
    !!boot.user && (!boot.user.displayName || !boot.user.policyAccepted);
  const needNickname = needsOnboarding && !onboardingDismissed && !legalKind;
  const requireLogin = () => {
    if (!boot.user) {
      setLogin(true);
      return false;
    }
    if (needsOnboarding) {
      setOnboardingDismissed(false);
      return false;
    }
    return true;
  };
  const nav = (to: string, icon: ReactNode, label: string) => (
    <Link
      to={to}
      className={`nav-item ${path.startsWith(to) ? "selected" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
  let page: ReactNode;
  if (legalKind) page = <LegalPage kind={legalKind} />;
  else if (path.startsWith("/story/"))
    page = (
      <StoryPage
        key={`${path.split("?")[0]}:${boot.user?.id ?? "guest"}`}
        slug={decodeURIComponent(path.split("?")[0].split("/")[2])}
      />
    );
  else if (path.startsWith("/create")) page = <CreateStoryPage />;
  else if (path.startsWith("/contributions")) page = <ContributionsPage />;
  else if (path.startsWith("/account")) page = <AccountPage />;
  else if (path.startsWith("/people/"))
    page = <PersonPage id={decodeURIComponent(path.split("/")[2])} />;
  else if (path.startsWith("/studio")) page = <StudioPage />;
  else if (path.startsWith("/about")) page = <AboutPage />;
  else page = <DiscoverPage saved={path.startsWith("/library")} />;
  return (
    <AppContext.Provider
      value={{
        boot,
        refresh: resource.reload,
        requireLogin,
        toast: setMessage,
      }}
    >
      <div className="app-shell">
        {menu && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          />
        )}
        <aside
          className={`sidebar ${menu ? "mobile-open" : ""}`}
          inert={mobile && !menu}
          aria-hidden={mobile && !menu ? true : undefined}
        >
          <Brand />
          <p className="brand-caption">THE NEXT SCENE IS YOURS.</p>
          <div className="nav-section">
            <span className="section-label">YOUR FRONT ROW</span>
            {nav("/discover", <Compass size={19} />, "Discover stories")}
            {story && (
              <Link to={`/story/${story.slug}`} className="nav-item selected">
                <Film size={19} />
                <span>Now watching</span>
                <span className="live-dot" />
              </Link>
            )}
            {nav("/library", <BookOpen size={19} />, "Your library")}
            {nav(
              "/contributions",
              <Sparkles size={19} />,
              "Your contributions",
            )}
          </div>
          <div className="nav-section worlds-nav">
            <div className="section-heading">
              <span className="section-label">WORLDS TO STEP INTO</span>
              <Link to="/create" className="icon-button">
                <Plus size={16} />
                <span className="sr-only">Create a story</span>
              </Link>
            </div>
            {boot.stories.slice(0, 6).map((s) => (
              <Link
                key={s.id}
                to={`/story/${s.slug}`}
                className={`world-nav ${s.id === story?.id ? "active" : ""}`}
              >
                <span
                  className="world-thumb"
                  style={
                    s.coverUrl ? { backgroundImage: `url(${s.coverUrl})` } : {}
                  }
                />
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.genre}</small>
                </span>
              </Link>
            ))}
          </div>
          <Link to="/create" className="new-world-link">
            <Plus size={16} />
            Start a new story
            <ArrowRight size={15} />
          </Link>
          <div className="sidebar-bottom">
            <p>
              Some stories stay with you.
              <br />
              Here, you can stay with them.
            </p>
            {nav("/about", <HelpCircle size={17} />, `How ${brand.name} works`)}
            {boot.user?.role === "admin" &&
              nav("/studio", <Settings2 size={17} />, "Studio dashboard")}
            {boot.user ? (
              <Link to="/account" className="user-menu">
                <Avatar name={boot.user.displayName} />
                <span>
                  <strong>{boot.user.displayName || "Choose your name"}</strong>
                  <small>
                    {boot.wallet?.available ?? 0} creation points available
                  </small>
                </span>
                <ChevronDown size={14} />
              </Link>
            ) : (
              <button className="user-menu" onClick={() => setLogin(true)}>
                <Avatar name="?" />
                <span>
                  <strong>Join the story</strong>
                  <small>Watch and propose for free.</small>
                </span>
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </aside>
        <div className="main-column">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <div className="story-switcher">
              <button
                onClick={() => setSwitcher(!switcher)}
                aria-expanded={switcher}
              >
                <Layers3 size={17} />
                <span>{story?.title ?? `Explore ${brand.name}`}</span>
                <ChevronDown size={15} />
              </button>
              {switcher && (
                <div className="dropdown story-dropdown">
                  {boot.stories.map((s) => (
                    <Link key={s.id} to={`/story/${s.slug}`}>
                      <span>{s.title}</span>
                      <small>{s.genre}</small>
                    </Link>
                  ))}
                  <Link to="/create">
                    <Plus size={16} />
                    Create a new story
                  </Link>
                </div>
              )}
            </div>
            <div className="topbar-actions">
              <span className="edition">
                A LITTLE IMAGINATION GOES A LONG WAY
              </span>
              {boot.user ? (
                <>
                  <span className="credit-pill">
                    <Sparkles size={13} />
                    {boot.wallet?.available ?? 0} points
                  </span>
                  <div className="notification-wrap">
                    <button
                      className="icon-button"
                      aria-label="Notifications"
                      onClick={() => {
                        setNotifications(!notifications);
                        if (!notifications)
                          void api("/notifications/read", "POST", {})
                            .then(resource.reload)
                            .catch(() => {});
                      }}
                    >
                      <Bell size={18} />
                      {boot.notifications.some((n) => !n.readAt) && (
                        <i className="notification-dot" />
                      )}
                    </button>
                    {notifications && (
                      <div className="dropdown notification-dropdown">
                        <strong>Your updates</strong>
                        {boot.notifications.length ? (
                          boot.notifications.slice(0, 8).map((n) => (
                            <Link key={n.id} to="/contributions">
                              {n.message}
                            </Link>
                          ))
                        ) : (
                          <p>
                            No updates yet. Your scene’s progress will appear
                            here.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <button className="text-button" onClick={() => setLogin(true)}>
                  Sign in <ArrowUpIcon />
                </button>
              )}
            </div>
          </header>
          {boot.config.development && (
            <div className="development-banner">
              <span />
              Development preview · Illustrative storyboards and sample playback
              · No paid generation
            </div>
          )}
          {boot.config.environment === "staging" && (
            <div className="development-banner">
              <span />
              Test site ·{" "}
              {boot.config.canSignIn
                ? "Google sign-in available"
                : "Google sign-in is being configured"}
              {boot.config.generationEnabled
                ? " · Controlled generation testing"
                : " · Generation is paused"}
              {boot.config.paymentsEnabled
                ? " · Sandbox checkout only"
                : " · Purchases are unavailable"}
            </div>
          )}
          <main>{page}</main>
          <footer className="site-footer">
            <span>
              {brand.name.toUpperCase()} <i>Stories we make together.</i>
            </span>
            <div>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms & attribution</Link>
              <Link to="/about">Help</Link>
              {boot.config.supportEmail && (
                <a href={`mailto:${boot.config.supportEmail}`}>
                  {policies.contactName}
                </a>
              )}
            </div>
          </footer>
        </div>
      </div>
      {login && !boot.user && (
        <LoginModal
          close={() => setLogin(false)}
          done={async () => {
            await resource.reload();
            setLogin(false);
          }}
          development={boot.config.development}
          configured={boot.config.canSignIn}
        />
      )}
      {needNickname && (
        <NicknameModal
          initialName={boot.user?.displayName ?? ""}
          done={resource.reload}
          decline={() => setOnboardingDismissed(true)}
        />
      )}
      {message && (
        <div className="toast" role="status">
          {message}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setMessage("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
function ArrowUpIcon() {
  return <ArrowRight size={14} />;
}
function Brand() {
  return (
    <Link to="/discover" className="brand">
      <span className="brand-mark">
        {brand.initial}
        <span />
      </span>
      <span>
        {brand.wordmark}
        <span className="brand-period">.</span>
      </span>
    </Link>
  );
}
function LoginModal({
  close,
  done,
  development,
  configured,
}: {
  close: () => void;
  done: () => Promise<void>;
  development: boolean;
  configured: boolean;
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const login = async (persona: string) => {
    setBusy(persona);
    setError("");
    try {
      await api("/dev/login", "POST", { persona });
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <Modal
      title="Every story needs you."
      eyebrow={`WELCOME TO ${brand.name.toUpperCase()}`}
      onClose={close}
    >
      <p className="modal-copy">
        Watch from the beginning, save your favorite worlds, and leave your name
        on what happens next.
      </p>
      {!development && (
        <Button
          className="full-width"
          disabled={!configured}
          busy={busy === "google"}
          onClick={async () => {
            setBusy("google");
            try {
              const r = await api<{ url: string }>(
                "/auth/sign-in/social",
                "POST",
                { provider: "google", callbackURL: window.location.href },
              );
              window.location.assign(r.url);
            } catch (e) {
              setError((e as Error).message);
              setBusy("");
            }
          }}
        >
          Continue with Google
        </Button>
      )}
      {!configured && (
        <Notice>
          Sign-in is being prepared. You can still explore the stories.
        </Notice>
      )}
      {development && (
        <div className="stack">
          <Notice>
            Local test accounts. These do not connect to Google or spend money.
          </Notice>
          <Button
            busy={busy === "creator"}
            onClick={() => void login("creator")}
          >
            Explore as a storyteller <ArrowRight size={16} />
          </Button>
          <Button
            kind="secondary"
            busy={busy === "newcomer"}
            onClick={() => void login("newcomer")}
          >
            Test first-time sign-in
          </Button>
          <Button
            kind="ghost"
            busy={busy === "studio"}
            onClick={() => void login("studio")}
          >
            Open the local studio account
          </Button>
        </div>
      )}
      {error && <Notice danger>{error}</Notice>}
      <p className="fine-print">
        Your email stays private. You’ll choose a public nickname for your
        contributions. No credit card needed. Read our{" "}
        <a href="/terms" target="_blank" rel="noopener">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" target="_blank" rel="noopener">
          Privacy policy
        </a>{" "}
        before signing in.
      </p>
    </Modal>
  );
}
function NicknameModal({
  done,
  decline,
  initialName,
}: {
  done: () => Promise<void>;
  decline: () => void;
  initialName: string;
}) {
  const [nickname, setNickname] = useState(initialName),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  return (
    <Modal
      title={
        initialName ? "Before your next scene." : "What should we call you?"
      }
      eyebrow="YOUR STORYTELLER IDENTITY"
      dismissible={false}
      onClose={() => {}}
    >
      <p className="modal-copy">
        This name will appear on your scenes, creative prompts and public
        profile. Your email will never be used as a public byline.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!accepted) return;
          setBusy(true);
          try {
            await api("/account/profile", "PUT", { nickname });
            await api("/account/policies", "POST", {
              version: policies.version,
              termsAccepted: true,
              privacyAcknowledged: true,
            });
            await done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label" htmlFor="first-nickname">
          Public nickname
        </label>
        <input
          id="first-nickname"
          autoFocus
          value={nickname}
          minLength={2}
          maxLength={30}
          required
          placeholder="Your name in the credits"
          onChange={(e) => setNickname(e.target.value)}
        />
        <div className="byline-preview">
          <Avatar name={nickname} />
          <span>
            Next scene imagined by{" "}
            <strong>{nickname || "your nickname"}</strong>
          </span>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            required
          />
          <span>
            I agree to the{" "}
            <a href="/terms" target="_blank" rel="noopener">
              Terms of service
            </a>{" "}
            and acknowledge the{" "}
            <a href="/privacy" target="_blank" rel="noopener">
              Privacy policy
            </a>
            .
          </span>
        </label>
        {policies.status === "draft" && (
          <p className="fine-print">
            Development draft · This records a preview acknowledgment. Final
            policies will require a new review before public use.
          </p>
        )}
        {error && <Notice danger>{error}</Notice>}
        <Button
          type="submit"
          className="full-width"
          busy={busy}
          disabled={!accepted}
        >
          Make it yours <ArrowRight size={16} />
        </Button>
        <button type="button" className="text-button" onClick={decline}>
          Keep watching without accepting
        </button>
      </form>
    </Modal>
  );
}
