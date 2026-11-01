-- Devices are nodes (October 29, 2026): the site already called them that, and
-- the code now does too. `device_metrics` keeps its name, after Meshtastic's
-- DeviceMetrics telemetry it stores. SQLite rewrites the foreign keys that point
-- at a renamed table or column, and moves indexes with them; only the index
-- names still say "device", so those are rebuilt.
ALTER TABLE `devices` RENAME TO `nodes`;--> statement-breakpoint
ALTER TABLE `gateways` RENAME COLUMN `device_id` TO `node_id`;--> statement-breakpoint
ALTER TABLE `device_metrics` RENAME COLUMN `device_id` TO `node_id`;--> statement-breakpoint
ALTER TABLE `readings` RENAME COLUMN `device_id` TO `node_id`;--> statement-breakpoint
ALTER TABLE `link_observations` RENAME COLUMN `from_device_id` TO `from_node_id`;--> statement-breakpoint
ALTER TABLE `link_observations` RENAME COLUMN `to_device_id` TO `to_node_id`;--> statement-breakpoint
ALTER TABLE `alert_rules` RENAME COLUMN `device_id` TO `node_id`;--> statement-breakpoint
ALTER TABLE `alerts` RENAME COLUMN `device_id` TO `node_id`;--> statement-breakpoint
DROP INDEX `devices_nodeNum_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_nodeNum_unique` ON `nodes` (`node_num`);--> statement-breakpoint
DROP INDEX `device_metrics_device_time_idx`;--> statement-breakpoint
CREATE INDEX `device_metrics_node_time_idx` ON `device_metrics` (`node_id`,`recorded_at`);--> statement-breakpoint
DROP INDEX `readings_device_time_idx`;--> statement-breakpoint
CREATE INDEX `readings_node_time_idx` ON `readings` (`node_id`,`recorded_at`);--> statement-breakpoint
DROP INDEX `readings_device_metric_time_idx`;--> statement-breakpoint
CREATE INDEX `readings_node_metric_time_idx` ON `readings` (`node_id`,`metric`,`recorded_at`);--> statement-breakpoint
DROP INDEX `alerts_rule_device_idx`;--> statement-breakpoint
CREATE INDEX `alerts_rule_node_idx` ON `alerts` (`rule_id`,`node_id`,`opened_at`);--> statement-breakpoint
DROP INDEX `alerts_kind_device_idx`;--> statement-breakpoint
CREATE INDEX `alerts_kind_node_idx` ON `alerts` (`kind`,`node_id`,`status`);
