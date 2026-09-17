CREATE TABLE `user_badges` (
	`user` text NOT NULL,
	`badge` text NOT NULL,
	`granted_by` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user`, `badge`),
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_badges_user` ON `user_badges` (`user`);