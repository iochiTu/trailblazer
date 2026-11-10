import { type ChatEvent, type ChatRequest, type LLMProvider, textOf } from "../types.js";

/**
 * Offline provider for development and tests (no API key, no network, no cost).
 *
 * It does not understand language. For chat it echoes the most relevant sentences found in the
 * prompt's <knowledge> section, shows the best-matching photo from <photos> and marks questions
 * it found nothing for (with the same markers a real model writes), so the whole pipeline (retrieval, streaming, citations, photos,
 * logging) can be exercised end to end. For auxiliary calls it returns the last user message unchanged.
 */
export class OfflineProvider implements LLMProvider {
  readonly id = "offline";

  /** It can't see images; the chat engine replies with a polite notice instead. */
  supportsImages(): boolean {
    return false;
  }

  /** It can't call tools either; it only ever sees the prompt. */
  supportsTools(): boolean {
    return false;
  }

  async *stream(model: string, request: ChatRequest): AsyncIterable<ChatEvent> {
    const last = request.messages.at(-1);
    const question = last ? textOf(last.content) : "";
    const system = request.system.map((b) => b.text).join("\n");
    const text =
      model === "echo" ? question : withPhoto(answerFromKnowledge(system, question), system, question);

    // Stream word by word, like a real model.
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      yield { type: "text", text: piece };
    }
    yield {
      type: "done",
      model: `offline/${model}`,
      stopReason: "end",
      usage: {
        inputTokens: Math.ceil((system.length + question.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}

const STOP_WORDS = new Set(
  "a an and are as at be by can do does for from have how i in is it me my of on or our the to we what when where which who why will with you your".split(
    " ",
  ),
);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length > 1 && !STOP_WORDS.has(w),
  );
}

/** Adds the marker of the photo whose title and description best match the question. */
function withPhoto(answer: string, system: string, question: string): string {
  const start = system.lastIndexOf("<photos>");
  if (start < 0) return answer;
  const wanted = new Set(terms(question));
  let best: { id: string; score: number } | null = null;
  for (const match of system.slice(start).matchAll(/<photo id="([^"]+)" title="([^"]*)">([^<]*)<\/photo>/g)) {
    const score = terms(`${match[2]} ${match[3]}`).filter((t) => wanted.has(t)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: match[1]!, score };
  }
  return best ? `${answer}\n\n[[photo:${best.id}]]` : answer;
}

function answerFromKnowledge(system: string, question: string): string {
  // The last <knowledge> block holds the retrieved passages (the rules also mention the tag name).
  const start = system.lastIndexOf("<knowledge>");
  const end = system.lastIndexOf("</knowledge>");
  const knowledge = start >= 0 && end > start ? system.slice(start + "<knowledge>".length, end) : "";
  const sentences = knowledge
    .replace(/<[^>]+>/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  const wanted = new Set(terms(question));
  const scored = sentences
    .map((sentence) => ({ sentence, score: terms(sentence).filter((t) => wanted.has(t)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (!scored.length) {
    // Like a real model, it marks what it couldn't answer (the chat engine removes the marker).
    const missing = question
      .replace(/[[\]\n]/g, " ")
      .trim()
      .slice(0, 120);
    return `[Offline test mode] I couldn't find that in this business's information. Please contact the business directly.\n\n[[gap: ${missing}]]`;
  }
  return `[Offline test mode] ${scored.map((s) => s.sentence).join(" ")}`;
}
