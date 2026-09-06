import { useEffect, useRef, useState } from "react";
import {
  Captions,
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import {
  formatTime,
  sceneAt,
  type Episode,
  type Scene,
} from "../shared/domain";
import { Author, Button } from "./components";

export function Player({
  scenes,
  episode,
  poster,
  startTime,
  onPosition,
  onEnd,
  fixture,
}: {
  scenes: Scene[];
  episode: Episode;
  poster: string;
  startTime: number;
  onPosition: (time: number, version: number) => void;
  onEnd: () => void;
  fixture: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    frame = useRef<HTMLDivElement>(null),
    autoPlay = useRef(false),
    pendingSeek = useRef(0),
    latestPosition = useRef(0);
  const [index, setIndex] = useState(0),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false),
    [captions, setCaptions] = useState(false),
    [error, setError] = useState(""),
    [hover, setHover] = useState<string | null>(null),
    [original, setOriginal] = useState(false),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0),
    [offline, setOffline] = useState(!navigator.onLine);
  const scene = scenes[index];
  const seek = (target: number) => {
    target = Number.isFinite(target)
      ? Math.max(0, Math.min(target, episode.durationMs))
      : 0;
    const selected =
      sceneAt(scenes, Math.max(0, Math.min(target, episode.durationMs))) ??
      scenes[0];
    if (!selected) return;
    const i = scenes.findIndex((s) => s.id === selected.id),
      within =
        Math.min(
          selected.durationMs - 1,
          Math.max(0, target - selected.startMs),
        ) / 1000;
    pendingSeek.current = within;
    if (i === index && video.current && video.current.readyState >= 1) {
      video.current.currentTime = within;
      pendingSeek.current = 0;
    } else {
      autoPlay.current = playing;
      setIndex(i);
    }
    setTime(target);
    latestPosition.current = within;
    onPosition(target, selected.version);
  };
  useEffect(() => {
    const clamped = Number.isFinite(startTime)
      ? Math.max(0, Math.min(startTime, episode.durationMs))
      : 0;
    const target = sceneAt(scenes, clamped) ?? scenes[0];
    if (target) {
      const within =
        Math.min(target.durationMs - 1, Math.max(0, clamped - target.startMs)) /
        1000;
      pendingSeek.current = within;
      if (
        target.id === scene?.id &&
        video.current &&
        video.current.readyState >= 1
      ) {
        video.current.currentTime = within;
        pendingSeek.current = 0;
      }
      setIndex(scenes.findIndex((s) => s.id === target.id));
      setTime(clamped);
      latestPosition.current = within;
      onPosition(clamped, target.version);
    }
  }, [episode.id, startTime]);
  useEffect(() => {
    const el = video.current;
    if (!el || !scene) return;
    if (scene.hidden) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    if (
      scene.mediaUrl.endsWith(".m3u8") &&
      !el.canPlayType("application/vnd.apple.mpegurl")
    ) {
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setError(
              "This browser cannot play this stream. Try a current browser.",
            );
            setLoading(false);
            return;
          }
          const hls = new Hls();
          hls.loadSource(scene.mediaUrl);
          hls.attachMedia(el);
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) {
              setError(
                "Playback was interrupted. You can retry from this scene.",
              );
              setLoading(false);
            }
          });
          cleanup = () => hls.destroy();
        })
        .catch(() => {
          if (!cancelled) {
            setError("The streaming player could not load. Please retry.");
            setLoading(false);
          }
        });
    } else {
      el.src = scene.mediaUrl;
      el.load();
    }
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [scene?.id, scene?.mediaUrl, scene?.hidden, retry]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const nextScene = scenes[index + 1];
  useEffect(() => {
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (
      !playing ||
      offline ||
      !nextScene ||
      nextScene.hidden ||
      nextScene.mediaUrl.includes(".m3u8") ||
      connection?.saveData ||
      /(^|-)2g$/.test(connection?.effectiveType ?? "")
    )
      return;
    // Only warm the next short MP4. Browser HTTP caching can reuse these bytes; this does not promise gapless playback.
    const warm = document.createElement("video");
    warm.preload = "auto";
    warm.muted = true;
    warm.src = nextScene.mediaUrl;
    warm.load();
    return () => {
      warm.removeAttribute("src");
      warm.load();
    };
  }, [nextScene?.id, nextScene?.mediaUrl, nextScene?.hidden, playing, offline]);
  const retryPlayback = () => {
    pendingSeek.current = latestPosition.current;
    setError("");
    setLoading(true);
    setRetry((n) => n + 1);
  };
  useEffect(() => {
    const el = video.current;
    if (el) {
      el.muted = muted;
      for (let i = 0; i < el.textTracks.length; i++)
        el.textTracks[i].mode = captions ? "showing" : "hidden";
    }
  }, [muted, captions, scene?.id]);
  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.ended && index === scenes.length - 1) {
      seek(0);
      autoPlay.current = true;
      if (index !== 0) return;
    }
    if (el.paused) {
      autoPlay.current = true;
      void el.play().catch(() => {
        setError("Press play to start this scene.");
        setLoading(false);
      });
    } else {
      autoPlay.current = false;
      el.pause();
    }
  };
  const pointed = scenes.find((s) => s.id === hover);
  if (!scene) return null;
  return (
    <div className="player-block">
      <div
        className="video-frame"
        ref={frame}
        tabIndex={0}
        aria-label="Story player. Space to play or pause; arrow keys to seek."
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || scene.hidden) return;
          if (e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight")
            e.preventDefault();
          if (e.key === " ") toggle();
          if (e.key === "ArrowLeft") seek(time - 5000);
          if (e.key === "ArrowRight") seek(time + 5000);
        }}
      >
        <video
          ref={video}
          poster={poster}
          playsInline
          preload="auto"
          aria-label={`${episode.title}: ${scene.title}`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onWaiting={() => setLoading(true)}
          onPlaying={() => setLoading(false)}
          onCanPlay={() => setLoading(false)}
          onLoadedMetadata={() => {
            if (!video.current) return;
            video.current.currentTime = Math.max(
              0,
              Math.min(
                pendingSeek.current,
                Number.isFinite(video.current.duration)
                  ? video.current.duration - 0.01
                  : pendingSeek.current,
              ),
            );
            pendingSeek.current = 0;
            if (autoPlay.current)
              void video.current.play().catch(() => setPlaying(false));
          }}
          onTimeUpdate={() => {
            if (!video.current) return;
            if (video.current.readyState < 1) return;
            latestPosition.current = video.current.currentTime;
            const t =
              scene.startMs +
              Math.min(scene.durationMs, video.current.currentTime * 1000);
            setTime(t);
            onPosition(t, scene.version);
          }}
          onEnded={() => {
            if (index + 1 < scenes.length) {
              pendingSeek.current = 0;
              latestPosition.current = 0;
              autoPlay.current = true;
              setIndex(index + 1);
            } else {
              autoPlay.current = false;
              setPlaying(false);
              onEnd();
            }
          }}
          onError={() => {
            setError(
              "This scene could not be loaded. Retry when your connection is ready.",
            );
            setLoading(false);
          }}
        >
          <track
            key={scene.id}
            kind="captions"
            srcLang="en"
            label="English"
            src={scene.captionsUrl}
            default={captions}
            onLoad={() => {
              if (video.current)
                for (let i = 0; i < video.current.textTracks.length; i++)
                  video.current.textTracks[i].mode = captions
                    ? "showing"
                    : "hidden";
            }}
          />
        </video>
        <div className="video-top">
          <span className="video-badge">
            CHAPTER {String(episode.number).padStart(2, "0")}
          </span>
          <span>
            {fixture
              ? "ILLUSTRATIVE PLAYBACK SAMPLE"
              : "AI CO-CREATED · ENGLISH"}
          </span>
        </div>
        {!playing && !error && !scene.hidden && (
          <button className="big-play" aria-label="Play story" onClick={toggle}>
            <Play size={30} fill="currentColor" />
            <span>
              {time >= episode.durationMs
                ? "Replay this chapter"
                : time > 0
                  ? "Continue watching"
                  : "Step into the story"}
            </span>
          </button>
        )}
        {(error || scene.hidden) && (
          <div className="playback-error">
            <WifiOff size={28} />
            <p>
              {scene.hidden
                ? "This scene has been removed. Its place in the timeline is preserved."
                : error}
            </p>
            {!scene.hidden && (
              <Button
                kind="secondary"
                disabled={offline}
                onClick={retryPlayback}
              >
                Retry playback
              </Button>
            )}
          </div>
        )}
        {offline && (
          <span className="connection-indicator" role="status">
            You’re offline. Reconnect to load more video.
          </span>
        )}
        {loading && !error && !scene.hidden && !offline && (
          <span className="buffering-indicator" role="status">
            Buffering…
          </span>
        )}
        <div className="video-bottom">
          <div className="video-caption">
            <span>SCENE {String(index + 1).padStart(2, "0")}</span>
            <h3>{scene.title}</h3>
          </div>
          <div className="video-controls">
            <button
              className="icon-button"
              aria-label={playing ? "Pause" : "Play"}
              disabled={scene.hidden}
              onClick={toggle}
            >
              {playing ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              aria-label="Previous scene"
              disabled={index === 0}
              onClick={() => seek(scenes[index - 1].startMs)}
            >
              <SkipBack size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Next scene"
              disabled={index === scenes.length - 1}
              onClick={() => seek(scenes[index + 1].startMs)}
            >
              <SkipForward size={16} />
            </button>
            <span className="player-time">
              {formatTime(time)} <span>/ {formatTime(episode.durationMs)}</span>
            </span>
            <span className="control-spacer" />
            <button
              className="icon-button"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <button
              className={`icon-button ${captions ? "control-active" : ""}`}
              aria-label="Toggle English captions"
              aria-pressed={captions}
              onClick={() => setCaptions(!captions)}
            >
              <Captions size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="Fullscreen"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else
                  void frame.current
                    ?.requestFullscreen()
                    .catch(() =>
                      setError("Fullscreen is unavailable in this browser."),
                    );
              }}
            >
              <Maximize size={17} />
            </button>
          </div>
        </div>
      </div>
      <div
        className="timeline-area"
        onMouseLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setHover(null);
        }}
      >
        <label className="sr-only" htmlFor={`seek-${episode.id}`}>
          Playback position
        </label>
        <input
          className="seek-range"
          id={`seek-${episode.id}`}
          type="range"
          min={0}
          max={episode.durationMs}
          step={100}
          value={Math.min(time, episode.durationMs)}
          onChange={(e) => seek(Number(e.target.value))}
          style={
            {
              "--position": `${(time / Math.max(1, episode.durationMs)) * 100}%`,
            } as React.CSSProperties
          }
        />
        <div className="authorship-timeline">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              className={`timeline-segment ${i === index ? "current" : ""}`}
              style={{ flex: s.durationMs }}
              aria-label={`Scene ${i + 1}: ${s.title}, by ${s.author}`}
              onMouseEnter={() => {
                setHover(s.id);
                setOriginal(false);
              }}
              onFocus={() => setHover(s.id)}
              onBlur={(e) => {
                if (
                  !e.relatedTarget ||
                  !e.currentTarget.parentElement?.parentElement?.contains(
                    e.relatedTarget as Node,
                  )
                )
                  setHover(null);
              }}
              onClick={() => {
                setHover(s.id);
                seek(s.startMs);
              }}
            >
              <span className="segment-fill" />
              <span className="segment-author">
                <AvatarTiny name={s.author} />
                {i === index ? s.author : <span className="segment-dot" />}
              </span>
            </button>
          ))}
        </div>
        {pointed && (
          <div
            className="prompt-popover"
            onMouseEnter={() => setHover(pointed.id)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="prompt-meta">
              <span>THE IDEA BEHIND THIS SCENE</span>
              <span>
                {formatTime(pointed.startMs)}–
                {formatTime(pointed.startMs + pointed.durationMs)}
              </span>
            </div>
            <Author id={pointed.authorId} name={pointed.author} compact />
            <p>“{original ? pointed.prompt : pointed.englishPrompt}”</p>
            <div className="prompt-foot">
              <span>
                {pointed.source === "studio"
                  ? "Studio opening"
                  : "Community idea · adapted for continuity"}
              </span>
              {pointed.prompt !== pointed.englishPrompt && (
                <button
                  className="text-button"
                  onClick={() => setOriginal(!original)}
                >
                  {original ? "English translation" : "Original prompt"}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="timeline-legend">
          <span>Every scene begins with someone’s idea.</span>
          <span>
            Hover or tap to meet its author <span>↗</span>
          </span>
        </div>
      </div>
      <div className="current-credit">
        <Author
          id={scene.authorId}
          name={scene.author}
          label={
            scene.source === "studio"
              ? "OPENING IMAGINED BY"
              : "THIS SCENE IMAGINED BY"
          }
        />
        <span className="credit-note">
          Their idea. Part of this world forever.
        </span>
      </div>
    </div>
  );
}
function AvatarTiny({ name }: { name: string }) {
  return <span className="tiny-avatar">{name[0] ?? "A"}</span>;
}
