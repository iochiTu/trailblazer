/**
 * Chat appearance shared by the chat page, the widget loader, the API and the admin.
 *
 * Businesses customize within limits: they pick one of a few designed templates and a brand color
 * (text colors are derived so contrast stays readable), while the assistant's name, avatar (photo,
 * icon or initials), greeting and launcher label are fully theirs.
 */

export const THEMES = ["classic", "minimal", "friendly", "bold", "midnight"] as const;
export type ThemeId = (typeof THEMES)[number];

export interface ThemeInfo {
  id: ThemeId;
  name: Record<"en" | "fr", string>;
  description: Record<"en" | "fr", string>;
}

export const themeInfo: ThemeInfo[] = [
  {
    id: "classic",
    name: { en: "Classic", fr: "Classique" },
    description: { en: "Colored header, rounded bubbles.", fr: "En-tête coloré, bulles arrondies." },
  },
  {
    id: "minimal",
    name: { en: "Minimal", fr: "Minimal" },
    description: {
      en: "Clean white look, color only on accents.",
      fr: "Blanc épuré, couleur sur les accents.",
    },
  },
  {
    id: "friendly",
    name: { en: "Friendly", fr: "Convivial" },
    description: {
      en: "Soft tinted background, avatar next to every reply.",
      fr: "Fond teinté doux, avatar à côté de chaque réponse.",
    },
  },
  {
    id: "bold",
    name: { en: "Bold", fr: "Audacieux" },
    description: {
      en: "Large header with photo and name, strong colors.",
      fr: "Grand en-tête avec photo et nom, couleurs vives.",
    },
  },
  {
    id: "midnight",
    name: { en: "Midnight", fr: "Minuit" },
    description: {
      en: "Always dark. Great for bars, studios, nightlife.",
      fr: "Toujours sombre. Idéal pour bars, studios, vie nocturne.",
    },
  },
];

export const DEFAULT_THEME: ThemeId = "classic";
export const DEFAULT_COLOR = "#1f6f5c";

export interface BrandColorPreset {
  id: string;
  color: string;
  name: Record<"en" | "fr", string>;
}

/** Ready-made brand colors offered first; any other hex color is available as a custom color. */
export const BRAND_COLOR_PRESETS: BrandColorPreset[] = [
  { id: "forest", color: DEFAULT_COLOR, name: { en: "Forest", fr: "Forêt" } },
  { id: "teal", color: "#0f766e", name: { en: "Teal", fr: "Sarcelle" } },
  { id: "lake", color: "#1d5fa8", name: { en: "Lake blue", fr: "Bleu lac" } },
  { id: "navy", color: "#1e3a5f", name: { en: "Navy", fr: "Marine" } },
  { id: "purple", color: "#6d28d9", name: { en: "Purple", fr: "Violet" } },
  { id: "plum", color: "#86198f", name: { en: "Plum", fr: "Prune" } },
  { id: "raspberry", color: "#be185d", name: { en: "Raspberry", fr: "Framboise" } },
  { id: "red", color: "#b91c1c", name: { en: "Red", fr: "Rouge" } },
  { id: "orange", color: "#c2410c", name: { en: "Orange", fr: "Orange" } },
  { id: "gold", color: "#f2b705", name: { en: "Gold", fr: "Or" } },
  { id: "coffee", color: "#7c4a2d", name: { en: "Coffee", fr: "Café" } },
  { id: "charcoal", color: "#333333", name: { en: "Charcoal", fr: "Charbon" } },
];

export const findColorPreset = (color: string | undefined) =>
  color ? BRAND_COLOR_PRESETS.find((p) => p.color.toLowerCase() === color.toLowerCase()) : undefined;

export const isTheme = (value: unknown): value is ThemeId => THEMES.includes(value as ThemeId);

// ---- Avatar icons ------------------------------------------------------------------------------
// Inner SVG markup for a 24×24 viewBox, stroke-based. Paths from Feather Icons (MIT License,
// © Cole Bemis, https://feathericons.com). Static strings only — never user input.

export const AVATAR_ICONS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  smile:
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  briefcase:
    '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  coffee:
    '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
  heart:
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  compass:
    '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  truck:
    '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
} as const;

export type AvatarIcon = keyof typeof AVATAR_ICONS;
export const AVATAR_ICON_IDS = Object.keys(AVATAR_ICONS) as AvatarIcon[];

export const iconSvg = (icon: AvatarIcon, size = 24) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${AVATAR_ICONS[icon]}</svg>`;

/** Avatar as sent to visitors (image resolved to a URL). */
export type PublicAvatar =
  | { kind: "initials"; initials: string }
  | { kind: "icon"; icon: AvatarIcon }
  | { kind: "image"; url: string };

/**
 * Up to two initials from a name in any script ("Northshore Handyman" → "NH", "李师傅" → "李").
 * Only letters and digits count, so emoji and symbols are skipped ("Mike 🔧" → "M").
 */
export function initialsOf(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((c): c is string => Boolean(c));
  if (!initials.length) return "?";
  const first = initials[0]!;
  // CJK and Hangul names: one character is the convention.
  if (initials.length === 1 || /[　-鿿가-힯]/.test(first)) return first.toUpperCase();
  return `${first}${initials.at(-1)}`.toUpperCase();
}

// ---- Color & contrast (WCAG 2.1) ---------------------------------------------------------------

export const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: [number, number, number]) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black text, whichever is more readable on the given background. */
export function textOn(background: string): string {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#111111") ? "#ffffff" : "#111111";
}

/** Darkens (or lightens) a color until it reaches `ratio` contrast against `against`. */
export function ensureContrast(color: string, against: string, ratio = 4.5): string {
  if (contrastRatio(color, against) >= ratio) return color;
  const target: [number, number, number] = luminance(against) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const base = channels(color);
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex(base.map((c, i) => c + (target[i]! - c) * t) as [number, number, number]);
    if (contrastRatio(mixed, against) >= ratio) return mixed;
  }
  return luminance(against) > 0.5 ? "#000000" : "#ffffff";
}

/** Colors the chat derives from a brand color, so any choice stays readable. */
export function paletteFor(brand: string, theme: ThemeId) {
  const color = isHexColor(brand) ? brand : DEFAULT_COLOR;
  const surface = theme === "midnight" ? "#17171a" : "#ffffff";
  return {
    brand: color,
    onBrand: textOn(color),
    /** Brand color used for text/links on the chat surface. */
    accent: ensureContrast(color, surface, 4.5),
    surface,
  };
}

export interface PublicAppearance {
  theme: ThemeId;
  color: string;
  assistantName: string;
  avatar: PublicAvatar;
  launcherLabel: string | null;
  launcherPosition: "right" | "left";
}
