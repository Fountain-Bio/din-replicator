/**
 * A settings number box that lets a number be typed before it judges it.
 *
 * A box that clamped on every key press would fight the operator: typing 0.75
 * into a field whose smallest value is 0.5 turns the first 0 into 0.5, and
 * typing a minus sign into an offset field turns it into -100. So the box
 * keeps what was typed as text, hands a value up as soon as the text reads as
 * a number inside the range, and clamps only when the box loses focus.
 *
 * The Rust side is the authority on what a setting may be. This only saves the
 * operator a rejected save.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clampDecimal } from "@/lib/settings";

export interface NumberFieldProps {
  /** The element id, used by the label and by the tests that drive the field. */
  id: string;
  label: string;
  /** The one line under the box that says what the number does. */
  hint: string;
  value: number;
  min: number;
  max: number;
  /** How far one press of the box's own stepper moves the value. */
  step?: number;
  /** Places after the decimal point a committed value is rounded to. */
  decimals?: number;
  onCommit: (value: number) => void;
}

export function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  onCommit,
}: NumberFieldProps) {
  // Null while the box shows the saved value. A string while it shows what is
  // being typed, which can be halfway to a number.
  const [draft, setDraft] = useState<string | null>(null);

  function type(text: string) {
    setDraft(text);
    const asked = Number(text);
    // Hand the value up while it is already a number in range, so the label
    // preview and everything else follow along as the operator types.
    if (text.trim().length > 0 && Number.isFinite(asked) && asked >= min && asked <= max) {
      onCommit(clampDecimal(asked, min, max, decimals));
    }
  }

  function settle() {
    const text = draft;
    setDraft(null);
    if (text === null) {
      return;
    }
    const asked = Number(text);
    if (text.trim().length === 0 || !Number.isFinite(asked)) {
      return;
    }
    onCommit(clampDecimal(asked, min, max, decimals));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(value)}
        className="h-10 w-28 text-base tabular-nums"
        onChange={(event) => type(event.currentTarget.value)}
        onBlur={settle}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
