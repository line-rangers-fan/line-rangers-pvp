ALTER TABLE `users` ADD `display_name_set` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `users_display_name_set` ON `users` (`display_name_set`,`created`);