/**
 * A box that scrolls its own contents and says so when there is more below.
 *
 * A pane that quietly cuts off is the worst kind of overflow: nothing on the
 * screen says the fields continue. This keeps the scrollbar drawn and fades
 * the last few pixels of content while anything is still out of view, so the
 * cut edge reads as "there is more" rather than as the end.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";

export interface ScrollPaneProps {
  className?: string;
  children: React.ReactNode;
}

export function ScrollPane({ className, children }: ScrollPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null) {
      return;
    }

    // A one pixel allowance, because a scroll position can land on a fraction
    // of a pixel and would otherwise report more content forever.
    const update = () => setMore(pane.scrollTop + pane.clientHeight < pane.scrollHeight - 1);

    update();
    pane.addEventListener("scroll", update, { passive: true });
    // The pane's own size and its content's size both change what is out of
    // view: the window resizes, and a different section replaces the fields.
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    const content = pane.firstElementChild;
    if (content !== null) {
      observer.observe(content);
    }

    return () => {
      pane.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={paneRef} className={cn("scroll-pane h-full overflow-y-auto", className)}>
        {children}
      </div>
      <div
        aria-hidden
        data-more={more}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-background to-transparent opacity-0 transition-opacity duration-150 data-[more=true]:opacity-100"
      />
    </div>
  );
}
