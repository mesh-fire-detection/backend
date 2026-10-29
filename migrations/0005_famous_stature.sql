CREATE TABLE `member_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`node_num` integer NOT NULL,
	`name` text,
	`hardware` text,
	`firmware` text,
	`connected_at` integer,
	`added_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_nodes_user_node_idx` ON `member_nodes` (`user_id`,`node_num`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`consent_text` text NOT NULL,
	`confirm_token_hash` text,
	`confirm_sent_at` integer,
	`confirmed_at` integer,
	`unsubscribed_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_confirmTokenHash_unique` ON `subscriptions` (`confirm_token_hash`);--> statement-breakpoint
ALTER TABLE `users` ADD `node_join_requested_at` integer;