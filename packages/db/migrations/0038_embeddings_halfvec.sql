-- Search by meaning (docs/EMBEDDINGS.md): half-precision vectors (half the space, same ranking for
-- our purposes), and a hash of each chunk's searchable text so unchanged text keeps its vector.
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec USING "embedding"::halfvec;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_hash" text;--> statement-breakpoint
-- Same text as the app hashes: heading, a new line and the content, or the content alone.
UPDATE "chunks" SET "content_hash" = encode(
  sha256(convert_to(
    CASE WHEN coalesce("heading", '') = '' THEN "content" ELSE "heading" || E'\n' || "content" END,
    'UTF8')),
  'hex');
