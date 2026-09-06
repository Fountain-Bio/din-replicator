/**
 * Draws the replica label on screen from the same ZPL the printer is sent.
 *
 * The renderer is zebrash, which runs inside the page, so label data never
 * leaves the machine. It reads its fonts from `public/fonts/`, so the preview
 * also works on a machine with no internet connection.
 */

import { useEffect, useMemo, useState } from "react";
import { Drawer, Parser, setFontBaseUrl } from "@zebrash/browser";
import {
  buildReplicaZpl,
  DOTS_PER_MM,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  replicaLabelGeometry,
} from "@/lib/label/replica-zpl";

// zebrash fetches its four bundled fonts from a CDN unless it is told
// otherwise. The same files sit in `public/fonts/`, so point it there.
setFontBaseUrl("/fonts/");

/** The ZPL for one label and how wide its barcode prints, or why neither exists. */
type Plan = { ok: true; zpl: string; symbolWidthMm: number } | { ok: false; reason: string };

/** Turns one label's ZPL into an object URL for a PNG. */
async function renderZpl(zpl: string): Promise<string> {
  const label = new Parser().parse(zpl)[0];
  if (label === undefined) {
    throw new Error("zebrash parsed no label out of the replica ZPL");
  }
  const png = await new Drawer().drawLabelAsPng(label, {
    labelWidthMm: LABEL_WIDTH_MM,
    labelHeightMm: LABEL_HEIGHT_MM,
    dpmm: DOTS_PER_MM,
  });
  // zebrash returns bytes that may sit in shared memory, which Blob will not
  // take. Copying them into a plain array gives Blob what it wants.
  return URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
}

export function LabelPreview({ din }: { din: string }) {
  // The preview shows one label whatever the copy count is, so it is built
  // again only when the DIN changes. Both calls refuse a DIN whose barcode
  // will not fit the label stock, and that refusal belongs on screen rather
  // than in a crashed render.
  const plan = useMemo<Plan>(() => {
    try {
      return {
        ok: true,
        zpl: buildReplicaZpl({ din, copies: 1 }),
        symbolWidthMm: replicaLabelGeometry(din).symbolWidthMm,
      };
    } catch (reason) {
      return { ok: false, reason: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [din]);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan.ok) {
      return;
    }

    let url: string | null = null;
    let cancelled = false;

    renderZpl(plan.zpl).then(
      (rendered) => {
        if (cancelled) {
          URL.revokeObjectURL(rendered);
          return;
        }
        url = rendered;
        setError(null);
        setImageUrl(rendered);
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(String(reason));
        }
      },
    );

    return () => {
      cancelled = true;
      setImageUrl(null);
      if (url !== null) {
        URL.revokeObjectURL(url);
      }
    };
  }, [plan]);

  const failure = plan.ok ? error : plan.reason;

  return (
    <div className="flex w-[300px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">The replica as it will print</p>
      <div className="flex h-[130px] items-center justify-center rounded-md border-2 border-dashed bg-white">
        {failure !== null ? (
          <p className="px-3 text-center text-xs text-destructive">
            The preview could not be drawn. {failure}
          </p>
        ) : imageUrl === null ? (
          <p className="text-xs text-muted-foreground">Drawing the label</p>
        ) : (
          <img src={imageUrl} alt={`Replica label for ${din}`} className="max-h-full max-w-full" />
        )}
      </div>
      {plan.ok && (
        <p className="text-xs text-muted-foreground">
          On the printer the barcode is {plan.symbolWidthMm.toFixed(1)} mm wide.
        </p>
      )}
    </div>
  );
}
