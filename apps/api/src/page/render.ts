import { iconSvg, type PublicAvatar } from "@traiblazer/appearance";
import type { CatalogAction, CatalogKind, PagePreset, WeeklyHours } from "@traiblazer/db";
import { DAYS, type Day, openStatus } from "./hours.js";
import { type PageLanguage, type PageStringKey, pageText } from "./strings.js";

/**
 * The business page (PLAN §7.1): the hosted chat page as the business's public page. Everything a
 * visitor (or a search engine) needs is ordinary HTML rendered here: header, contact buttons,
 * notices, services and products, photos, hours, service area and footer. The chat app then starts
 * in `#app`; the page works without it.
 */

export interface PageItem {
  id: string;
  kind: CatalogKind;
  name: string;
  description: string | null;
  priceText: string | null;
  category: string | null;
  photoUrl: string | null;
  action: CatalogAction;
}

export interface PagePhoto {
  url: string;
  title: string;
}

export interface PageLink {
  url: string;
  label: string | null;
  icon: "shop" | "link";
}

export interface PageData {
  lang: PageLanguage;
  /** The page's own address (friendly link when there is one). */
  canonicalUrl: string;
  /** Let search engines list it. */
  listed: boolean;
  preset: PagePreset;
  /** schema.org type, e.g. "Plumber" (see `schemaTypeFor`). */
  schemaType: string;
  publicKey: string;
  businessName: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  address: string | null;
  bookingUrl: string | null;
  serviceArea: string | null;
  credentials: string | null;
  staffLanguages: string[];
  timezone: string;
  hours: WeeklyHours | null;
  avatar: PublicAvatar;
  theme: string;
  palette: { brand: string; onBrand: string; accent: string };
  items: PageItem[];
  photos: PagePhoto[];
  notices: string[];
  links: PageLink[];
  poweredBy: boolean;
  now: Date;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Only web links are rendered as links (inputs are validated too; this is defence in depth). */
const webUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** JSON for a <script type="application/ld+json"> (or JSON) block: can't close the element early. */
export const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

const SCHEMA_TYPES: Record<string, string> = {
  trades: "HomeAndConstructionBusiness",
  "trades/plumbing": "Plumber",
  "trades/hvac": "HVACBusiness",
  "trades/electrical": "Electrician",
  "trades/roofing": "RoofingContractor",
  "auto-repair": "AutoRepair",
  "auto-repair/tires": "TireShop",
  "auto-repair/body-collision": "AutoBodyShop",
  "auto-repair/detailing": "AutoWash",
  restaurant: "Restaurant",
  "cafe-bakery": "CafeOrCoffeeShop",
  "cafe-bakery/bakery": "Bakery",
  retail: "Store",
  "personal-care": "HealthAndBeautyBusiness",
  "personal-care/salon": "HairSalon",
  "personal-care/barber": "HairSalon",
  "personal-care/spa": "DaySpa",
  lodging: "LodgingBusiness",
  attractions: "EntertainmentBusiness",
};

/** The most specific schema.org LocalBusiness type for an industry pack and variant. */
export const schemaTypeFor = (pack: string, variant: string | null) =>
  (variant && SCHEMA_TYPES[`${pack}/${variant}`]) || SCHEMA_TYPES[pack] || "LocalBusiness";

const SCHEMA_DAYS: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** schema.org structured data for search engines: the business, its hours and what it offers. */
export function structuredData(data: PageData): Record<string, unknown> {
  const hours = DAYS.flatMap((day) =>
    (data.hours?.[day] ?? []).map((slot) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: SCHEMA_DAYS[day],
      opens: slot.open,
      closes: slot.close,
    })),
  );
  const image = data.avatar.kind === "image" ? data.avatar.url : data.photos[0]?.url;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": data.schemaType,
    name: data.businessName,
    url: data.canonicalUrl,
  };
  if (data.description) ld.description = data.description;
  if (data.phone) ld.telephone = data.phone;
  if (data.email) ld.email = data.email;
  if (image) ld.image = image;
  if (data.address) ld.address = { "@type": "PostalAddress", streetAddress: data.address };
  if (data.serviceArea) ld.areaServed = data.serviceArea;
  if (hours.length) ld.openingHoursSpecification = hours;
  const website = webUrl(data.websiteUrl);
  if (website) ld.sameAs = [website];
  if (data.items.length) {
    ld.makesOffer = data.items.map((item) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": item.kind === "product" ? "Product" : "Service",
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
        ...(item.photoUrl ? { image: item.photoUrl } : {}),
      },
      // Free text ("from $120"), so it can't be a schema.org price.
      ...(item.priceText ? { description: item.priceText } : {}),
    }));
  }
  return ld;
}

const dayName = (lang: PageLanguage, day: Day) =>
  new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 1 + DAYS.indexOf(day))),
  );

function openLine(data: PageData): string | null {
  const status = openStatus(data.hours, data.timezone, data.now);
  if (!status) return null;
  const t = (key: PageStringKey, vars?: Record<string, string>) => pageText(data.lang, key, vars);
  if (status.open) {
    const detail = status.closesAt ? ` · ${t("closesAt", { time: status.closesAt })}` : "";
    return `<span class="tbp-open" data-open="true">${esc(t("openNow"))}${esc(detail)}</span>`;
  }
  const next = status.opensAt;
  const detail = next
    ? ` · ${next.today ? t("opensTodayAt", { time: next.time }) : t("opensAt", { day: dayName(data.lang, next.day), time: next.time })}`
    : "";
  return `<span class="tbp-open" data-open="false">${esc(t("closedNow"))}${esc(detail)}</span>`;
}

function avatarHtml(avatar: PublicAvatar): string {
  if (avatar.kind === "image") {
    return `<img class="tbp-logo" src="${esc(avatar.url)}" alt="" width="88" height="88">`;
  }
  if (avatar.kind === "icon")
    return `<span class="tbp-logo tbp-logo-icon" aria-hidden="true">${iconSvg(avatar.icon, 44)}</span>`;
  return `<span class="tbp-logo tbp-logo-initials" aria-hidden="true">${esc(avatar.initials)}</span>`;
}

const ICONS = {
  call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  directions: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  book: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  website: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  link: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
} as const;
const icon = (name: keyof typeof ICONS) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function actionsHtml(data: PageData): string {
  const t = (key: PageStringKey) => esc(pageText(data.lang, key));
  const external = 'target="_blank" rel="noopener noreferrer"';
  const buttons: string[] = [];
  if (data.phone) {
    buttons.push(
      `<a class="tbp-action tbp-action-primary" data-action="call" href="${esc(telHref(data.phone))}">${icon("call")}<span>${t("call")}</span></a>`,
    );
  }
  const booking = webUrl(data.bookingUrl);
  if (booking)
    buttons.push(
      `<a class="tbp-action" data-action="book" href="${esc(booking)}" ${external}>${icon("book")}<span>${t("book")}</span></a>`,
    );
  if (data.email) {
    buttons.push(
      `<a class="tbp-action" data-action="email" href="mailto:${esc(data.email)}">${icon("email")}<span>${t("email")}</span></a>`,
    );
  }
  if (data.address) {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.address)}`;
    buttons.push(
      `<a class="tbp-action" data-action="directions" href="${esc(maps)}" ${external}>${icon("directions")}<span>${t("directions")}</span></a>`,
    );
  }
  for (const link of data.links) {
    const url = webUrl(link.url);
    if (!url) continue;
    const label = link.label ? esc(link.label) : t(link.icon === "shop" ? "shop" : "link");
    buttons.push(
      `<a class="tbp-action" data-action="link" href="${esc(url)}" ${external}>${icon(link.icon === "shop" ? "shop" : "link")}<span dir="auto">${label}</span></a>`,
    );
  }
  const website = webUrl(data.websiteUrl);
  if (website)
    buttons.push(
      `<a class="tbp-action" data-action="website" href="${esc(website)}" ${external}>${icon("website")}<span>${t("website")}</span></a>`,
    );
  return buttons.length
    ? `<nav class="tbp-actions" aria-label="${t("contact")}">${buttons.join("")}</nav>`
    : "";
}

/** A chat button: hidden until the chat app starts (it sends `data-ask` as the visitor's message). */
const askButton = (label: string, message: string, primary = false) =>
  `<button type="button" class="tbp-btn${primary ? " tbp-btn-primary" : ""}" data-ask="${esc(message)}" hidden>${esc(label)}</button>`;

function itemHtml(data: PageData, item: PageItem): string {
  const t = (key: PageStringKey, vars?: Record<string, string>) => pageText(data.lang, key, vars);
  const name = { item: item.name };
  const buttons: string[] = [];
  const booking = webUrl(data.bookingUrl);
  if (item.action === "quote") buttons.push(askButton(t("requestQuote"), t("quoteMessage", name), true));
  if (item.action === "book") {
    buttons.push(
      booking
        ? `<a class="tbp-btn tbp-btn-primary" data-action="book" href="${esc(booking)}" target="_blank" rel="noopener noreferrer">${esc(t("book"))}</a>`
        : askButton(t("book"), t("bookMessage", name), true),
    );
  }
  buttons.push(askButton(t("askAbout"), t("askMessage", name), item.action === "ask"));
  return [
    `<li class="tbp-card">`,
    item.photoUrl ? `<img class="tbp-card-photo" src="${esc(item.photoUrl)}" alt="" loading="lazy">` : "",
    `<div class="tbp-card-body">`,
    `<h3 dir="auto">${esc(item.name)}</h3>`,
    item.priceText ? `<p class="tbp-price" dir="auto">${esc(item.priceText)}</p>` : "",
    item.description ? `<p class="tbp-card-text" dir="auto">${esc(item.description)}</p>` : "",
    `<div class="tbp-card-actions">${buttons.join("")}</div>`,
    `</div></li>`,
  ].join("");
}

function catalogHtml(data: PageData): string {
  if (!data.items.length) return "";
  const t = (key: PageStringKey) => pageText(data.lang, key);
  const kinds = new Set(data.items.map((i) => i.kind));
  const heading =
    kinds.size > 1 ? t("servicesAndProducts") : kinds.has("product") ? t("products") : t("services");
  // Cards are grouped by category, in the order of each category's first card.
  const groups = new Map<string, PageItem[]>();
  for (const item of data.items) {
    const key = item.category ?? "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const named = [...groups.keys()].some(Boolean);
  const body = [...groups.entries()]
    .map(
      ([category, items]) =>
        `${named && category ? `<h3 class="tbp-category" dir="auto">${esc(category)}</h3>` : ""}<ul class="tbp-cards">${items.map((i) => itemHtml(data, i)).join("")}</ul>`,
    )
    .join("");
  return `<section class="tbp-section" id="services" aria-labelledby="tbp-services"><h2 id="tbp-services">${esc(heading)}</h2>${body}</section>`;
}

function photosHtml(data: PageData): string {
  if (!data.photos.length) return "";
  const t = pageText(data.lang, "photos");
  const list = data.photos
    .map(
      (p) =>
        `<li><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(p.url)}" alt="${esc(p.title)}" loading="lazy"></a></li>`,
    )
    .join("");
  return `<section class="tbp-section" aria-labelledby="tbp-photos"><h2 id="tbp-photos">${esc(t)}</h2><ul class="tbp-gallery">${list}</ul></section>`;
}

function hoursHtml(data: PageData): string {
  if (!data.hours || !DAYS.some((d) => data.hours?.[d]?.length)) return "";
  const t = (key: PageStringKey) => pageText(data.lang, key);
  const rows = DAYS.map((day) => {
    const slots = data.hours?.[day] ?? [];
    const text = slots.length ? slots.map((s) => `${s.open}–${s.close}`).join(", ") : t("closed");
    return `<tr><th scope="row">${esc(dayName(data.lang, day))}</th><td>${esc(text)}</td></tr>`;
  }).join("");
  return `<section class="tbp-section" aria-labelledby="tbp-hours"><h2 id="tbp-hours">${esc(t("hours"))}</h2><table class="tbp-hours">${rows}</table></section>`;
}

function areaHtml(data: PageData): string {
  if (!data.serviceArea) return "";
  const heading = pageText(data.lang, data.preset === "personal" ? "areasServed" : "serviceArea");
  return `<section class="tbp-section" aria-labelledby="tbp-area"><h2 id="tbp-area">${esc(heading)}</h2><p dir="auto">${esc(data.serviceArea)}</p></section>`;
}

function footerHtml(data: PageData): string {
  const t = (key: PageStringKey, vars?: Record<string, string>) => pageText(data.lang, key, vars);
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    rows.push(`<div><dt>${esc(label)}</dt><dd dir="auto">${esc(value)}</dd></div>`);
  if (data.address) row(t("address"), data.address);
  if (data.phone) row(t("phone"), data.phone);
  if (data.credentials) row(t("credentials"), data.credentials);
  if (data.staffLanguages.length) row(t("languages"), data.staffLanguages.join(", "));
  return [
    `<footer class="tbp-footer">`,
    `<p class="tbp-footer-name" dir="auto">${esc(data.businessName)}</p>`,
    rows.length ? `<dl class="tbp-facts">${rows.join("")}</dl>` : "",
    `<p class="tbp-privacy">${esc(t("privacy", { business: data.businessName }))}</p>`,
    data.poweredBy ? `<p class="tbp-powered">${esc(t("poweredBy"))}</p>` : "",
    `</footer>`,
  ].join("");
}

/** The page body: everything visible, with the chat app's mount point (#app) in the chat panel. */
export function pageBody(data: PageData): string {
  const t = (key: PageStringKey, vars?: Record<string, string>) => pageText(data.lang, key, vars);
  const meta = [openLine(data), data.serviceArea ? `<span dir="auto">${esc(data.serviceArea)}</span>` : null]
    .filter(Boolean)
    .join('<span aria-hidden="true"> · </span>');
  const notices = data.notices.length
    ? `<section class="tbp-notices" aria-label="${esc(t("notice"))}">${data.notices.map((n) => `<p dir="auto">${esc(n)}</p>`).join("")}</section>`
    : "";
  const style = `--tb-brand:${data.palette.brand};--tb-on-brand:${data.palette.onBrand};--tb-accent:${data.palette.accent}`;
  return [
    `<div class="tbp" data-theme="${esc(data.theme)}" data-preset="${data.preset}" style="${esc(style)}">`,
    `<header class="tbp-hero"><div class="tbp-hero-inner">`,
    avatarHtml(data.avatar),
    `<div class="tbp-heading"><h1 dir="auto">${esc(data.businessName)}</h1>`,
    data.description ? `<p class="tbp-desc" dir="auto">${esc(data.description)}</p>` : "",
    meta ? `<p class="tbp-meta">${meta}</p>` : "",
    `</div></div>`,
    actionsHtml(data),
    `</header>`,
    notices,
    `<main class="tbp-main">`,
    `<section class="tbp-chat" aria-label="${esc(t(data.preset === "personal" ? "chatHeadingPersonal" : "chatHeading"))}">`,
    `<div id="app"><noscript><p class="tbp-noscript">${esc(t("noScript"))}</p></noscript></div>`,
    `</section>`,
    `<div class="tbp-content">`,
    catalogHtml(data),
    photosHtml(data),
    hoursHtml(data),
    areaHtml(data),
    `</div></main>`,
    footerHtml(data),
    `</div>`,
  ].join("");
}

/** Title, description, canonical link, social preview and structured data for the <head>. */
export function pageHead(data: PageData): string {
  const description = (
    data.description ?? pageText(data.lang, "defaultDescription", { business: data.businessName })
  ).slice(0, 300);
  const image = data.avatar.kind === "image" ? data.avatar.url : data.photos[0]?.url;
  return [
    `<title>${esc(data.businessName)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(data.canonicalUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(data.businessName)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(data.canonicalUrl)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : "",
    `<meta name="theme-color" content="${esc(data.palette.brand)}">`,
    `<script type="application/ld+json">${scriptJson(structuredData(data))}</script>`,
  ]
    .filter(Boolean)
    .join("\n    ");
}

/** Data the chat app reads at start (the page address may be a friendly link, not the key). */
export const bootScript = (boot: { publicKey: string; page: boolean }) =>
  `<script type="application/json" id="tb-boot">${scriptJson(boot)}</script>`;

/**
 * Fills the built chat page (apps/chat/dist/index.html) with the business page. Each part falls
 * back gracefully if the template changes shape.
 */
export function renderBusinessPage(template: string, data: PageData): string {
  const robots = `<meta name="robots" content="${data.listed ? "index, follow" : "noindex"}">`;
  const head = `${pageHead(data)}\n    ${bootScript({ publicKey: data.publicKey, page: true })}`;
  let html = template.replace(/<html[^>]*>/i, () => `<html lang="${data.lang}" dir="ltr" class="tbp-root">`);
  html = /<meta name="robots"[^>]*>/i.test(html)
    ? html.replace(/<meta name="robots"[^>]*>/i, () => robots)
    : html.replace(/<head>/i, () => `<head>\n    ${robots}`);
  html = /<title>[^<]*<\/title>/i.test(html)
    ? html.replace(/<title>[^<]*<\/title>/i, () => head)
    : html.replace(/<\/head>/i, () => `${head}\n  </head>`);
  const body = pageBody(data);
  return /<div id="?app"?>\s*<\/div>/i.test(html)
    ? html.replace(/<div id="?app"?>\s*<\/div>/i, () => body)
    : html.replace(/<\/body>/i, () => `${body}</body>`);
}

/** The plain chat (iframe, widget panel): the template with the boot data, nothing else. */
export function renderChatOnly(template: string, publicKey: string): string {
  const boot = bootScript({ publicKey, page: false });
  return /<\/head>/i.test(template)
    ? template.replace(/<\/head>/i, () => `${boot}\n  </head>`)
    : `${boot}${template}`;
}
