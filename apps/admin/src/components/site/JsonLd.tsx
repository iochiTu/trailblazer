import { serializeLd } from "@traiblazer/marketing";

/** schema.org structured data for search engines and AI assistants. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: our own data, serialized with the less-than sign escaped
      dangerouslySetInnerHTML={{ __html: serializeLd(data) }}
    />
  );
}
