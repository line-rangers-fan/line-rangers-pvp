CREATE INDEX IF NOT EXISTS `posts_media_group_scope` ON `posts` (`media_group`,`board`,`author`,`parent`,`status`,`created`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `upload_sessions_media_group_scope` ON `upload_sessions` (`media_group`,`board`,`user`,`status`,`created`);
