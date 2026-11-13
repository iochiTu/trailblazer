import type { CrmLead } from "./types.js";

const TEXT = {
  en: {
    kind: {
      callback: "Call back",
      quote: "Quote request",
      booking: "Booking request",
      question: "Question",
      complaint: "Complaint",
      other: "Request",
    } as Record<string, string>,
    urgent: "URGENT",
    from: (business: string) => `From the website assistant of ${business}`,
    bestTime: "Best time to reach",
    language: "Language",
    photos: (n: number) => (n === 1 ? "1 photo sent" : `${n} photos sent`),
    open: "Open the request",
  },
  fr: {
    kind: {
      callback: "Rappel",
      quote: "Demande de soumission",
      booking: "Demande de réservation",
      question: "Question",
      complaint: "Plainte",
      other: "Demande",
    } as Record<string, string>,
    urgent: "URGENT",
    from: (business: string) => `De l'assistant du site de ${business}`,
    bestTime: "Meilleur moment pour joindre",
    language: "Langue",
    photos: (n: number) => (n === 1 ? "1 photo envoyée" : `${n} photos envoyées`),
    open: "Ouvrir la demande",
  },
};

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** A short title for the CRM record, e.g. "URGENT · Quote request: Jean Tremblay". */
export function leadTitle(lead: CrmLead, max = 120): string {
  const t = TEXT[lead.ownerLanguage];
  const title = `${lead.urgent ? `${t.urgent} · ` : ""}${t.kind[lead.kind] ?? t.kind.other}: ${flat(lead.name)}`;
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

/** Everything staff need, as plain text for a CRM's notes or description box. */
export function leadNotes(lead: CrmLead): string {
  const t = TEXT[lead.ownerLanguage];
  return [
    lead.message.trim(),
    "",
    ...lead.details.map((d) => `${d.label}: ${d.value}`),
    lead.bestTime ? `${t.bestTime}: ${lead.bestTime}` : null,
    lead.language ? `${t.language}: ${lead.language}` : null,
    lead.photoCount ? t.photos(lead.photoCount) : null,
    lead.requestUrl ? `${t.open}: ${lead.requestUrl}` : null,
    "",
    `— ${t.from(lead.businessName)}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** "Jean-Luc Tremblay" → first and last name; a single word becomes the first name. */
export function splitName(name: string): { first: string; last: string } {
  const parts = flat(name).split(" ");
  if (parts.length < 2) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1)! };
}

/** Digits only (with a leading + kept), for CRMs that reject formatted phone numbers. */
export const phoneDigits = (phone: string) => phone.replace(/(?!^\+)\D/g, "");
