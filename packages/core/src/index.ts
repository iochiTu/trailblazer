export { type AddonEffectPayload, type EffectDeps, type Mailer, runAddonEffect } from "./addons/effects.js";
export * from "./chat/engine.js";
export { recordGap } from "./chat/gaps.js";
export { guessLanguage } from "./chat/language.js";
export { MarkerFilter } from "./chat/markers.js";
export { buildSystemBlocks, formatHours, PLATFORM_RULES } from "./chat/prompt.js";
export { type Passage, type PhotoPassage, retrievePassages, retrievePhotos } from "./chat/retrieval.js";
export {
  type AnyChatTool,
  type AreaCheck,
  type ChatTool,
  chatTools,
  checkServiceArea,
  checkServiceAreaTool,
  defineTool,
  MAX_REQUEST_PHOTOS,
  MAX_REQUESTS_PER_CONVERSATION,
  MAX_TOOL_ROUNDS,
  requestFollowUp,
  requestFollowUpTool,
  runToolCalls,
  type ServiceArea,
  searchKnowledge,
  type ToolContext,
  type ToolOutcome,
  toToolDefinition,
} from "./chat/tools/index.js";
export {
  higherUrgency,
  keywordTriage,
  type ModelTriage,
  normalizeForMatch,
  parseTriage,
  type Urgency,
} from "./chat/triage.js";
export {
  buildDemo,
  DEMO_RETRY_MS,
  DEMO_SOURCE_WAIT_MS,
  type DemoBuildOutcome,
  type DemoBuildPayload,
} from "./demo/build.js";
export * from "./jobs.js";
export { crawlSite } from "./knowledge/crawl.js";
export { extractPage } from "./knowledge/extract.js";
export { FILE_LIMITS, FileReadError, fileSections, readSourceFile } from "./knowledge/files.js";
export { clearSource, indexDocuments, tsvectorSql } from "./knowledge/index-documents.js";
export { assertPublicUrl, UnsafeUrlError } from "./knowledge/safe-fetch.js";
export { DEFAULT_MAX_PAGES, syncSource } from "./knowledge/sync.js";
export { runUrgentAlert, type UrgentAlertDeps, type UrgentAlertPayload } from "./requests/urgent-alert.js";
export { type AppliedSetup, applySetup, CatalogLimitError, suggestionToInput } from "./setup/apply.js";
export {
  basicSuggestion,
  buildSetupRequest,
  extractJson,
  readSuggestion,
  runSetup,
  SETUP_ERRORS,
  SETUP_LIMITS,
  type SetupDeps,
  type SetupPage,
  selectPages,
} from "./setup/setup.js";
