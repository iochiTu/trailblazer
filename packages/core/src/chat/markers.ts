/**
 * Markers the assistant writes for the platform, never shown to visitors:
 *
 *   [[photo:p1]]              show a business photo (ids come from <photos> in the prompt)
 *   [[gap: wedding cakes]]    this question couldn't be answered from the business's information
 *
 * This filter removes them from the streamed text, even when a marker is split across chunks, and
 * reports what it found. Text that only looks like the start of a marker is held back until it can
 * be decided.
 */
const PHOTO = /\[\[photo:([A-Za-z0-9]{1,16})\]\][ \t]*\n?/g;
const GAP = /\[\[gap:([^[\]\n]{0,240})\]\][ \t]*\n?/g;
/** Marker openings, and what may follow each one before its closing brackets. */
const KINDS: [prefix: string, body: RegExp][] = [
  ["[[photo:", /^[A-Za-z0-9]{0,16}\]?$/],
  ["[[gap:", /^[^[\]\n]{0,240}\]?$/],
];

/** True when `tail` could still grow into a complete marker. */
function couldBeMarker(tail: string): boolean {
  return KINDS.some(([prefix, body]) =>
    tail.length <= prefix.length
      ? prefix.startsWith(tail)
      : tail.startsWith(prefix) && body.test(tail.slice(prefix.length)),
  );
}

export class MarkerFilter {
  private buffer = "";

  /**
   * Adds streamed text; returns the text safe to show now, any photo ids completed, and the topic
   * of any gap marker completed (trimmed; may be empty).
   */
  push(chunk: string): { text: string; ids: string[]; gaps: string[] } {
    this.buffer += chunk;
    const ids: string[] = [];
    const gaps: string[] = [];
    let text = this.buffer
      .replace(PHOTO, (_, id: string) => {
        ids.push(id);
        return "";
      })
      .replace(GAP, (_, topic: string) => {
        gaps.push(topic.replace(/\s+/g, " ").trim());
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
    return { text, ids, gaps };
  }

  /** End of the stream: whatever is held back was not a marker. */
  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest;
  }
}
