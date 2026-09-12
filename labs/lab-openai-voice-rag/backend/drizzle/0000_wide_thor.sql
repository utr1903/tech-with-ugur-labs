CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"filename" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_filename_documents_filename_fk" FOREIGN KEY ("filename") REFERENCES "public"."documents"("filename") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunk_document_ordinal" ON "chunks" USING btree ("filename","ordinal");