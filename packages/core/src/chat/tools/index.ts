import type { BotSettings } from "@traiblazer/db";
import type { LeadField } from "@traiblazer/industry-packs";
import type { CalendarAccess } from "../../integrations/calendar.js";
import { bookingTools } from "./booking.js";
import type { AnyChatTool } from "./contract.js";
import { requestFollowUpTool } from "./follow-up.js";
import { searchKnowledge } from "./search-knowledge.js";
import { checkServiceAreaTool } from "./service-area.js";

export { bookAppointmentTool, bookedLabel, bookingTools, findOpenTimesTool } from "./booking.js";
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
 * codes; finding open times and booking when the business connected its calendar (the calendar
 * add-on) and takes requests.
 */
export function chatTools(
  bot: { settings: BotSettings },
  options: {
    leadFields?: LeadField[];
    serviceArea?: boolean;
    catalog?: boolean;
    calendar?: CalendarAccess | null;
  } = {},
): AnyChatTool[] {
  const tools: AnyChatTool[] = [searchKnowledge];
  if (bot.settings.followUps !== false)
    tools.push(requestFollowUpTool(options.leadFields ?? [], { items: options.catalog }));
  if (options.serviceArea) tools.push(checkServiceAreaTool);
  // A booking is a request too: an owner who turned requests off gets no booking either.
  if (options.calendar && bot.settings.followUps !== false)
    tools.push(...bookingTools(options.calendar, options.leadFields ?? [], { items: options.catalog }));
  return tools;
}
