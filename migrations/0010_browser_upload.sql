CREATE TABLE `node_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	`uploaded_by_id` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_events_node_kind_at_idx` ON `node_events` (`node_id`,`kind`,`at`);--> statement-breakpoint
ALTER TABLE `nodes` ADD `short_name` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `settings` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `settings_reported_at` integer;--> statement-breakpoint
ALTER TABLE `readings` ADD `measured_at` integer;--> statement-breakpoint
ALTER TABLE `readings` ADD `source` text;--> statement-breakpoint
ALTER TABLE `readings` ADD `uploaded_by_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `readings_node_metric_measured_idx` ON `readings` (`node_id`,`metric`,`measured_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `readings_browser_measurement_idx` ON `readings` (`node_id`,`metric`,`measured_at`) WHERE source = 'browser';