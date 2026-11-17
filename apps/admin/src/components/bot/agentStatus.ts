"use client";

import type { MessageKey } from "@traiblazer/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What the agent chat says while the agent works ("Checking your opening hours…"), from the steps
 * the server streams (see AgentStep in packages/core/src/agent/run.ts).
 *
 * A tool with a line of its own is in TOOL_STATUS; any other tool (a toolkit added later) gets the
 * general line for looking or for saving, so a new tool never needs this file to work.
 */

export type AgentStep =
  | { type: "thinking"; agent: string; depth: number; round: number }
  | {
      type: "tool";
      agent: string;
      depth: number;
      tool: string;
      toolkit: string | null;
      effect: "read" | "write";
      delegate?: string;
    };

const TOOL_STATUS: Record<string, MessageKey> = {
  get_business_details: "agent.status.get_business_details",
  update_business_details: "agent.status.update_business_details",
  set_opening_hours: "agent.status.set_opening_hours",
  get_interview: "agent.status.get_interview",
  update_interview_answers: "agent.status.update_interview_answers",
  list_answers: "agent.status.list_answers",
  add_answer: "agent.status.add_answer",
  update_answer: "agent.status.update_answer",
  remove_answer: "agent.status.remove_answer",
  list_notices: "agent.status.list_notices",
  add_notice: "agent.status.add_notice",
  remove_notice: "agent.status.remove_notice",
};

/** Said in turn while the model reads the message (nothing to show yet but that it's on it). */
const STARTING: MessageKey[] = ["agent.status.looking", "agent.status.reading", "agent.status.thinking"];
/**
 * Said in turn while the model works after using tools: it may be choosing the next step or
 * writing the answer, so the line says it's thinking first, and only later that it's finishing.
 */
const CONTINUING: MessageKey[] = ["agent.status.thinking", "agent.status.finishing", "agent.status.almost"];

/** The lines for a step; several are said in turn while the step lasts. */
export function statusFor(step: AgentStep): MessageKey[] {
  if (step.type === "thinking") return step.round === 0 && step.depth === 0 ? STARTING : CONTINUING;
  if (step.delegate) return ["agent.status.delegate"];
  const own = TOOL_STATUS[step.tool];
  if (own) return [own];
  return [step.effect === "write" ? "agent.status.write" : "agent.status.read"];
}

/** Each line stays at least this long, so quick steps don't flicker past unread. */
const MIN_SHOWN_MS = 900;
/** How often a step's lines take turns. */
const ROTATE_MS = 2600;

interface Queued {
  lines: MessageKey[];
  thinking: boolean;
}

/**
 * The line to show now. `start()` when a message is sent, `step()` for each streamed step, `stop()`
 * when the answer is in. Steps that come faster than MIN_SHOWN_MS wait their turn in a queue: every
 * tool is said, and thinking steps between them are only said when nothing else is waiting. A step
 * with several lines says them in turn.
 */
export function useAgentStatus() {
  const [lines, setLines] = useState<MessageKey[]>(STARTING);
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState(false);
  const shownAt = useRef(0);
  const queue = useRef<Queued[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: MessageKey[]) => {
    shownAt.current = Date.now();
    setLines(next);
    setTick(0);
  }, []);

  /** Shows the next waiting step once the current one has been up long enough. */
  const pump = useCallback(() => {
    if (timer.current || !queue.current.length) return;
    const wait = MIN_SHOWN_MS - (Date.now() - shownAt.current);
    if (wait > 0) {
      timer.current = setTimeout(() => {
        timer.current = null;
        pump();
      }, wait);
      return;
    }
    // A thinking step with something after it is already over: skip to what came next.
    while (queue.current.length > 1 && queue.current[0]!.thinking) queue.current.shift();
    show(queue.current.shift()!.lines);
    pump();
  }, [show]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queue.current = [];
  }, []);

  const step = useCallback(
    (agentStep: AgentStep) => {
      queue.current.push({ lines: statusFor(agentStep), thinking: agentStep.type === "thinking" });
      pump();
    },
    [pump],
  );

  const start = useCallback(() => {
    clear();
    show(STARTING);
    setActive(true);
  }, [clear, show]);

  const stop = useCallback(() => {
    clear();
    setActive(false);
  }, [clear]);

  // A step with several lines says them in turn.
  useEffect(() => {
    if (!active || lines.length < 2) return;
    const id = setInterval(() => setTick((n) => n + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [active, lines]);

  useEffect(() => clear, [clear]);

  return { line: lines[tick % lines.length]!, start, step, stop };
}
