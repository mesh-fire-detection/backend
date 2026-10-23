CREATE TABLE `notehub_events` (
    `event_id` text PRIMARY KEY NOT NULL,
    `gateway_id` text NOT NULL,
    `content_hash` text NOT NULL,
    `captured_at` integer NOT NULL,
    `received_at` integer NOT NULL,
    FOREIGN KEY (`gateway_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notehub_samples` (
    `source_hash` text PRIMARY KEY NOT NULL,
    `received_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `device_metrics` ADD `live_eligible` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `gateways` ADD `notehub_token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `gateways_notehubTokenHash_unique` ON `gateways` (`notehub_token_hash`);--> statement-breakpoint
ALTER TABLE `packets_seen` ADD `source_hash` text;--> statement-breakpoint
CREATE INDEX `packets_seen_source_hash_idx` ON `packets_seen` (`source_hash`);--> statement-breakpoint
ALTER TABLE `readings` ADD `live_eligible` integer DEFAULT true NOT NULL;
