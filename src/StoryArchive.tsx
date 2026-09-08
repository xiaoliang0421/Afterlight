import { t as tr } from "./i18n";
import { useState } from "react";
import { BookOpen, ArrowUpRight } from "lucide-react";
import type { Archive, ArchiveContext } from "../shared/archive";
import type { Scene, Story } from "../shared/domain";
import { useResource } from "./api";
import { Avatar, Button, Loading, Modal, Notice } from "./components";

interface ArchiveView {
  throughVersion: number;
  characters: ArchiveContext["characters"];
  notes: Archive["characters"];
  history: {
    characterId: string;
    version: number;
    state: string;
    sceneId: string | null;
  }[];
  archive: { version: number; content: Archive } | null;
}
export function StoryArchive({
  story,
  scenes,
  version,
  jump,
}: {
  story: Story;
  scenes: Scene[];
  version: number;
  jump: (scene: Scene) => void;
}) {
  const resource = useResource<ArchiveView>(
    `/stories/${story.id}/archive?through=${Math.min(version, story.version)}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  if (resource.loading) return <Loading />;
  if (!resource.data)
    return (
      <>
        <Notice>{tr(resource.error)}</Notice>
        <Button kind="secondary" onClick={() => void resource.reload()}>
          {tr("Reload story guide")}
        </Button>
      </>
    );
  const d = resource.data,
    character = d.characters.find((c) => c.id === selected),
    note = d.notes.find((c) => c.id === selected);
  const sources = (ids: string[]) => (
    <div className="archive-sources">
      {ids.map((id) => {
        const s = scenes.find((s) => s.id === id && !s.hidden);
        return s ? (
          <button
            className="text-button"
            key={id}
            onClick={() => {
              setSelected(null);
              jump(s);
            }}
          >
            {s.title}
            <ArrowUpRight size={12} />
          </button>
        ) : null;
      })}
    </div>
  );
  return (
    <div className="world-details">
      <p className="eyebrow">{tr("THE WORLD’S COMPASS")}</p>
      <p>{story.worldRules}</p>
      <div className="archive-heading">
        <BookOpen size={17} />
        <span>
          {tr("Story guide · through scene")} {d.throughVersion}
        </span>
      </div>
      {d.archive ? (
        <section className="archive-recap">
          <p className="eyebrow">
            {tr("THE STORY SO FAR · SCENE")} {d.archive.version}
          </p>
          <p>{d.archive.content.recap.text}</p>
          {sources(d.archive.content.recap.sceneIds)}
          {!!d.archive.content.openThreads.length && (
            <>
              <h3>{tr("Still unanswered")}</h3>
              {d.archive.content.openThreads.map((t, i) => (
                <div key={i}>
                  <p>{t.text}</p>
                  {sources(t.sceneIds)}
                </div>
              ))}
            </>
          )}
        </section>
      ) : (
        <p className="fine-print">
          {tr(
            "A reviewed recap will appear here as the story grows. Character records follow the published scenes.",
          )}
        </p>
      )}
      <div className="character-grid">
        {d.characters.map((ch) => {
          const n = d.notes.find((n) => n.id === ch.id);
          return (
            <article className="character-card" key={ch.id}>
              <Avatar name={ch.name} size={42} />
              <h3>{ch.name}</h3>
              <p>{n?.introduction ?? ch.description}</p>
              {ch.state && <small>{ch.state}</small>}
              <button
                className="text-button character-more"
                onClick={() => setSelected(ch.id)}
              >
                {tr("Meet")} {ch.name.split(" ")[0]}
                <ArrowUpRight size={13} />
              </button>
            </article>
          );
        })}
      </div>
      <p className="fine-print">
        {tr(
          "New characters appear after their first published scene. This guide follows your playback position and stays within this story.",
        )}
      </p>
      {character && (
        <Modal
          title={character.name}
          eyebrow={tr("A LIFE INSIDE THE STORY")}
          onClose={() => setSelected(null)}
        >
          <p className="modal-copy">
            {note?.introduction ?? character.description}
          </p>
          {note && (
            <>
              <h3>{tr("How they have changed")}</h3>
              <p>{note.development}</p>
              {sources(note.sceneIds)}
              {note.relationships.map((r, i) => (
                <div className="archive-relationship" key={i}>
                  <strong>
                    {d.characters.find((c) => c.id === r.characterId)?.name}
                  </strong>
                  <p>{r.description}</p>
                  {sources(r.sceneIds)}
                </div>
              ))}
            </>
          )}
          <h3>{tr("Through the scenes")}</h3>
          <div className="character-history">
            {d.history
              .filter((h) => h.characterId === character.id)
              .filter(
                (h, i, arr) =>
                  i === arr.length - 1 || h.state !== arr[i + 1].state,
              )
              .map((h) => (
                <div key={h.version}>
                  <span className="eyebrow">
                    {tr("SCENE")} {h.version}
                  </span>
                  <p>{h.state}</p>
                  {h.sceneId && sources([h.sceneId])}
                </div>
              ))}
          </div>
          <p className="fine-print">
            {tr(
              "Recent recorded states, up to your current scene. Earlier states are shown only when a historical record exists.",
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}
