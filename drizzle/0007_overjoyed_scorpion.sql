CREATE TABLE `post_reports` (
	`post` text NOT NULL,
	`reporter` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`post`, `reporter`),
	FOREIGN KEY (`post`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_reports_created` ON `post_reports` (`created`);