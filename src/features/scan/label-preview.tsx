/**
 * Draws the replica label on screen from the same ZPL the printer is sent.
 *
 * The preview leaves the print position offsets alone and draws the label as
 * the format lays it out. Those offsets move the whole image on the stock to
 * line it up with the media, which is a thing to judge on a printed label
 * rather than on a screen.
 *
 * The renderer is zebrash, which runs inside the page, so label data never
 * leaves the machine. It reads its stand-ins for the printer's built-in fonts
 * from `public/fonts/`, so the preview also works on a machine with no
 * internet connection. A label set in a bundled font carries that font inside
 * its own ZPL, and zebrash draws it from those bytes, so the preview and the
 * print agree.
 */

import { useEffect, useMemo, useState } from "react";
import { Drawer, Parser, setFontBaseUrl } from "@zebrash/browser";
import type { LabelFont } from "@/lib/label/fonts";
import {
  buildReplicaZpl,
  dotsPerMillimetre,
  replicaLabelGeometry,
  type LabelStock,
} from "@/lib/label/replica-zpl";

/** Inches to millimetres, for the sheet size the renderer is asked to draw. */
const MM_PER_INCH = 25.4;

// zebrash fetches its four bundled fonts from a CDN unless it is told
// otherwise. The same files sit in `public/fonts/`, so point it there.
setFontBaseUrl("/fonts/");

/** The ZPL for one label and how wide its barcode prints, or why neither exists. */
type Plan = { ok: true; zpl: string; symbolWidthMm: number } | { ok: false; reason: string };

/** Turns one label's ZPL into an object URL for a PNG the size of the stock. */
async function renderZpl(zpl: string, stock: LabelStock): Promise<string> {
  const label = new Parser().parse(zpl)[0];
  if (label === undefined) {
    throw new Error("zebrash parsed no label out of the replica ZPL");
  }
  const png = await new Drawer().drawLabelAsPng(label, {
    labelWidthMm: stock.widthInches * MM_PER_INCH,
    labelHeightMm: stock.heightInches * MM_PER_INCH,
    dpmm: dotsPerMillimetre(stock.dotsPerInch),
  });
  // zebrash returns bytes that may sit in shared memory, which Blob will not
  // take. Copying them into a plain array gives Blob what it wants.
  return URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
}

export function LabelPreview({
  din,
  labelFont,
  stock,
}: {
  din: string;
  labelFont: LabelFont;
  /** The stock in the printer. The preview is drawn at its size and shape. */
  stock: LabelStock;
}) {
  // Drawing a label is not cheap, and a caller that builds its stock object
  // fresh on every render would redraw the preview on every render. Holding
  // the three numbers instead of the object means the work happens when one of
  // them changes and at no other time.
  const { widthInches, heightInches, dotsPerInch } = stock;
  const media = useMemo<LabelStock>(
    () => ({ widthInches, heightInches, dotsPerInch }),
    [widthInches, heightInches, dotsPerInch],
  );

  // The preview shows one label whatever the copy count is, so it is built
  // again only when the DIN, the font, or the stock changes. Both calls refuse
  // a DIN whose barcode will not fit the label stock, and that refusal belongs
  // on screen rather than in a crashed render.
  const plan = useMemo<Plan>(() => {
    try {
      return {
        ok: true,
        zpl: buildReplicaZpl({ din, copies: 1, labelFont, stock: media }),
        symbolWidthMm: replicaLabelGeometry(din, undefined, media).symbolWidthMm,
      };
    } catch (reason) {
      return { ok: false, reason: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [din, labelFont, media]);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan.ok) {
      return;
    }

    let url: string | null = null;
    let cancelled = false;

    renderZpl(plan.zpl, media).then(
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
  }, [plan, media]);

  const failure = plan.ok ? error : plan.reason;

  return (
    <figure className="flex w-full max-w-60 flex-col gap-2 @4xl:max-w-[19rem]">
      {/* The frame carries the loaded stock's own proportion, so what is on
          screen is the shape that comes off the roll. Change the stock in
          settings and the frame changes with it. */}
      <div
        style={{ aspectRatio: `${widthInches} / ${heightInches}` }}
        className="flex w-full items-center justify-center overflow-hidden rounded-md border bg-white p-2"
      >
        {failure !== null ? (
          <p className="px-2 text-center text-xs text-destructive">
            The preview could not be drawn. {failure}
          </p>
        ) : imageUrl === null ? (
          <p className="text-xs text-neutral-500">Drawing the label</p>
        ) : (
          <img
            src={imageUrl}
            alt={`Replica label for ${din}`}
            className="max-h-full max-w-full animate-in fade-in duration-200"
          />
        )}
      </div>
      {plan.ok && (
        <p className="text-xs text-muted-foreground tabular-nums">
          The barcode prints {plan.symbolWidthMm.toFixed(1)} mm wide.
        </p>
      )}
    </figure>
  );
}
