ALTER TABLE `packets_seen` ADD `via` text;--> statement-breakpoint
-- A Notehub delivery stores its packet and its event with the same receipt time,
-- so earlier rows can be labelled exactly; everything else came over MQTT.
UPDATE `packets_seen` SET `via` = CASE
	WHEN EXISTS (
		SELECT 1 FROM `notehub_events` AS `e`
		WHERE `e`.`gateway_id` = `packets_seen`.`gateway_id`
			AND `e`.`received_at` = `packets_seen`.`received_at`
	) THEN 'notehub'
	ELSE 'mqtt'
END;
