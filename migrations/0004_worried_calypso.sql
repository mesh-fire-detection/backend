DROP INDEX `invites_tokenHash_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_email_unique` ON `invites` (`email`);--> statement-breakpoint
ALTER TABLE `invites` DROP COLUMN `token_hash`;--> statement-breakpoint
ALTER TABLE `invites` DROP COLUMN `expires_at`;--> statement-breakpoint
ALTER TABLE `users` ADD `status` text DEFAULT 'member' NOT NULL;