CREATE TABLE `helpful` (
	`post` text NOT NULL,
	`user` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`post`, `user`),
	FOREIGN KEY (`post`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`subject` text PRIMARY KEY NOT NULL,
	`seen` integer NOT NULL
);
