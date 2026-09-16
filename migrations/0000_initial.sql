CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `alert_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` text NOT NULL,
	`status` text NOT NULL,
	`actor_id` text,
	`at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alert_events_alert_idx` ON `alert_events` (`alert_id`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`device_id` text,
	`metric` text NOT NULL,
	`comparison` text NOT NULL,
	`threshold` real NOT NULL,
	`duration_s` integer NOT NULL,
	`cooldown_s` integer NOT NULL,
	`enabled` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alert_rules_metric_idx` ON `alert_rules` (`metric`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`rule_id` text,
	`device_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger_value` real,
	`opened_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alerts_status_idx` ON `alerts` (`status`);--> statement-breakpoint
CREATE INDEX `alerts_rule_device_idx` ON `alerts` (`rule_id`,`device_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `alerts_kind_device_idx` ON `alerts` (`kind`,`device_id`,`status`);--> statement-breakpoint
CREATE TABLE `device_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`battery_pct` real,
	`voltage` real,
	`uptime_s` integer,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `device_metrics_device_time_idx` ON `device_metrics` (`device_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`node_num` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`longitude` real NOT NULL,
	`latitude` real NOT NULL,
	`elevation_m` real NOT NULL,
	`antenna_height_m` real NOT NULL,
	`firmware` text NOT NULL,
	`deployed_on` text NOT NULL,
	`note` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_heard_at` integer,
	`reported_name` text,
	`reported_longitude` real,
	`reported_latitude` real,
	`reported_altitude_m` real,
	`reported_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_nodeNum_unique` ON `devices` (`node_num`);--> statement-breakpoint
CREATE TABLE `gateways` (
	`device_id` text PRIMARY KEY NOT NULL,
	`mqtt_username` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gateways_mqttUsername_unique` ON `gateways` (`mqtt_username`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_tokenHash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `link_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_device_id` text NOT NULL,
	`to_device_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`snr` real NOT NULL,
	`rssi` real,
	FOREIGN KEY (`from_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `link_observations_time_idx` ON `link_observations` (`observed_at`);--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_channels_user_kind_target_idx` ON `notification_channels` (`user_id`,`kind`,`target`);--> statement-breakpoint
CREATE TABLE `packets_seen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_node_num` integer NOT NULL,
	`packet_id` integer NOT NULL,
	`gateway_id` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`gateway_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `packets_seen_key_idx` ON `packets_seen` (`from_node_num`,`packet_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `readings_device_time_idx` ON `readings` (`device_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `readings_device_metric_time_idx` ON `readings` (`device_id`,`metric`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
