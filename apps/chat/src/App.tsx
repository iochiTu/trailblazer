import { paletteFor } from "@traiblazer/appearance";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Avatar } from "./Avatar";
import {
  type AttachmentName,
  type Citation,
  fetchConfig,
  fetchHistory,
  type PublicBotConfig,
  type ReplyAction,
  type ReplyPhoto,
  streamChat,
} from "./api";
import { Icon } from "./Icon";
import { ImageError, imageFiles, MAX_IMAGES, type PendingImage, prepareImage } from "./images";
import { Markdown } from "./markdown";
import { conversationStore, languageStore, visitorId } from "./storage";
import { ui } from "./strings";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  /** Images the visitor sent: shown by name only. */
  attachments?: AttachmentName[];
  /** Business photos the assistant showed. */
  images?: ReplyPhoto[];
  /** Buttons under the reply (call, book, or a quote or booking for one service). */
  actions?: ReplyAction[];
  pending?: boolean;
  error?: boolean;
  /** A limit or "busy" message (not an error). */
  notice?: boolean;
}

/** Friendly text for a refused question, with the business's contact details where helpful. */
function refusalText(code: string, lang: string, config: PublicBotConfig): string | null {
  const business = config.businessName;
  // Rendered as a short list by the Markdown component.
  const contact = [
    config.contact.phone && `- ${ui(lang, "phone")}: ${config.contact.phone}`,
    config.contact.email && `- ${ui(lang, "email")}: ${config.contact.email}`,
  ]
    .filter(Boolean)
    .join("\n");
  const withContact = (text: string) => (contact ? `${text}\n\n${contact}` : text);
  switch (code) {
    case "quota":
      return withContact(ui(lang, "limitQuota", { business }));
    case "visitor":
      return withContact(ui(lang, "limitVisitor", { business }));
    case "conversation":
      return ui(lang, "limitConversation");
    case "busy":
      return ui(lang, "busy");
    case "slowDown":
      return ui(lang, "slowDown");
    case "images":
      return ui(lang, "imagesLimit");
    case "image_type":
      return ui(lang, "imageUnsupported");
    case "image_size":
      return ui(lang, "imageTooBig");
    default:
      return null;
  }
}

export interface AppProps {
  publicKey: string;
  /** "hosted" (full page), "inline" (iframe in a page), "widget" (floating panel), "playground" (admin). */
  mode: "hosted" | "inline" | "widget" | "playground";
  pageUrl: string | null;
  /** Admin preview: looks like `mode`, but conversations are logged as playground tests. */
  preview?: boolean;
  /** Shown inside the business page (the page around it is rendered by the API). */
  onPage?: boolean;
}

let counter = 0;
const nextId = () => `m${++counter}`;

function pickLanguage(config: PublicBotConfig, publicKey: string): string {
  const codes = config.languages.map((l) => l.code);
  const saved = languageStore.get(publicKey);
  if (saved && codes.includes(saved)) return saved;
  for (const tag of navigator.languages ?? []) {
    const lower = tag.toLowerCase();
    const base = lower.split("-")[0]!;
    const zh = base === "zh" ? (/(tw|hk|mo|hant)/.test(lower) ? "zh-Hant" : "zh-Hans") : null;
    const match = codes.find((c) => c.toLowerCase() === (zh ?? base).toLowerCase());
    if (match) return match;
  }
  return config.defaultLanguage;
}

export function App({ publicKey, mode, pageUrl, preview = false, onPage = false }: AppProps) {
  const [config, setConfig] = useState<PublicBotConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [lang, setLang] = useState("en");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);
  /** Problem with a picked image, shown above the composer. */
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The visitor described an urgent problem or a danger: the phone number stays on screen. */
  const [urgent, setUrgent] = useState<{ level: "urgent" | "danger"; phone: string | null } | null>(null);
  const dragDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const conversationId = useRef<string | null>(conversationStore.get(publicKey));
  const visitor = useRef(visitorId(publicKey));
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchConfig(publicKey)
      .then(async (cfg) => {
        setConfig(cfg);
        setLang(pickLanguage(cfg, publicKey));
        if (conversationId.current) {
          const history = await fetchHistory(publicKey, conversationId.current, visitor.current);
          if (history.length) {
            setMessages(
              history.map((m) => ({
                id: nextId(),
                role: m.role,
                content: m.content,
                citations: m.citations,
                attachments: m.attachments?.map((a) => ({ name: a.name })),
                images: m.images,
                actions: m.actions,
              })),
            );
          } else {
            conversationId.current = null;
            conversationStore.set(publicKey, null);
          }
        }
      })
      .catch(() => setFailed(true));
  }, [publicKey]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  // The message box grows with what is typed (up to the height set in the styles).
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [input, config]);

  const language = config?.languages.find((l) => l.code === lang);
  const dir = language?.dir ?? "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    // The business page keeps its own title (it is what search engines and shared links show).
    if (config && !onPage) document.title = config.businessName;
  }, [lang, dir, config, onPage]);

  async function addImages(files: File[]) {
    if (!files.length) return;
    setImageError(null);
    const room = MAX_IMAGES - images.length;
    if (files.length > room) setImageError(ui(lang, "imageTooMany", { max: String(MAX_IMAGES) }));
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        const image = await prepareImage(file);
        setImages((list) => (list.length < MAX_IMAGES ? [...list, image] : list));
      } catch (error) {
        setImageError(ui(lang, error instanceof ImageError ? error.code : "imageUnsupported"));
      }
    }
    inputRef.current?.focus();
  }

  // Drag and drop anywhere on the chat. Counting enter/leave pairs keeps the overlay steady while
  // the pointer crosses child elements.
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const dragHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      const usable = imageFiles(event.dataTransfer?.files);
      if (files.length && !usable.length) setImageError(ui(lang, "imageUnsupported"));
      void addImages(usable);
    },
  };

  function onPaste(event: ClipboardEvent) {
    const files = imageFiles(event.clipboardData?.files);
    if (!files.length) return;
    event.preventDefault();
    void addImages(files);
  }

  async function send(text: string) {
    const message = text.trim();
    const attached = images;
    if ((!message && !attached.length) || busy || !config) return;
    setInput("");
    setImages([]);
    setImageError(null);
    setBusy(true);
    const assistantId = nextId();
    setMessages((list) => [
      ...list,
      {
        id: nextId(),
        role: "user",
        content: message,
        citations: [],
        attachments: attached.map((image) => ({ name: image.name })),
      },
      { id: assistantId, role: "assistant", content: "", citations: [], pending: true },
    ]);
    const update = (fn: (m: Message) => Message) =>
      setMessages((list) => list.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      for await (const event of streamChat({
        publicKey,
        conversationId: conversationId.current,
        visitorId: visitor.current,
        message,
        images: attached.map(({ name, data }) => ({ name, data })),
        channel: preview ? "playground" : mode,
        pageUrl,
      })) {
        if (event.type === "start") {
          conversationId.current = event.conversationId;
          conversationStore.set(publicKey, event.conversationId);
        } else if (event.type === "text") {
          update((m) => ({ ...m, content: m.content + event.text }));
        } else if (event.type === "reset") {
          update((m) => ({ ...m, content: "" }));
        } else if (event.type === "urgent") {
          const { level, phone } = event;
          setUrgent((current) => (current?.level === "danger" ? current : { level, phone }));
        } else if (event.type === "action") {
          update((m) => ({ ...m, actions: [...(m.actions ?? []), event.action] }));
        } else if (event.type === "image") {
          update((m) => ({ ...m, images: [...(m.images ?? []), event.image] }));
        } else if (event.type === "done") {
          update((m) => ({ ...m, pending: false, citations: event.citations }));
        } else {
          const notice = refusalText(event.code, lang, config);
          update((m) => ({
            ...m,
            pending: false,
            // Limits and "busy" are expected situations, shown as a calm notice rather than an error.
            notice: Boolean(notice),
            error: !notice,
            content: notice ?? ui(lang, event.code === "unavailable" ? "unavailable" : "error"),
          }));
        }
      }
    } catch {
      update((m) => ({ ...m, pending: false, error: true, content: m.content || ui(lang, "error") }));
    } finally {
      update((m) => ({ ...m, pending: false }));
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  // Buttons on the business page ("Ask about this", "Request a quote") send their text here.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!onPage) return;
    const onAsk = (event: Event) => {
      const text = (event as CustomEvent<unknown>).detail;
      if (typeof text === "string") void sendRef.current(text);
    };
    window.addEventListener("tb:ask", onAsk);
    return () => window.removeEventListener("tb:ask", onAsk);
  }, [onPage]);

  function newConversation() {
    setUrgent(null);
    conversationId.current = null;
    conversationStore.set(publicKey, null);
    setMessages([]);
    setImages([]);
    setImageError(null);
    inputRef.current?.focus();
  }

  function changeLanguage(code: string) {
    setLang(code);
    languageStore.set(publicKey, code);
  }

  function onKeyDown(event: KeyboardEvent) {
    // Don't send while an input method (Chinese, Japanese, Hindi…) is composing text.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      void send(input);
    }
  }

  if (failed) {
    return (
      <div class="tb-shell" data-mode={mode}>
        <p class="tb-empty">{ui(lang, "unavailable")}</p>
      </div>
    );
  }
  if (!config) return <div class="tb-shell" data-mode={mode} aria-busy="true" />;

  const { appearance } = config;
  const named = appearance.assistantName !== config.businessName;
  const greeting =
    config.greeting[lang] ??
    (named
      ? ui(lang, "greetingNamed", { name: appearance.assistantName, business: config.businessName })
      : ui(lang, "greeting", { business: config.businessName }));
  const quickReplies = config.quickReplies[lang] ?? config.quickReplies[lang === "fr" ? "fr" : "en"] ?? [];
  // Add-on buttons: only plain web links (the API validates them; this is defence in depth).
  const links = (config.links ?? []).filter((l) => /^https?:\/\//i.test(l.url));
  const palette = paletteFor(appearance.color, appearance.theme);
  const empty = messages.length === 0;

  const assistantRow = (key: string | undefined, className: string, children: ComponentChildren) => (
    <div key={key} class="tb-row">
      <Avatar avatar={appearance.avatar} size={28} />
      <div class={className} dir="auto">
        {children}
      </div>
    </div>
  );

  return (
    <div
      class="tb-shell"
      data-mode={mode}
      data-page={onPage ? "" : undefined}
      data-theme={appearance.theme}
      dir={dir}
      style={{
        "--tb-brand": palette.brand,
        "--tb-on-brand": palette.onBrand,
        "--tb-accent": palette.accent,
      }}
      {...dragHandlers}
    >
      {dragging && (
        <div class="tb-drop" aria-hidden="true">
          <span>{ui(lang, "dropHere")}</span>
        </div>
      )}
      <header class="tb-header">
        <div class="tb-header-inner">
          <div class="tb-title">
            <Avatar avatar={appearance.avatar} size={appearance.theme === "bold" && !onPage ? 48 : 34} />
            <div class="tb-names">
              <strong dir="auto">{appearance.assistantName}</strong>
              {named && (
                <span class="tb-subtitle" dir="auto">
                  {config.businessName}
                </span>
              )}
            </div>
          </div>
          <div class="tb-header-actions">
            {config.languages.length > 1 && (
              <select
                class="tb-lang"
                aria-label={ui(lang, "language")}
                value={lang}
                onChange={(e) => changeLanguage((e.target as HTMLSelectElement).value)}
              >
                {config.languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            )}
            {!empty && (
              <button
                type="button"
                class="tb-icon"
                onClick={newConversation}
                aria-label={ui(lang, "newChat")}
                title={ui(lang, "newChat")}
              >
                <Icon name="newChat" />
              </button>
            )}
            {mode === "widget" && (
              <button
                type="button"
                class="tb-icon"
                aria-label={ui(lang, "close")}
                onClick={() => window.parent.postMessage({ type: "tb:close" }, "*")}
              >
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* The business page already shows these buttons in its header. */}
      {links.length > 0 && !onPage && (
        <nav class="tb-links" aria-label={config.businessName}>
          {links.map((link) => (
            <a
              key={link.id}
              class="tb-link"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              dir="auto"
            >
              <Icon name={link.icon === "shop" ? "shop" : "link"} size={15} />
              {link.label ?? ui(lang, link.icon === "shop" ? "linkShop" : "linkOpen")}
            </a>
          ))}
        </nav>
      )}

      <div class="tb-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        <div class="tb-thread">
          {empty ? (
            // Before the first question: a welcome with the greeting and the suggested questions.
            <div class="tb-welcome">
              <Avatar avatar={appearance.avatar} size={64} />
              <div class="tb-welcome-text" data-long={greeting.length > 140 ? "" : undefined} dir="auto">
                <Markdown text={greeting} />
              </div>
              {quickReplies.length > 0 && (
                <div class="tb-chips">
                  {quickReplies.map((q) => (
                    <button key={q} type="button" class="tb-chip" onClick={() => void send(q)} dir="auto">
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            assistantRow(undefined, "tb-msg tb-assistant", <Markdown text={greeting} />)
          )}
          {messages.map((m) => {
            const className = `tb-msg tb-${m.role}${m.error ? " tb-error" : ""}${m.notice ? " tb-notice" : ""}`;
            if (m.role === "user") {
              return (
                <div key={m.id} class={className} dir="auto">
                  {m.attachments?.map((a, i) => (
                    <span key={i} class="tb-file" title={a.name}>
                      <Icon name="image" size={14} /> <bdi>{a.name}</bdi>
                    </span>
                  ))}
                  {m.content && <p>{m.content}</p>}
                </div>
              );
            }
            return assistantRow(
              m.id,
              className,
              <>
                {m.content ? (
                  <Markdown text={m.content} />
                ) : (
                  <span class="tb-typing" role="img" aria-label={ui(lang, "thinking")}>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
                {m.images && m.images.length > 0 && (
                  <div class="tb-photos">
                    {m.images.map((photo) => (
                      <a key={photo.url} href={photo.url} target="_blank" rel="noopener noreferrer">
                        <img src={photo.url} alt={photo.alt} loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
                {m.actions && m.actions.length > 0 && (
                  <div class="tb-actions">
                    {m.actions
                      .filter((a) =>
                        a.kind === "call"
                          ? /^tel:/.test(a.href ?? "")
                          : a.href
                            ? /^https?:\/\//i.test(a.href)
                            : Boolean(a.item),
                      )
                      .map((a) =>
                        a.item && !a.href ? (
                          // A quote or booking for one service: asked for here, in the chat.
                          <button
                            key={`${a.kind}:${a.item.id}`}
                            type="button"
                            class="tb-action"
                            disabled={busy}
                            onClick={() =>
                              void send(
                                ui(lang, a.kind === "quote" ? "quoteMessage" : "bookMessage", {
                                  item: a.item!.name,
                                }),
                              )
                            }
                          >
                            <Icon name="book" size={16} />
                            {ui(lang, a.kind === "quote" ? "actionQuoteItem" : "actionBookItem", {
                              item: a.item.name,
                            })}
                          </button>
                        ) : a.kind === "call" ? (
                          <a key={a.kind} class="tb-action tb-action-call" href={a.href}>
                            <Icon name="call" size={16} />
                            {config.contact.phone
                              ? ui(lang, "actionCall", { phone: config.contact.phone })
                              : ui(lang, "actionCallPlain")}
                          </a>
                        ) : (
                          <a
                            key={a.item ? `${a.kind}:${a.item.id}` : a.kind}
                            class="tb-action"
                            href={a.href}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Icon name="book" size={16} />
                            {a.item
                              ? ui(lang, "actionBookItem", { item: a.item.name })
                              : ui(lang, "actionBook")}
                          </a>
                        ),
                      )}
                  </div>
                )}
                {!m.pending && m.citations.some((c) => c.url) && (
                  <div class="tb-sources">
                    <span>{ui(lang, "sources")}</span>
                    {m.citations.map((c) =>
                      c.url ? (
                        <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer nofollow">
                          {c.title ?? new URL(c.url).pathname}
                        </a>
                      ) : null,
                    )}
                  </div>
                )}
              </>,
            );
          })}
        </div>
      </div>

      <div class="tb-dock">
        {urgent && (
          <div class="tb-urgent" data-level={urgent.level} role="alert">
            <strong>{ui(lang, urgent.level === "danger" ? "dangerTitle" : "urgentTitle")}</strong>
            {urgent.level === "danger" && <p class="tb-urgent-text">{ui(lang, "dangerText")}</p>}
            {urgent.phone && /\d/.test(urgent.phone) ? (
              <>
                <p class="tb-urgent-text">{ui(lang, "urgentText", { business: config.businessName })}</p>
                <a class="tb-action tb-action-call" href={`tel:${urgent.phone.replace(/[^\d+]/g, "")}`}>
                  <Icon name="call" size={16} />
                  {ui(lang, "actionCall", { phone: urgent.phone })}
                </a>
              </>
            ) : null}
          </div>
        )}
        <form
          class="tb-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          {(images.length > 0 || imageError) && (
            <div class="tb-attachments">
              {imageError && (
                <p class="tb-attach-error" role="alert">
                  {imageError}
                </p>
              )}
              {images.map((image) => (
                <span key={image.id} class="tb-file tb-file-pending" title={image.name}>
                  <Icon name="image" size={14} /> <bdi>{image.name}</bdi>
                  <button
                    type="button"
                    class="tb-file-remove"
                    aria-label={ui(lang, "removeImage", { name: image.name })}
                    onClick={() => setImages((list) => list.filter((i) => i.id !== image.id))}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div class="tb-composer-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/*"
              multiple
              hidden
              onChange={(e) => {
                const target = e.target as HTMLInputElement;
                void addImages(Array.from(target.files ?? []));
                target.value = "";
              }}
            />
            <button
              type="button"
              class="tb-attach"
              aria-label={ui(lang, "attach")}
              title={ui(lang, "attach")}
              disabled={busy || images.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="attach" size={20} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              dir="auto"
              maxLength={2000}
              value={input}
              placeholder={ui(lang, "placeholder")}
              aria-label={ui(lang, "placeholder")}
              onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
            />
            <button
              type="submit"
              class="tb-send"
              disabled={busy || (!input.trim() && !images.length)}
              aria-label={ui(lang, "send")}
              title={ui(lang, "send")}
            >
              <Icon name="send" size={20} />
            </button>
          </div>
        </form>
        <footer class="tb-footer">
          <span>{ui(lang, "disclaimer")}</span>
          {config.poweredBy && <span>{ui(lang, "poweredBy")}</span>}
        </footer>
      </div>
    </div>
  );
}
