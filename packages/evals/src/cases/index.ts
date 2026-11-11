import type { EvalCase } from "../types.js";
import { autoCases } from "./auto.js";
import { tradesCases } from "./trades.js";

/** Every case, by pack: Trades (plumbing) and Auto repair (tire centre), in English and French. */
export const ALL_CASES: EvalCase[] = [...tradesCases, ...autoCases];
