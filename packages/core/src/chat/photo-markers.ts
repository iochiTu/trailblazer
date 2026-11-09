/**
 * The assistant shows a business photo by writing `[[photo:p1]]` (ids come from <photos> in the
 * prompt). This filter removes the markers from the streamed text, even when a marker is split
 * across chunks, and reports the ids it found. Text that only looks like the start of a marker is
 * held back until it can be decided.
 */
const MARKER = /\[\[photo:([A-Za-z0-9]{1,16})\]\][ \t]*\n?/g;
const PREFIX = "[[photo:";

/** True when `tail` could still grow into a complete marker. */
function couldBeMarker(tail: string): boolean {
  if (tail.length <= PREFIX.length) return PREFIX.startsWith(tail);
  if (!tail.startsWith(PREFIX)) return false;
  return /^[A-Za-z0-9]{0,16}\]?$/.test(tail.slice(PREFIX.length));
}

export class PhotoMarkerFilter {
  private buffer = "";

  /** Adds streamed text; returns the text safe to show now and any photo ids completed. */
  push(chunk: string): { text: string; ids: string[] } {
    this.buffer += chunk;
    const ids: string[] = [];
    let text = this.buffer.replace(MARKER, (_, id: string) => {
      ids.push(id);
      return "";
    });
    // Hold back a trailing partial marker.
    const start = text.lastIndexOf("[");
    let held = "";
    for (let i = Math.max(0, start - 1); i >= 0 && i <= start; i++) {
      if (text[i] === "[" && couldBeMarker(text.slice(i))) {
        held = text.slice(i);
        text = text.slice(0, i);
        break;
      }
    }
    this.buffer = held;
    return { text, ids };
  }

  /** End of the stream: whatever is held back was not a marker. */
  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest;
  }
}
