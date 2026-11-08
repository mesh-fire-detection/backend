CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`severity` text NOT NULL,
	`type` text NOT NULL,
	`subject_kind` text,
	`subject_id` text,
	`count` integer DEFAULT 1 NOT NULL,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `events_at_idx` ON `events` (`at`);--> statement-breakpoint
CREATE INDEX `notehub_events_gateway_idx` ON `notehub_events` (`gateway_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `packets_seen_gateway_idx` ON `packets_seen` (`gateway_id`,`received_at`);