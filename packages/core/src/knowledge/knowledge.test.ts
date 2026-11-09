import { describe, expect, it } from "vitest";
import { citationsFrom } from "../chat/engine.js";
import { guessLanguage } from "../chat/language.js";
import { parseSearchQueries } from "../chat/prompt.js";
import { toOrQuery } from "../chat/retrieval.js";
import { chunkSections } from "./chunk.js";
import { extractPage } from "./extract.js";
import { assertPublicUrl, isPrivateAddress, pinnedLookup, UnsafeUrlError } from "./safe-fetch.js";

const html = `<!doctype html><html lang="en-CA"><head><title>Lakeside Bistro – Menu</title></head>
<body>
  <header><nav><a href="/">Home</a><a href="/menu">Menu</a></nav></header>
  <div class="cookie-banner">We use cookies. Accept?</div>
  <main>
    <h1>Our menu</h1>
    <p>Fresh walleye from Lake Superior, served daily.</p>
    <h2>Mains</h2>
    <ul><li>Pan-fried walleye — $24</li><li>Wild rice bowl (vegan) — $18</li></ul>
    <h2>Allergens</h2>
    <p>Our fryer is shared with fish and gluten products.</p>
    <a href="/contact#form">Contact us</a>
    <a href="mailto:hi@example.com">Email</a>
  </main>
  <footer>© 2026 Lakeside Bistro</footer>
  <script>alert(1)</script>
</body></html>`;

describe("page extraction", () => {
  const page = extractPage(html, "https://lakeside.example/menu");

  it("keeps headings, paragraphs and list items from the main content", () => {
    expect(page.title).toBe("Lakeside Bistro – Menu");
    expect(page.language).toBe("en-CA");
    expect(page.sections.map((s) => s.heading)).toEqual(["Our menu", "Mains", "Allergens"]);
    expect(page.sections[1]!.text).toContain("- Pan-fried walleye — $24");
  });

  it("drops navigation, footer, cookie banners and scripts", () => {
    expect(page.text).not.toMatch(/cookies|©|alert/);
  });

  it("collects absolute links without fragments or mailto", () => {
    expect(page.links).toContain("https://lakeside.example/contact");
    expect(page.links.some((l) => l.startsWith("mailto:"))).toBe(false);
  });
});

describe("chunking", () => {
  it("keeps the heading with each chunk and respects the size limit", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about our seasonal patio.`).join(
      " ",
    );
    const chunks = chunkSections([{ heading: "Patio", text: `${long}\nSecond paragraph.` }], {
      maxChars: 400,
    });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.heading).toBe("Patio");
      expect(c.content.length).toBeLessThanOrEqual(400);
    }
  });

  it("merges tiny sections", () => {
    const chunks = chunkSections([
      { heading: "Phone", text: "807-555-0100" },
      { heading: "Email", text: "hi@example.com" },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("Email\nhi@example.com");
  });
});

describe("safe fetch", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.10",
    "169.254.169.254",
    "172.20.0.1",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    // Forms the URL parser normalises [::ffff:127.0.0.1] and friends into.
    "::ffff:7f00:1",
    "::7f00:1",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "2002:a00:1::",
    "2001:0:4136:e378::1",
    "fe80::1%eth0",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "not-an-ip",
  ])("treats %s as private", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it("accepts public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
    expect(isPrivateAddress("64:ff9b::808:808")).toBe(false);
    expect(isPrivateAddress("2002:808:808::1")).toBe(false);
  });

  it("refuses to connect when a hostname resolves to a private address at connect time", async () => {
    const error = await new Promise<Error | null>((resolve) =>
      pinnedLookup("localhost", { all: true }, (err) => resolve(err)),
    );
    expect(error).toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects IPv6 literals that point at a private IPv4 address", async () => {
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/",
    ]) {
      await expect(assertPublicUrl(new URL(url))).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("rejects private and non-http URLs", async () => {
    await expect(assertPublicUrl(new URL("http://localhost:4000/"))).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl(new URL("http://169.254.169.254/latest/meta-data"))).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    await expect(assertPublicUrl(new URL("file:///etc/passwd"))).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl(new URL("http://user:pw@example.com/"))).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });
});

describe("language guess", () => {
  it.each([
    ["What time do you open on Sunday?", "en"],
    ["Bonjour, à quelle heure ouvrez-vous?", "fr"],
    ["你们星期天几点开门？", "zh-Hans"],
    ["你們星期天幾點開門？", "zh-Hant"],
    ["ਤੁਸੀਂ ਕਦੋਂ ਖੁੱਲ੍ਹਦੇ ਹੋ?", "pa"],
    ["आप कब खुलते हैं?", "hi"],
    ["متى تفتحون؟", "ar"],
    ["آپ کب کھلتے ہیں؟", "ur"],
    ["Коли ви відкриваєтесь?", "uk"],
    ["¿A qué hora abren?", "es"],
    ["Anong oras po kayo bukas?", "tl"],
  ])("%s → %s", (text, expected) => {
    expect(guessLanguage(text)).toBe(expected);
  });
});

describe("query helpers", () => {
  it("builds a safe OR query from words only", () => {
    expect(toOrQuery(["Open on Sunday?", "it's 'open' & (!x)"])).toBe("open | on | sunday | it");
    expect(toOrQuery(["?!"])).toBeNull();
  });

  it("parses EN/FR search query lines", () => {
    expect(
      parseSearchQueries("EN: opening hours Sunday\nFR: heures d'ouverture dimanche", "星期天几点开门"),
    ).toEqual(["星期天几点开门", "opening hours Sunday", "heures d'ouverture dimanche"]);
    expect(parseSearchQueries("", "hi")).toEqual(["hi"]);
  });
});

describe("citations", () => {
  const passage = (url: string | null, score: number, kind: "page" | "text" | "qa" = "page") => ({
    key: `${url}-${score}`,
    kind,
    title: url,
    url,
    heading: null,
    content: "x",
    score,
  });

  it("cites only pages that matched about as strongly as the best passage", () => {
    const cited = citationsFrom([
      passage(null, 0.033, "text"),
      passage("https://a.example/hours", 0.03),
      passage("https://a.example/hours", 0.029),
      passage("https://example.com/", 0.016),
    ]);
    expect(cited.map((c) => c.url)).toEqual(["https://a.example/hours"]);
  });

  it("cites nothing when the best match is not a web page and pages are weak", () => {
    expect(citationsFrom([passage(null, 2, "qa"), passage("https://example.com/", 0.016)])).toEqual([]);
  });
});
