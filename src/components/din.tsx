/**
 * A DIN as a person reads it, in the shape the printed label uses.
 *
 * Every screen that shows a DIN shows its parts this way, so an operator
 * comparing what is on the screen with what is in their hand is comparing the
 * same thing: the flag characters beside the number, and the check character
 * inside a box.
 */

import { cn } from "cn";
import { eyeReadable } from "@/lib/isbt128";

/**
 * The check character in its box, the way ST-001 section 7.5 has it printed.
 *
 * The box is not decoration. It is how a label marks the one character that is
 * derived from the other thirteen rather than part of them.
 */
export function CheckCharacterBox({ check, className }: { check: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center border border-foreground font-mono text-sm leading-none font-semibold",
        className,
      )}
    >
      {check}
    </span>
  );
}

/**
 * The line that sits under a DIN: the flag characters and the boxed check
 * character, named so nobody has to remember which is which.
 */
export function DinParts({ din, className }: { din: string; className?: string }) {
  const eye = eyeReadable(din);
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <span>Flag characters</span>
      <span className="font-mono tabular-nums text-foreground">{eye.flags}</span>
      <span className="text-border">/</span>
      <span>check character</span>
      <CheckCharacterBox check={eye.check} />
    </span>
  );
}
