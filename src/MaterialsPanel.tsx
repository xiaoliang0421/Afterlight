import { useState } from "react";
import { api, useResource } from "./api";
import { Avatar, Button, Empty, Loading, Modal, Notice } from "./components";
interface Material {
  id: string;
  taskId?: string;
  storyId: string;
  storyTitle: string;
  name: string;
  description: string;
  referenceImage?: string;
  voiceReference?: string;
  voiceDurationMs?: number;
  materialVersion?: number;
}
export function MaterialsPanel() {
  const resource = useResource<{
    characters: Material[];
    candidates: Material[];
  }>("/admin/materials");
  const [editing, setEditing] = useState<Material | null>(null);
  if (resource.loading) return <Loading />;
  if (!resource.data) return <Notice danger>{resource.error}</Notice>;
  const { characters, candidates } = resource.data;
  return (
    <section>
      <p className="muted">
        Stable identities, approved reference images and optional 2–5 second
        voice samples. New characters become canon only after their first scene
        is approved.
      </p>
      {[
        ["Established characters", characters],
        ["Proposed new characters", candidates],
      ].map(([label, items]) => (
        <div key={label as string}>
          <h2>{label as string}</h2>
          <div className="character-grid">
            {(items as Material[]).map((ch) => (
              <article
                className="character-card"
                key={`${ch.taskId ?? ch.storyId}:${ch.id}`}
              >
                <Avatar name={ch.name} size={40} />
                <p className="eyebrow">{ch.storyTitle}</p>
                <h3>{ch.name}</h3>
                <p>{ch.description}</p>
                <p className="fine-print">
                  {ch.referenceImage ? "Image approved" : "Image needed"}
                  {ch.voiceReference ? " · Voice approved" : ""}
                  {ch.materialVersion ? ` · Version ${ch.materialVersion}` : ""}
                </p>
                <Button kind="secondary" onClick={() => setEditing(ch)}>
                  Review materials
                </Button>
              </article>
            ))}
          </div>
          {!(items as Material[]).length && (
            <p className="muted">No candidates awaiting material review.</p>
          )}
        </div>
      ))}
      {editing && (
        <MaterialModal
          material={editing}
          close={() => setEditing(null)}
          done={async () => {
            setEditing(null);
            await resource.reload();
          }}
        />
      )}
    </section>
  );
}
function MaterialModal({
  material,
  close,
  done,
}: {
  material: Material;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [image, setImage] = useState(material.referenceImage ?? ""),
    [voice, setVoice] = useState(material.voiceReference ?? ""),
    [seconds, setSeconds] = useState((material.voiceDurationMs ?? 3000) / 1000),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={material.name} eyebrow={material.storyTitle} onClose={close}>
      <p>{material.description}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(
              material.taskId
                ? `/admin/tasks/${material.taskId}/materials/${encodeURIComponent(material.id)}`
                : `/admin/stories/${material.storyId}/characters/${encodeURIComponent(material.id)}`,
              material.taskId ? "PUT" : "PATCH",
              {
                referenceImage: image,
                ...(voice
                  ? {
                      voiceReference: voice,
                      voiceDurationMs: Math.round(seconds * 1000),
                    }
                  : {}),
              },
            );
            await done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          Approved image URL
          <input
            type="url"
            required
            value={image}
            onChange={(e) => {
              setImage(e.target.value);
              setApproved(false);
            }}
            placeholder="https://…"
          />
        </label>
        <label className="field-label">
          Voice reference URL · optional
          <input
            type="url"
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              setApproved(false);
            }}
            placeholder="https://…"
          />
        </label>
        {voice && (
          <label className="field-label">
            Verified audio duration · seconds
            <input
              type="number"
              min={2}
              max={5}
              step={0.1}
              required
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
          </label>
        )}
        <p className="fine-print">
          Use stable URLs for materials you own or have permission to use. They
          are sent to the video provider when a scene starts.
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            required
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          <span>
            I have inspected these materials, checked usage rights and confirmed
            this character’s identity.
          </span>
        </label>
        {error && <Notice danger>{error}</Notice>}
        <Button type="submit" disabled={!approved} busy={busy}>
          Approve materials
        </Button>
      </form>
    </Modal>
  );
}
