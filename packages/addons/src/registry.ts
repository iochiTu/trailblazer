import { comingSoonAddons } from "./builtin/coming-soon.js";
import { crmAddons } from "./builtin/crm.js";
import { emailNotifications } from "./builtin/email-notifications.js";
import { onlineShop } from "./builtin/online-shop.js";
import type { AddonCapability, AddonCategory, AddonField, AnyAddon, Localized } from "./types.js";

/**
 * Every add-on the platform knows, in market order. To add one: write a definition in builtin/,
 * add it here, and add tests. Installations of an id that is removed from this list are ignored.
 */
export const addons: readonly AnyAddon[] = [
  emailNotifications,
  onlineShop,
  ...crmAddons,
  ...comingSoonAddons,
];

const byId = new Map(addons.map((a) => [a.id, a]));
if (byId.size !== addons.length) throw new Error("Duplicate add-on id");

export const getAddon = (id: string): AnyAddon | undefined => byId.get(id);

/** What the market shows about an add-on (serializable: no hooks or schemas). */
export interface AddonCatalogEntry {
  id: string;
  version: number;
  category: AddonCategory;
  status: "available" | "coming_soon";
  icon: string;
  name: Localized;
  summary: Localized;
  description: Localized;
  capabilities: AddonCapability[];
  fields: AddonField[];
  /** Connector id of the outside account this add-on needs (see `integration` on the definition). */
  integration: string | null;
  defaults: unknown;
}

export const toCatalogEntry = (a: AnyAddon): AddonCatalogEntry => ({
  id: a.id,
  version: a.version,
  category: a.category,
  status: a.status,
  icon: a.icon,
  name: a.name,
  summary: a.summary,
  description: a.description,
  capabilities: a.capabilities,
  fields: a.fields,
  integration: a.integration ?? null,
  defaults: a.defaults,
});

export const addonCatalog = (): AddonCatalogEntry[] => addons.map(toCatalogEntry);
