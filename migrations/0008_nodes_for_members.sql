-- Members register nodes (docs/plans/nodes.md). Only identity stays required,
-- so the deployment columns become nullable, which SQLite does by rebuilding
-- the table. Foreign keys are off while migrations run (src/shared/db/connection.ts).
CREATE TABLE `node_members` (
	`node_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`node_id`, `user_id`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `node_members_user_idx` ON `node_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`node_num` integer NOT NULL,
	`hardware_id` text,
	`name` text NOT NULL,
	`type` text,
	`longitude` real,
	`latitude` real,
	`exact_position` integer DEFAULT false NOT NULL,
	`elevation_m` real,
	`antenna_height_m` real,
	`hardware` text,
	`firmware` text,
	`deployed_on` text,
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
INSERT INTO `__new_nodes`("id", "node_num", "name", "type", "longitude", "latitude", "elevation_m", "antenna_height_m", "firmware", "deployed_on", "note", "enabled", "last_heard_at", "reported_name", "reported_longitude", "reported_latitude", "reported_altitude_m", "reported_at", "created_at", "updated_at") SELECT "id", "node_num", "name", "type", "longitude", "latitude", "elevation_m", "antenna_height_m", "firmware", "deployed_on", "note", "enabled", "last_heard_at", "reported_name", "reported_longitude", "reported_latitude", "reported_altitude_m", "reported_at", "created_at", "updated_at" FROM `nodes`;--> statement-breakpoint
DROP TABLE `nodes`;--> statement-breakpoint
ALTER TABLE `__new_nodes` RENAME TO `nodes`;--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_nodeNum_unique` ON `nodes` (`node_num`);--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_hardwareId_unique` ON `nodes` (`hardware_id`);;--> statement-breakpoint
-- Every node a member brought becomes a registered node with them on it. A
-- number already registered just gains the member. New IDs continue the n-
-- sequence; the name falls back to the mesh ID when the node gave none.
INSERT INTO `nodes` (`id`, `node_num`, `name`, `hardware`, `firmware`, `created_at`, `updated_at`)
SELECT 'n-' || printf('%04d', (SELECT count(*) FROM `nodes` WHERE `id` GLOB 'n-[0-9]*') + row_number() OVER (ORDER BY `first_added`, `node_num`)),
    `node_num`, coalesce(`name`, printf('!%08x', `node_num`)), `hardware`, `firmware`, `first_added`, `first_added`
FROM (
    SELECT `node_num`, min(`added_at`) AS `first_added`, max(`name`) AS `name`, max(`hardware`) AS `hardware`, max(`firmware`) AS `firmware`
    FROM `member_nodes`
    WHERE `node_num` NOT IN (SELECT `node_num` FROM `nodes`)
    GROUP BY `node_num`
);--> statement-breakpoint
INSERT INTO `node_members` (`node_id`, `user_id`, `added_at`)
SELECT `nodes`.`id`, `member_nodes`.`user_id`, `member_nodes`.`added_at`
FROM `member_nodes` JOIN `nodes` ON `nodes`.`node_num` = `member_nodes`.`node_num`;
