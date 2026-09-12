CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_turns" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"query" text NOT NULL,
	"status" text NOT NULL,
	"answer" text,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;