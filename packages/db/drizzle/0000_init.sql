CREATE TABLE "client_error" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text,
	"error_name" text NOT NULL,
	"error_code" text,
	"route" text,
	"status_code" integer,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_event" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"action" text NOT NULL,
	"policy_version" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_event_scope_allowed" CHECK ("scope" in ('basic_service', 'sensitive_pi', 'research_l0', 'research_l1', 'persona_evolution')),
	CONSTRAINT "consent_event_action_allowed" CHECK ("action" in ('grant', 'revoke'))
);
--> statement-breakpoint
CREATE TABLE "dependency_signal" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependency_signal_rule_id_allowed" CHECK ("rule_id" in ('daily_usage_over_3h', 'seven_consecutive_days', 'late_night_share_over_40pct'))
);
--> statement-breakpoint
CREATE TABLE "exit_intent" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"tier" integer NOT NULL,
	"matched_rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exit_intent_tier_allowed" CHECK ("tier" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "llm_call" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"turn_id" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"requested_model" text NOT NULL,
	"model_snapshot" text NOT NULL,
	"resolved_model" text,
	"provider_request_id" text,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"persona_version_id" text,
	"thinking_mode" text,
	"temperature" real,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cached_tokens" integer,
	"price_tier" text,
	"latency_ms" integer NOT NULL,
	"user_id" text,
	"conversation_id" text,
	"retrieved_memory_ids" jsonb,
	"recall_scores" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_call_purpose_allowed" CHECK ("purpose" in ('chat.reply', 'chat.reply.frontier', 'persona.reflect', 'persona.probe', 'memory.extract', 'safety.classify'))
);
--> statement-breakpoint
CREATE TABLE "privacy_action" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_action_kind_allowed" CHECK ("kind" in ('export', 'delete', 'revoke'))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_contact" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"contact_ref_encrypted" text NOT NULL,
	"reachability" text DEFAULT 'unconfirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_contact_kind_allowed" CHECK ("kind" in ('guardian', 'emergency')),
	CONSTRAINT "emergency_contact_reachability_allowed" CHECK ("reachability" in ('unconfirmed', 'confirmed'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"birth_date" date NOT NULL,
	"invite_code_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"avatar" text NOT NULL,
	"blurb" text NOT NULL,
	"current_persona_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_version" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"character_id" text NOT NULL,
	"parent_id" text,
	"core" jsonb NOT NULL,
	"traits" jsonb NOT NULL,
	"dossier" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model_snapshot" text NOT NULL,
	"is_healthy" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_version_no_self_parent" CHECK (parent_id is null or parent_id <> id)
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_pkey" PRIMARY KEY("user_id","scope"),
	CONSTRAINT "consent_scope_allowed" CHECK ("scope" in ('basic_service', 'sensitive_pi', 'research_l0', 'research_l1', 'persona_evolution'))
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"counterpart_kind" text DEFAULT 'ai_character' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_seq" integer DEFAULT 1 NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "conversation_counterpart_kind_allowed" CHECK ("counterpart_kind" in ('ai_character')),
	CONSTRAINT "conversation_status_allowed" CHECK ("status" in ('active', 'ended')),
	CONSTRAINT "conversation_next_seq_positive" CHECK ("next_seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "friendship" (
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"relationship" text DEFAULT 'stranger' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_pkey" PRIMARY KEY("user_id","character_id"),
	CONSTRAINT "friendship_relationship_allowed" CHECK ("relationship" in ('stranger'))
);
--> statement-breakpoint
CREATE TABLE "invite_code" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"conversation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"sender_kind" text NOT NULL,
	"text" text NOT NULL,
	"disclosure" jsonb,
	"provenance" jsonb NOT NULL,
	"audience" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_sender_kind_allowed" CHECK ("sender_kind" in ('user', 'character', 'system')),
	CONSTRAINT "message_audience_allowed" CHECK ("audience" in ('user', 'other_character')),
	CONSTRAINT "message_disclosure_required" CHECK ("sender_kind" <> 'character' or "disclosure" is not null),
	CONSTRAINT "message_seq_positive" CHECK ("seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "contact_attempt" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"safety_event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"contact_ref" text NOT NULL,
	"status" text NOT NULL,
	"alert_sent_at" timestamp with time zone,
	"operator_ack_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_attempt_status_allowed" CHECK ("status" in ('pending', 'delivered', 'failed', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "safety_event" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"level" text NOT NULL,
	"rule_hits" jsonb NOT NULL,
	"classifier_status" text NOT NULL,
	"classifier_model_snapshot" text,
	"candidate_reply_hash" text NOT NULL,
	"candidate_reply_len" integer NOT NULL,
	"override_applied" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_event_level_allowed" CHECK ("level" in ('none', 'watch', 'elevated', 'crisis')),
	CONSTRAINT "safety_event_classifier_status_allowed" CHECK ("classifier_status" in ('ok', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "session_risk_state" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'none' NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decay_after" timestamp with time zone,
	"cleared_by" text,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "session_risk_state_level_allowed" CHECK ("level" in ('none', 'watch', 'elevated', 'crisis'))
);
--> statement-breakpoint
CREATE TABLE "usage_segment" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"accumulated_seconds" integer DEFAULT 0 NOT NULL,
	"reminded_count" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_error" ADD CONSTRAINT "client_error_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_signal" ADD CONSTRAINT "dependency_signal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_intent" ADD CONSTRAINT "exit_intent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_intent" ADD CONSTRAINT "exit_intent_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_action" ADD CONSTRAINT "privacy_action_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contact" ADD CONSTRAINT "emergency_contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_invite_code_id_invite_code_code_fk" FOREIGN KEY ("invite_code_id") REFERENCES "public"."invite_code"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_current_persona_version_id_persona_version_id_fk" FOREIGN KEY ("current_persona_version_id") REFERENCES "public"."persona_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_version" ADD CONSTRAINT "persona_version_character_id_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_version" ADD CONSTRAINT "persona_version_parent_id_persona_version_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."persona_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_character_id_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_character_id_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_attempt" ADD CONSTRAINT "contact_attempt_safety_event_id_safety_event_id_fk" FOREIGN KEY ("safety_event_id") REFERENCES "public"."safety_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_attempt" ADD CONSTRAINT "contact_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_event" ADD CONSTRAINT "safety_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_event" ADD CONSTRAINT "safety_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_event" ADD CONSTRAINT "safety_event_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_risk_state" ADD CONSTRAINT "session_risk_state_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_segment" ADD CONSTRAINT "usage_segment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_error_created_at_idx" ON "client_error" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "consent_event_user_id_idx" ON "consent_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dependency_signal_user_rule_idx" ON "dependency_signal" USING btree ("user_id","rule_id");--> statement-breakpoint
CREATE INDEX "exit_intent_user_id_idx" ON "exit_intent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_call_turn_id_idx" ON "llm_call" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "llm_call_user_id_idx" ON "llm_call" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "privacy_action_user_id_idx" ON "privacy_action" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "emergency_contact_user_id_idx" ON "emergency_contact" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "persona_version_character_id_idx" ON "persona_version" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "conversation_user_id_idx" ON "conversation" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_conversation_seq_unique" ON "message" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "message_conversation_created_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_attempt_user_id_idx" ON "contact_attempt" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "safety_event_user_id_idx" ON "safety_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "safety_event_conversation_id_idx" ON "safety_event" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "usage_segment_user_open_idx" ON "usage_segment" USING btree ("user_id","closed_at");