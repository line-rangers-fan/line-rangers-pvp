CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`character` text NOT NULL,
	`name` text NOT NULL,
	`image` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_character_month` ON `boards` (`month`,`character`);--> statement-breakpoint
CREATE TABLE `likes` (
	`post` text NOT NULL,
	`user` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`post`, `user`),
	FOREIGN KEY (`post`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`board` text NOT NULL,
	`author` text NOT NULL,
	`parent` text,
	`body` text NOT NULL,
	`video` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`request` text NOT NULL,
	FOREIGN KEY (`board`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_board_parent` ON `posts` (`board`,`parent`,`status`,`created`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_author_request` ON `posts` (`author`,`request`);--> statement-breakpoint
CREATE TABLE `translations` (
	`post` text NOT NULL,
	`language` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`post`, `language`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_subject_unique` ON `users` (`subject`);--> statement-breakpoint
CREATE TABLE `votes` (
	`board` text NOT NULL,
	`user` text NOT NULL,
	`poll` text NOT NULL,
	`choice` integer NOT NULL,
	PRIMARY KEY(`board`, `user`, `poll`),
	FOREIGN KEY (`board`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
