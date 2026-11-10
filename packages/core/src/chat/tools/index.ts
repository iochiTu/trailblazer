import type { BotSettings } from "@traiblazer/db";
import type { AnyChatTool } from "./contract.js";
import { requestFollowUp } from "./follow-up.js";
import { searchKnowledge } from "./search-knowledge.js";

export * from "./contract.js";
export { MAX_REQUESTS_PER_CONVERSATION, requestFollowUp } from "./follow-up.js";
export { searchKnowledge } from "./search-knowledge.js";

/** The tools an assistant has, given its settings. (Add-ons will contribute their own here.) */
export function chatTools(bot: { settings: BotSettings }): AnyChatTool[] {
  return bot.settings.followUps === false ? [searchKnowledge] : [searchKnowledge, requestFollowUp];
}
