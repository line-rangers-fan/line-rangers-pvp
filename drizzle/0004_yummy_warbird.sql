CREATE INDEX `posts_parent_status_created` ON `posts` (`parent`,`status`,`created`);--> statement-breakpoint
CREATE INDEX `posts_board_status_created` ON `posts` (`board`,`status`,`created`);