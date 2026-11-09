import { costMicros } from "./pricing.js";
import {
  type ChatEvent,
  type ChatRequest,
  hasImages,
  type LLMProvider,
  type ModelRoute,
  type StopReason,
  type Usage,
} from "./types.js";

export type Purpose = "chat" | "aux";

export interface GatewayResultMeta {
  provider: string;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  costMicros: number;
}

export type GatewayEvent = { type: "text"; text: string } | ({ type: "done" } & GatewayResultMeta);

export interface GatewayOptions {
  providers: LLMProvider[];
  /** Ordered routes per purpose; later routes are fallbacks. */
  routes: Record<Purpose, ModelRoute[]>;
  onFallback?: (info: { from: ModelRoute; to: ModelRoute; error: unknown }) => void;
}

/**
 * Routes requests to providers with ordered fallbacks. A route is abandoned for the next one only
 * if it fails before producing any text; once text has streamed to the visitor, errors propagate.
 */
export class LLMGateway {
  private readonly providers: Map<string, LLMProvider>;

  constructor(private readonly options: GatewayOptions) {
    this.providers = new Map(options.providers.map((p) => [p.id, p]));
    for (const purpose of ["chat", "aux"] as const) {
      const routes = options.routes[purpose];
      if (!routes.length) throw new Error(`LLM gateway: no routes for "${purpose}"`);
      for (const route of routes) {
        if (!this.providers.has(route.provider)) {
          throw new Error(`LLM gateway: route uses unknown provider "${route.provider}"`);
        }
      }
    }
  }

  routes(purpose: Purpose): ModelRoute[] {
    return this.options.routes[purpose];
  }

  /** Routes whose model can look at images (in fallback order). */
  visionRoutes(purpose: Purpose): ModelRoute[] {
    return this.options.routes[purpose].filter((r) =>
      this.providers.get(r.provider)!.supportsImages(r.model),
    );
  }

  /** True when at least one route for this purpose accepts images. */
  supportsImages(purpose: Purpose): boolean {
    return this.visionRoutes(purpose).length > 0;
  }

  async *stream(purpose: Purpose, request: ChatRequest): AsyncIterable<GatewayEvent> {
    // Requests with images only go to models that can see them.
    const routes = hasImages(request.messages) ? this.visionRoutes(purpose) : this.options.routes[purpose];
    if (!routes.length) throw new NoVisionRouteError(purpose);
    let lastError: unknown;

    for (const [index, route] of routes.entries()) {
      const provider = this.providers.get(route.provider)!;
      let emitted = false;
      try {
        for await (const event of provider.stream(route.model, request) as AsyncIterable<ChatEvent>) {
          if (event.type === "text") {
            emitted = true;
            yield event;
          } else {
            yield {
              type: "done",
              provider: route.provider,
              model: event.model,
              usage: event.usage,
              stopReason: event.stopReason,
              costMicros: costMicros(route, event.usage),
            };
          }
        }
        return;
      } catch (error) {
        if (emitted || request.signal?.aborted) throw error;
        lastError = error;
        const next = routes[index + 1];
        if (next) this.options.onFallback?.({ from: route, to: next, error });
      }
    }
    throw lastError;
  }

  /** Non-streaming convenience for short auxiliary calls. */
  async complete(purpose: Purpose, request: ChatRequest): Promise<{ text: string } & GatewayResultMeta> {
    let text = "";
    let meta: GatewayResultMeta | undefined;
    for await (const event of this.stream(purpose, request)) {
      if (event.type === "text") text += event.text;
      else meta = event;
    }
    if (!meta) throw new Error("LLM gateway: stream ended without a result");
    return { text, ...meta };
  }
}

/** No configured route can look at the images in a request. */
export class NoVisionRouteError extends Error {
  constructor(purpose: Purpose) {
    super(`LLM gateway: no "${purpose}" route accepts images`);
    this.name = "NoVisionRouteError";
  }
}

/** Parses "provider:model,provider:model" into routes. */
export function parseRoutes(spec: string): ModelRoute[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf(":");
      if (i <= 0 || i === entry.length - 1)
        throw new Error(`Invalid model route "${entry}" (use provider:model)`);
      return { provider: entry.slice(0, i), model: entry.slice(i + 1) };
    });
}
