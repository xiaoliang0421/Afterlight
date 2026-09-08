import { t as tr } from "./i18n";
import { useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import type { Scene, Story } from "../shared/domain";
import { brand } from "../shared/brand";
import { Author, Button, Modal, Notice } from "./components";

export function ShareModal({
  story,
  scene,
  close,
}: {
  story: Story;
  scene?: Scene;
  close: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const url = new URL(`/story/${story.slug}`, location.origin);
  if (scene) url.searchParams.set("scene", scene.id);
  const title = scene ? `${scene.title} · ${story.title}` : story.title;
  const text = scene
    ? `A scene imagined by ${scene.author}. Watch it on ${brand.name}.`
    : story.logline;
  return (
    <Modal
      title={tr("Pass the story on.")}
      eyebrow={tr("A STORY WORTH SHARING")}
      onClose={close}
    >
      <div className="share-preview">
        <img src={story.coverUrl} alt="" />
        <div>
          <p className="eyebrow">{story.title}</p>
          <h3>{scene?.title ?? tr("Start from the beginning")}</h3>
          {scene && <Author id={scene.authorId} name={scene.author} compact />}
        </div>
      </div>
      <p className="modal-copy">
        {scene
          ? tr(
              "Your friend will open this scene, with its creator’s credit and prompt. They can keep watching or start the story from the beginning.",
            )
          : tr("Your friend can watch this story without signing in.")}
      </p>
      <label className="field-label" htmlFor="share-url">
        {scene ? tr("Link to this scene") : tr("Link to this story")}
      </label>
      <input
        ref={input}
        id="share-url"
        readOnly
        value={url.href}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="share-actions">
        <Button
          kind="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url.href);
              setCopied(true);
              setError("");
            } catch {
              input.current?.focus();
              input.current?.select();
              setError(
                "Select and copy the link above. Your browser does not allow automatic copying.",
              );
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? tr("Copied") : tr("Copy link")}
        </Button>
        {typeof navigator.share === "function" && (
          <Button
            onClick={async () => {
              try {
                await navigator.share({ title, text, url: url.href });
                setError("");
              } catch (e) {
                if ((e as Error).name !== "AbortError")
                  setError(
                    "Sharing is unavailable here. You can copy the link instead.",
                  );
              }
            }}
          >
            <Share2 size={16} />
            {tr("Share with…")}
          </Button>
        )}
      </div>
      {error && <Notice>{tr(error)}</Notice>}
      {story.fixture && (
        <p className="fine-print">
          {tr(
            "Development fixture. This link currently works only where this preview server is reachable.",
          )}
        </p>
      )}
    </Modal>
  );
}
