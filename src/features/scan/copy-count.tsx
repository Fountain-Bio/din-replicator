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
      <Label htmlFor="copy-count" className="text-sm font-normal text-muted-foreground">
        Copy count
      </Label>
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
        <span className="text-sm text-muted-foreground">
          {value === 1 ? "replica" : "replicas"}, up to {max}
        </span>
      </div>
    </div>
  );
}
