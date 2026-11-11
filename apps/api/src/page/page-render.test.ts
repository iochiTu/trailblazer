import { describe, expect, it } from "vitest";
import { openStatus } from "./hours.js";
import {
  type PageData,
  renderBusinessPage,
  renderChatOnly,
  schemaTypeFor,
  structuredData,
} from "./render.js";

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex" />
    <title>Chat</title>
    <script type="module" crossorigin src="/chat-assets/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

// Tuesday 11 November 2025, 10:30 in Toronto (15:30 UTC).
const TUESDAY_MORNING = new Date("2025-11-11T15:30:00Z");

const weekdays = { open: "08:00", close: "17:00" };
const HOURS = {
  mon: [weekdays],
  tue: [weekdays],
  wed: [weekdays],
  thu: [weekdays],
  fri: [weekdays],
  sat: [],
  sun: [],
};

const data = (overrides: Partial<PageData> = {}): PageData => ({
  lang: "en",
  canonicalUrl: "https://chat.example/smith-plumbing",
  listed: true,
  preset: "business",
  schemaType: "Plumber",
  publicKey: "pk_test_abcdefghijkl",
  businessName: "Smith & Sons Plumbing",
  description: "Licensed plumbers serving Guelph since 1998.",
  phone: "(519) 555-0100",
  email: "office@smith.example",
  websiteUrl: null,
  address: "12 Main St, Guelph, ON",
  bookingUrl: "https://book.example/smith",
  serviceArea: "Guelph, Fergus, Elora",
  credentials: "Licensed and insured",
  staffLanguages: ["English", "Français"],
  timezone: "America/Toronto",
  hours: HOURS,
  avatar: { kind: "initials", initials: "SS" },
  theme: "classic",
  palette: { brand: "#1f6f5c", onBrand: "#ffffff", accent: "#1f6f5c" },
  items: [
    {
      id: "1",
      kind: "service",
      name: "Drain cleaning",
      description: "Kitchen and bathroom drains.",
      priceText: "from $120",
      category: "Repairs",
      photoUrl: null,
      action: "quote",
    },
    {
      id: "2",
      kind: "service",
      name: "Water heater install",
      description: null,
      priceText: null,
      category: "Installations",
      photoUrl: "https://chat.example/v1/public/assets/abc",
      action: "book",
    },
  ],
  photos: [{ url: "https://chat.example/v1/public/assets/p1", title: "Our van" }],
  notices: ["Closed Monday for the holiday"],
  links: [],
  poweredBy: true,
  now: TUESDAY_MORNING,
  ...overrides,
});

describe("open now", () => {
  it("is open during the day's hours with the closing time", () => {
    expect(openStatus(HOURS, "America/Toronto", TUESDAY_MORNING)).toEqual({ open: true, closesAt: "17:00" });
  });

  it("gives the next opening when closed, later today or on another day", () => {
    const early = new Date("2025-11-11T11:00:00Z"); // 06:00 Tuesday
    expect(openStatus(HOURS, "America/Toronto", early)).toEqual({
      open: false,
      opensAt: { day: "tue", time: "08:00", today: true },
    });
    const friday = new Date("2025-11-14T23:00:00Z"); // 18:00 Friday → Monday 08:00
    expect(openStatus(HOURS, "America/Toronto", friday)).toEqual({
      open: false,
      opensAt: { day: "mon", time: "08:00", today: false },
    });
  });

  it("handles periods that end after midnight and the time zone", () => {
    const late = { fri: [{ open: "18:00", close: "02:00" }] };
    expect(openStatus(late, "America/Toronto", new Date("2025-11-15T06:30:00Z"))).toEqual({
      open: true,
      closesAt: "02:00",
    }); // 01:30 Saturday
    // Same instant in Vancouver is 22:30 Friday.
    expect(openStatus(late, "America/Vancouver", new Date("2025-11-15T06:30:00Z"))).toMatchObject({
      open: true,
    });
  });

  it("says nothing without hours", () => {
    expect(openStatus(null, "America/Toronto", TUESDAY_MORNING)).toBeNull();
    expect(openStatus({ mon: [] }, "America/Toronto", TUESDAY_MORNING)).toBeNull();
  });
});

describe("business page HTML", () => {
  const html = renderBusinessPage(TEMPLATE, data());

  it("puts the content in the HTML, readable without the chat app", () => {
    expect(html).toContain('<h1 dir="auto">Smith &amp; Sons Plumbing</h1>');
    expect(html).toContain("Licensed plumbers serving Guelph since 1998.");
    expect(html).toContain('data-open="true">Open now · closes at 17:00');
    expect(html).toContain(
      '<a class="tbp-action tbp-action-primary" data-action="call" href="tel:5195550100">',
    );
    expect(html).toContain("Closed Monday for the holiday");
    expect(html).toContain('<h3 dir="auto">Drain cleaning</h3>');
    expect(html).toContain('<p class="tbp-price" dir="auto">from $120</p>');
    expect(html).toContain('<h3 class="tbp-category" dir="auto">Repairs</h3>');
    expect(html).toContain('alt="Our van"');
    expect(html).toContain('<th scope="row">Tuesday</th><td>08:00–17:00</td>');
    expect(html).toContain("Licensed and insured");
    // The chat app mounts inside the page.
    expect(html).toContain('<div id="app"><noscript>');
    expect(html).toContain('<html lang="en" dir="ltr" class="tbp-root">');
  });

  it("adds chat buttons that stay hidden until the chat starts", () => {
    expect(html).toContain(
      'data-ask="I&#39;d like a quote for Drain cleaning." hidden>Request a quote</button>',
    );
    // "Book" links to the business's booking tool when it has one.
    expect(html).toContain(
      '<a class="tbp-btn tbp-btn-primary" data-action="book" href="https://book.example/smith"',
    );
    expect(renderBusinessPage(TEMPLATE, data({ bookingUrl: null }))).toContain(
      'data-ask="I&#39;d like to book Water heater install." hidden>Book</button>',
    );
  });

  it("has a title, description, canonical link and structured data", () => {
    expect(html).toContain("<title>Smith &amp; Sons Plumbing</title>");
    expect(html).toContain(
      '<meta name="description" content="Licensed plumbers serving Guelph since 1998.">',
    );
    expect(html).toContain('<link rel="canonical" href="https://chat.example/smith-plumbing">');
    expect(html).toContain('<meta name="robots" content="index, follow">');
    expect(html).not.toContain('content="noindex"');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]!);
    expect(ld).toMatchObject({
      "@type": "Plumber",
      name: "Smith & Sons Plumbing",
      telephone: "(519) 555-0100",
      areaServed: "Guelph, Fergus, Elora",
      address: { streetAddress: "12 Main St, Guelph, ON" },
    });
    expect(ld.openingHoursSpecification).toHaveLength(5);
    expect(ld.makesOffer[0].itemOffered).toMatchObject({ "@type": "Service", name: "Drain cleaning" });
    const boot = JSON.parse(/<script type="application\/json" id="tb-boot">(.*?)<\/script>/.exec(html)![1]!);
    expect(boot).toEqual({ publicKey: "pk_test_abcdefghijkl", page: true });
  });

  it("keeps unlisted pages out of search engines", () => {
    expect(renderBusinessPage(TEMPLATE, data({ listed: false }))).toContain(
      '<meta name="robots" content="noindex">',
    );
  });

  it("escapes everything the business typed, including in structured data", () => {
    const evil = renderBusinessPage(
      TEMPLATE,
      data({
        businessName: "</script><script>alert(1)</script>",
        description: '"><img src=x onerror=alert(1)>',
      }),
    );
    expect(evil).not.toContain("<script>alert(1)");
    expect(evil).not.toContain("<img src=x");
    expect(evil).toContain("\\u003c/script\\u003e");
  });

  it("renders in French and with the personal layout", () => {
    const fr = renderBusinessPage(TEMPLATE, data({ lang: "fr", preset: "personal" }));
    expect(fr).toContain('<html lang="fr"');
    expect(fr).toContain("Secteurs desservis");
    expect(fr).toContain("Demander une soumission");
    expect(fr).toContain('data-preset="personal"');
    expect(fr).toContain("mardi");
  });

  it("leaves out sections the business hasn't filled in", () => {
    const bare = renderBusinessPage(
      TEMPLATE,
      data({
        items: [],
        photos: [],
        notices: [],
        hours: null,
        serviceArea: null,
        phone: null,
        credentials: null,
      }),
    );
    expect(bare).not.toContain('id="services"');
    expect(bare).not.toContain("tbp-gallery");
    expect(bare).not.toContain("tbp-hours");
    expect(bare).not.toContain("tbp-notices");
    expect(bare).not.toContain("tbp-open");
    expect(bare).toContain("Smith &amp; Sons Plumbing");
  });

  it("picks the most specific schema.org type", () => {
    expect(schemaTypeFor("trades", "hvac")).toBe("HVACBusiness");
    expect(schemaTypeFor("trades", "cleaning")).toBe("HomeAndConstructionBusiness");
    expect(schemaTypeFor("auto-repair", "tires")).toBe("TireShop");
    expect(schemaTypeFor("generic", null)).toBe("LocalBusiness");
    expect(structuredData(data({ items: [] }))).not.toHaveProperty("makesOffer");
  });

  it("leaves the plain chat (iframes, widget) without the page", () => {
    const chat = renderChatOnly(TEMPLATE, "pk_test_abcdefghijkl");
    expect(chat).toContain('<div id="app"></div>');
    expect(chat).not.toContain("tbp");
    expect(chat).toContain('"page":false');
  });
});
