ALTER TABLE `posts` ADD `media_group` text;
--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `media_group` text;
--> statement-breakpoint
CREATE INDEX `posts_media_group` ON `posts` (`media_group`,`created`);
--> statement-breakpoint
CREATE INDEX `upload_sessions_media_group` ON `upload_sessions` (`media_group`,`created`);
