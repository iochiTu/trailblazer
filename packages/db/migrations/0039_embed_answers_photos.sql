ALTER TABLE "knowledge_images" ADD COLUMN "embedding" halfvec;--> statement-breakpoint
ALTER TABLE "knowledge_images" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "knowledge_images" ADD COLUMN "embedding_hash" text;--> statement-breakpoint
ALTER TABLE "qa_pairs" ADD COLUMN "embedding" halfvec;--> statement-breakpoint
ALTER TABLE "qa_pairs" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "qa_pairs" ADD COLUMN "embedding_hash" text;