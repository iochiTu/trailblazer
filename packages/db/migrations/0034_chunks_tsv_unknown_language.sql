-- Search vectors of text in an unknown language (pasted text, files, pages without a lang attribute)
-- held only unstemmed words, so a search for "senior" missed "Seniors get 10% off". Rebuilt here
-- with English and French stemming too, as tsvectorSql() in packages/core now writes them.
UPDATE "chunks"
SET "tsv" = to_tsvector('simple', concat_ws(E'\n', "heading", "content"))
  || to_tsvector('english', concat_ws(E'\n', "heading", "content"))
  || to_tsvector('french', concat_ws(E'\n', "heading", "content"))
WHERE "language" IS NULL OR btrim("language") = '';
--> statement-breakpoint
UPDATE "knowledge_images"
SET "tsv" = to_tsvector('simple', "title" || E'\n' || "description")
  || to_tsvector('english', "title" || E'\n' || "description")
  || to_tsvector('french', "title" || E'\n' || "description")
WHERE "language" IS NULL OR btrim("language") = '';
