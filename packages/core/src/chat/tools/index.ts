import type { BotSettings } from "@traiblazer/db";
import type { LeadField } from "@traiblazer/industry-packs";
import type { AnyChatTool } from "./contract.js";
import { requestFollowUpTool } from "./follow-up.js";
import { searchKnowledge } from "./search-knowledge.js";
import { checkServiceAreaTool } from "./service-area.js";

export * from "./contract.js";
export {
  MAX_REQUEST_PHOTOS,
  MAX_REQUESTS_PER_CONVERSATION,
  requestFollowUp,
  requestFollowUpTool,
} from "./follow-up.js";
export { searchKnowledge } from "./search-knowledge.js";
export { type AreaCheck, checkServiceArea, checkServiceAreaTool, type ServiceArea } from "./service-area.js";

/**
 * The tools an assistant has: search always; requests unless the owner turned them off (with the
 * industry's request fields); the service-area check when the business listed towns or postal
 * codes. (Add-ons will contribute their own here.)
 */
export function chatTools(
  bot: { settings: BotSettings },
  options: { leadFields?: LeadField[]; serviceArea?: boolean; catalog?: boolean } = {},
): AnyChatTool[] {
  const tools: AnyChatTool[] = [searchKnowledge];
  if (bot.settings.followUps !== false)
    tools.push(requestFollowUpTool(options.leadFields ?? [], { items: options.catalog }));
  if (options.serviceArea) tools.push(checkServiceAreaTool);
  return tools;
}
