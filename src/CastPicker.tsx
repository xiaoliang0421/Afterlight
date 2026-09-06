import { useState } from "react";
import { Check, Users } from "lucide-react";
import type { Character } from "../shared/domain";
import { Avatar } from "./components";

export function CharacterPortrait({
  character,
  size = 34,
}: {
  character: Pick<Character, "name" | "referenceImage">;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  return character.referenceImage && !failed ? (
    <img
      className="character-portrait"
      src={character.referenceImage}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <Avatar name={character.name} size={size} />
  );
}

export function CastPicker({
  characters,
  selected,
  onChange,
  disabled,
}: {
  characters: Character[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  return (
    <details className="cast-picker">
      <summary>
        <Users size={16} />
        <span>
          Choose characters<small>Optional · latest story cast</small>
        </span>
        <span className="cast-count">{selected.length}/3</span>
      </summary>
      <p className="fine-print">
        Leave this empty to let the story editor choose. Selected characters
        keep their identities; their actions still need to fit the latest scene.
      </p>
      {characters.length > 6 && (
        <input
          className="cast-search"
          aria-label="Find a character"
          placeholder="Find a character…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <div className="cast-options">
        {characters
          .filter((ch) =>
            ch.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
          .map((ch) => {
            const chosen = selected.includes(ch.id);
            return (
              <button
                type="button"
                key={ch.id}
                className={`cast-option ${chosen ? "chosen" : ""}`}
                aria-pressed={chosen}
                disabled={disabled || (!chosen && selected.length >= 3)}
                title={ch.description}
                onClick={() =>
                  onChange(
                    chosen
                      ? selected.filter((id) => id !== ch.id)
                      : [...selected, ch.id],
                  )
                }
              >
                <CharacterPortrait key={ch.referenceImage} character={ch} />
                <span>
                  <strong>{ch.name}</strong>
                  <small>{ch.description}</small>
                </span>
                {chosen && <Check size={15} />}
              </button>
            );
          })}
      </div>
      {!characters.length && (
        <p className="fine-print">This world’s cast is still being prepared.</p>
      )}
      {search &&
        !characters.some((ch) =>
          ch.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        ) && <p className="fine-print">No character matches that name.</p>}
      <p className="fine-print">
        Someone new? Describe their look and role in your idea. The editor
        checks their introduction; they join the cast after a reviewed scene is
        published.
      </p>
    </details>
  );
}
