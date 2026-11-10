"use client";

import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/** How far one arrow click scrolls, as a share of the visible width. */
const PAGE = 0.7;
/** Pointer movement (px) before a press on the tab list becomes a drag instead of a click. */
const DRAG_THRESHOLD = 6;

/**
 * A row of tabs that scrolls sideways when it doesn't fit (the assistant page has ten tabs):
 *
 *   - arrow buttons and faded edges show there are more tabs, on the side(s) where there are;
 *   - a mouse wheel or trackpad scrolls the row (vertical wheel turns into sideways scrolling, and
 *     the page scrolls again once the row reaches its end);
 *   - the row can be dragged with the mouse; touch screens scroll it natively;
 *   - the selected tab is scrolled into view when it changes;
 *   - arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern, automatic activation).
 *
 * Children are the `role="tab"` buttons; `selectedKey` is any value that changes with the
 * selection (used to bring the selected tab into view).
 */
export function ScrollTabs({
  children,
  selectedKey,
  label,
  className = "",
}: {
  children: ReactNode;
  selectedKey?: string;
  label?: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const drag = useRef<{ x: number; scroll: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const firstReveal = useRef(true);

  /** Which sides have hidden tabs (logical: works in right-to-left layouts too). */
  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const max = el.scrollWidth - el.clientWidth;
    // In RTL, scrollLeft runs from 0 to -max.
    const pos = rtl ? -el.scrollLeft : el.scrollLeft;
    const next = { start: pos > 1, end: pos < max - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    el.addEventListener("scroll", measure, { passive: true });

    // A vertical wheel scrolls the row sideways while it can move that way; at either end the
    // page scrolls as usual. Needs a non-passive listener to stop the page from scrolling too.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // trackpad sideways swipe: native
      const rtl = getComputedStyle(el).direction === "rtl";
      const max = el.scrollWidth - el.clientWidth;
      const pos = rtl ? -el.scrollLeft : el.scrollLeft;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if ((delta < 0 && pos <= 0) || (delta > 0 && pos >= max - 1)) return;
      event.preventDefault();
      el.scrollLeft += rtl ? -delta : delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure]);

  // Bring the selected tab into view (also on first render, e.g. ?tab=requests from an email).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the selection changes
  useEffect(() => {
    // Instant on first render (a smooth scroll started while the page is still loading can be
    // dropped by the browser), smooth after; one frame later so the layout has settled.
    const behavior: ScrollBehavior = firstReveal.current ? "auto" : "smooth";
    firstReveal.current = false;
    const frame = requestAnimationFrame(() => {
      const el = listRef.current;
      const selected = el?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!el || !selected) return;
      const list = el.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      const margin = 48; // keep it clear of the faded edge and the arrow
      if (tab.left < list.left + margin) el.scrollBy({ left: tab.left - list.left - margin, behavior });
      else if (tab.right > list.right - margin) {
        el.scrollBy({ left: tab.right - list.right + margin, behavior });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedKey]);

  function page(direction: "start" | "end") {
    const el = listRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const sign = (direction === "end" ? 1 : -1) * (rtl ? -1 : 1);
    el.scrollBy({ left: sign * el.clientWidth * PAGE, behavior: "smooth" });
  }

  /** Arrow keys, Home and End move focus and select (each tab is a button that selects on click). */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === (rtl ? "ArrowLeft" : "ArrowRight")
            ? (current + 1) % tabs.length
            : event.key === (rtl ? "ArrowRight" : "ArrowLeft")
              ? (current - 1 + tabs.length) % tabs.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    tabs[next]!.focus();
    tabs[next]!.click();
  }

  // Mouse drag to scroll. Touch and pen scroll natively, so only the mouse is handled here.
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const el = listRef.current;
    if (event.pointerType !== "mouse" || event.button !== 0 || !el || el.scrollWidth <= el.clientWidth)
      return;
    drag.current = { x: event.clientX, scroll: el.scrollLeft, moved: false, id: event.pointerId };
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const el = listRef.current;
    const d = drag.current;
    if (!el || !d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture(event.pointerId);
      el.dataset.dragging = "true";
    }
    el.scrollLeft = d.scroll - dx;
  }
  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const el = listRef.current;
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    if (d.moved) {
      // The click that ends a drag shouldn't switch tabs.
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (el) delete el.dataset.dragging;
    }
    drag.current = null;
  }

  return (
    <div className="tabs-scroller" data-start={edges.start} data-end={edges.end}>
      <button
        type="button"
        className="tabs-arrow tabs-arrow-start"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => page("start")}
      >
        ‹
      </button>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        tabIndex={-1}
        className={`tabs ${className}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </div>
      <button
        type="button"
        className="tabs-arrow tabs-arrow-end"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => page("end")}
      >
        ›
      </button>
    </div>
  );
}
