import type { ModelRoute, Usage } from "./types.js";

/**
 * USD per 1M tokens. Cache writes bill at 125 % of input. Cache reads bill at `cacheRead` when the
 * model has its own rate, otherwise at 10 % of input.
 */
interface Price {
  input: number;
  output: number;
  cacheRead?: number;
}

/** Anthropic first-party prices (other providers' prices can be added per provider:model). */
const PRICES: Record<string, Price> = {
  "anthropic:claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "anthropic:claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "anthropic:claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "anthropic:claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "anthropic:claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
};

export function registerPrice(route: ModelRoute, price: Price): void {
  PRICES[`${route.provider}:${route.model}`] = price;
}

/** Cost in micro-USD (1e-6 USD); 0 when the price is unknown (e.g. offline provider). */
export function costMicros(route: ModelRoute, usage: Usage): number {
  const price = PRICES[`${route.provider}:${route.model}`];
  if (!price) return 0;
  // price is USD per 1M tokens → micro-USD per token is exactly `price`.
  return Math.round(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * (price.cacheRead ?? price.input * 0.1) +
      usage.cacheWriteTokens * price.input * 1.25,
  );
}
