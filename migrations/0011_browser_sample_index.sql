DROP INDEX `readings_browser_measurement_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `readings_browser_sample_idx` ON `readings` (`node_id`,`metric`,`recorded_at`) WHERE source = 'browser';