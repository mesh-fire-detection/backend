-- Members get project updates by default (October 28, 2026). Enrol every
-- member who has no subscription row yet; anyone who already has one, including
-- an unsubscribe, is left exactly as they are. The wording matches
-- DEFAULT_CONSENT in src/shared/auth/membership.ts.
INSERT INTO `subscriptions` (`user_id`, `status`, `source`, `consent_text`, `confirmed_at`)
SELECT `id`, 'confirmed', 'default', 'Members get project updates by default.', (unixepoch('subsec') * 1000)
FROM `users`
WHERE `status` = 'member'
  AND `id` NOT IN (SELECT `user_id` FROM `subscriptions`);
