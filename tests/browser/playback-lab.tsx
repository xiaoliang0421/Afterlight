import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "../../src/Player";
import type { Episode, Scene } from "../../shared/domain";
import "../../src/styles.css";

const episode: Episode = {
  id: "local-playback",
  storyId: "local-playback",
  number: 1,
  title: "Synthetic playback chapter",
  status: "complete",
  durationMs: 30000,
};
const scenes: Scene[] = [0, 1, 2].map((i) => ({
  id: `local-${i}`,
  storyId: episode.storyId,
  episodeId: episode.id,
  version: i + 1,
  title: `Playback sample ${i + 1}`,
  summary: "Synthetic acceptance footage",
  mediaUrl: `/__playback-lab/clip.mp4?scene=${i}`,
  captionsUrl: "/__playback-lab/captions.vtt",
  thumbnailUrl: "/art/new-world.svg",
  durationMs: 10000,
  startMs: i * 10000,
  prompt: `Synthetic idea ${i + 1}`,
  englishPrompt: `Synthetic idea ${i + 1}`,
  author: `Test author ${i + 1}`,
  authorId: `local-author-${i}`,
  source: "studio",
  productionSource: "generated",
  contributors: [],
  fixture: true,
  publishedAt: 0,
  hidden: false,
}));

function Lab() {
  const position = useRef(0);
  const [mode, setMode] = useState("normal");
  const [applied, setApplied] = useState("normal");
  const [load, setLoad] = useState({ key: 0, start: 0 });
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    void fetch("/__playback-lab/mode")
      .then((response) => response.json() as Promise<{ mode: string }>)
      .then(({ mode }) => {
        setMode(mode);
        setApplied(mode);
      });
  }, []);
  return (
    <main style={{ maxWidth: 980, margin: "24px auto", padding: "0 16px" }}>
      <h1>Local playback acceptance</h1>
      <p>
        Illustrative samples only. No sign-in, provider calls or publication.
      </p>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}
      >
        <label>
          Media connection{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="slow">Slow: 32 kbit/s</option>
            <option value="stall">Stalled response</option>
            <option value="unavailable">Unavailable: HTTP 503</option>
          </select>
        </label>
        <button
          className="button secondary"
          onClick={async () => {
            const result = await fetch(`/__playback-lab/mode?value=${mode}`, {
              method: "POST",
            });
            if (result.ok) setApplied(mode);
          }}
        >
          Apply condition
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setComplete(false);
            setLoad((old) => ({ key: old.key + 1, start: position.current }));
          }}
        >
          Reload player at saved position
        </button>
      </div>
      <p role="status">
        Applied: {applied}.{" "}
        {complete ? "Chapter completed." : "Playback test in progress."}
      </p>
      <Player
        key={load.key}
        scenes={scenes.map((scene) => ({
          ...scene,
          mediaUrl: `${scene.mediaUrl}&load=${load.key}`,
        }))}
        episode={episode}
        poster="/art/new-world.svg"
        startTime={load.start}
        fixture
        onPosition={(time) => {
          position.current = time;
        }}
        onEnd={() => setComplete(true)}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Lab />);
