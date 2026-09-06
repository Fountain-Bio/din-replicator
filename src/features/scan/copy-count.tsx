/**
 * The copy count control: how many replicas the next print run produces.
 *
 * The value is clamped by the reducer, so this only has to send what the
 * operator asked for.
 */

import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CopyCountProps {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (copies: number) => void;
}

export function CopyCount({ value, max, disabled, onChange }: CopyCountProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="copy-count" className="text-base">
        Copy count
      </Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
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
          min={1}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className="h-9 w-20 text-center text-lg tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label="One replica more"
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
        >
          <PlusIcon />
        </Button>
        <span className="text-sm text-muted-foreground">of at most {max}</span>
      </div>
    </div>
  );
}
