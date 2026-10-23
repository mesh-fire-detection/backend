PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gateways` (
    `device_id` text PRIMARY KEY NOT NULL,
    `mqtt_username` text,
    `notecard_uid` text,
    `enabled` integer DEFAULT true NOT NULL,
    `created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
    `updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
    FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_gateways`("device_id", "mqtt_username", "notecard_uid", "enabled", "created_at", "updated_at") SELECT "device_id", "mqtt_username", NULL, "enabled", "created_at", "updated_at" FROM `gateways`;--> statement-breakpoint
DROP TABLE `gateways`;--> statement-breakpoint
ALTER TABLE `__new_gateways` RENAME TO `gateways`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `gateways_mqttUsername_unique` ON `gateways` (`mqtt_username`);--> statement-breakpoint
CREATE UNIQUE INDEX `gateways_notecardUid_unique` ON `gateways` (`notecard_uid`);
