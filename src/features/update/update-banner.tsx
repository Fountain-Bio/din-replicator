/**
 * The line at the top of the screen that says a newer version is waiting.
 *
 * It is quiet on purpose. An update is never as urgent as the label in the
 * operator's hand, so the banner sits above the screen in the same muted
 * surface the rest of the shell uses, and it leaves as soon as Later is
 * pressed. `showsUpdateBanner` in `update-state.ts` decides when it is on the
 * screen at all.
 */

import { ArrowDownToLineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpdateState } from "./update-state";

export interface UpdateBannerProps {
  state: UpdateState;
  onInstall: () => void;
  onLater: () => void;
}

export function UpdateBanner({ state, onInstall, onLater }: UpdateBannerProps) {
  const version = state.version ?? "";
  const installing = state.status === "downloading" || state.status === "ready";
  const percent = state.progress === null ? null : Math.round(state.progress * 100);

  return (
    <div
      role="status"
      // The banner keeps its height when the buttons give way to the
      // progress bar, so the screen under it does not shift.
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-surface px-4 py-2.5 text-sm"
    >
      <ArrowDownToLineIcon className="size-4 shrink-0 text-muted-foreground" />

      {installing ? (
        <>
          <span>
            {state.status === "ready" ? `Version ${version} is installed. Restarting.` : null}
            {state.status === "downloading" ? `Installing version ${version}.` : null}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {/* The bar fills as the download arrives. A release that comes
                without a size leaves the bar empty, so the percentage beside
                it is left out as well. */}
            <span className="h-1 w-32 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent ?? 0}%` }}
              />
            </span>
            {percent !== null && (
              <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
                {percent}%
              </span>
            )}
          </span>
        </>
      ) : (
        <>
          <span>Version {version} is available.</span>
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" onClick={onInstall}>
              Install and relaunch
            </Button>
            <Button variant="link" size="sm" onClick={onLater}>
              Later
            </Button>
          </span>
        </>
      )}
    </div>
  );
}
