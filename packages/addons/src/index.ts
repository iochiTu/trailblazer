/**
 * Add-on market: optional extensions a business installs on an assistant (email notifications,
 * online shop, and later catalog feeds, booking calendars…). See types.ts for the contract and
 * registry.ts for the list.
 */
export type { EmailNotificationsConfig } from "./builtin/email-notifications.js";
export type { OnlineShopConfig } from "./builtin/online-shop.js";
export * from "./registry.js";
export * from "./runtime.js";
export * from "./types.js";
