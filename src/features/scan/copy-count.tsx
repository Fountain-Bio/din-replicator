/**
 * The copy count control: how many replicas the next print run produces.
 *
 * The value is clamped by the reducer, so this only has to send what the
 * operator asked for. Nothing here is labelled in words. A stepper with a
 * number in it beside a Print button reads as what it is, and the ceiling sits
 * next to it as a hint.
 */

import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface CopyCountProps {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (copyCount: number) => void;
}

export function CopyCount({ value, max, disabled, onChange }: CopyCountProps) {
  return (
    <div className="flex items-center gap-3">
      {/* One bordered group, so the two steppers and the number read as a
          single control rather than three things that happen to be in a row. */}
      <div className="inline-flex items-center gap-1 rounded-lg border border-input bg-background p-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="One replica fewer"
          disabled={disabled || value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <MinusIcon />
        </Button>
        <Input
          id="copy-count"
          type="number"
          inputMode="numeric"
          aria-label="Copy count"
          title={`Copy count, up to ${max} replicas`}
          min={1}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className="h-9 w-14 rounded-md border-0 px-0 text-center text-lg font-semibold tabular-nums focus-visible:ring-0 disabled:bg-transparent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="One replica more"
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
        >
          <PlusIcon />
        </Button>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">max {max}</span>
    </div>
  );
}
