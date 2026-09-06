import { Image, Type } from "lucide-react";
import type { GenerationMode } from "../shared/billing";

export function GenerationChoice({
  value,
  onChange,
  referenceEnabled,
  points,
  disabled = false,
}: {
  value: GenerationMode;
  onChange: (mode: GenerationMode) => void;
  referenceEnabled: boolean;
  points: number;
  disabled?: boolean;
}) {
  return (
    <fieldset className="generation-choice" disabled={disabled}>
      <legend>How should we make your scene?</legend>
      <label
        className={
          value === "text" ? "generation-option selected" : "generation-option"
        }
      >
        <input
          type="radio"
          name="generation-mode"
          value="text"
          checked={value === "text"}
          onChange={() => onChange("text")}
        />
        <span className="generation-option-title">
          <Type size={16} /> Text to video <b>FREE</b>
        </span>
        <span>
          Made from your idea and the story’s character descriptions. Faces and
          details may vary between scenes.
        </span>
      </label>
      <label
        className={
          value === "reference"
            ? "generation-option selected"
            : "generation-option"
        }
      >
        <input
          type="radio"
          name="generation-mode"
          value="reference"
          checked={value === "reference"}
          disabled={!referenceEnabled}
          onChange={() => onChange("reference")}
        />
        <span className="generation-option-title">
          <Image size={16} /> Reference guided{" "}
          <b>{referenceEnabled ? `${points} POINTS` : "COMING LATER"}</b>
        </span>
        <span>
          Uses approved character images and available scene references for
          stronger visual continuity. An exact match is not guaranteed.
        </span>
      </label>
      <p>
        Both follow the same story, English-language rules and queue. Paid
        scenes do not jump ahead.
      </p>
    </fieldset>
  );
}
