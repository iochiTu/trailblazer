import { render } from "preact";
import { App, type AppProps } from "./App";
import "./styles.css";
import "./page.css";

/** Set by the API: the key (the address may be a friendly link) and whether this is the business page. */
function readBoot(): { publicKey: string; page: boolean } | null {
  try {
    const text = document.getElementById("tb-boot")?.textContent;
    const boot = text ? JSON.parse(text) : null;
    return typeof boot?.publicKey === "string"
      ? { publicKey: boot.publicKey, page: boot.page === true }
      : null;
  } catch {
    return null;
  }
}

const boot = readBoot();
const publicKey =
  boot?.publicKey ?? decodeURIComponent(window.location.pathname.split("/").filter(Boolean)[1] ?? "");
const params = new URLSearchParams(window.location.search);
const embed = params.get("embed");
const mode: AppProps["mode"] =
  embed === "widget" || embed === "inline" || embed === "playground" ? embed : "hosted";
const page = params.get("page");
const preview = params.get("preview") === "1";
const onPage = boot?.page === true && mode === "hosted";

if (onPage) {
  // "Ask about this" and "Request a quote" buttons on the business page send their text to the chat.
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-ask]"))
    button.hidden = false;
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest?.("button[data-ask]");
    const text = button?.getAttribute("data-ask");
    if (!text) return;
    window.dispatchEvent(new CustomEvent("tb:ask", { detail: text }));
    // On a phone the chat may be scrolled away; on a wide screen it stays in view (sticky).
    const chat = document.querySelector(".tbp-chat");
    const top = chat?.getBoundingClientRect().top ?? 0;
    if (chat && (top < 0 || top > window.innerHeight / 2)) {
      chat.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // Page statistics: the visit and taps on the contact buttons (Call, Book, Directions…). Only
  // which button, never who; the owner's preview isn't counted.
  if (!preview) {
    const send = (action: string) => {
      const body = new Blob([JSON.stringify({ publicKey, action })], { type: "application/json" });
      navigator.sendBeacon?.("/v1/public/page-events", body);
    };
    // One view per visit: a refresh, or coming back to the page in the same tab, isn't counted
    // again. Session storage stays in this tab and is never sent anywhere.
    const seenKey = `tb:viewed:${publicKey}`;
    let seen = false;
    try {
      seen = sessionStorage.getItem(seenKey) === "1";
      sessionStorage.setItem(seenKey, "1");
    } catch {
      // Storage blocked: count the view anyway.
    }
    if (!seen) send("view");
    document.addEventListener("click", (event) => {
      const action = (event.target as Element | null)
        ?.closest?.("a[data-action]")
        ?.getAttribute("data-action");
      if (action) send(action);
    });
  }
}

render(
  <App publicKey={publicKey} mode={mode} pageUrl={page} preview={preview} onPage={onPage} />,
  document.getElementById("app")!,
);
