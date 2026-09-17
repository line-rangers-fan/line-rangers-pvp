CREATE INDEX IF NOT EXISTS `posts_board_parent_status_pinned_created_id` ON `posts` (`board`,`parent`,`status`,`pinned`,`created`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `posts_status_created_id` ON `posts` (`status`,`created`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `limits_until` ON `limits` (`until`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `upload_sessions_status_updated` ON `upload_sessions` (`status`,`updated`);
