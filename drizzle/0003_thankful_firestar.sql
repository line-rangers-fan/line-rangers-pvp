CREATE TABLE `upload_parts` (
	`session` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`session`, `part_number`),
	FOREIGN KEY (`session`) REFERENCES `upload_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`board` text NOT NULL,
	`body` text NOT NULL,
	`request` text NOT NULL,
	`media_key` text NOT NULL,
	`media_type` text NOT NULL,
	`media_name` text NOT NULL,
	`media_size` integer NOT NULL,
	`upload_id` text NOT NULL,
	`part_size` integer NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`post` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_sessions_user_request` ON `upload_sessions` (`user`,`request`);--> statement-breakpoint
CREATE INDEX `upload_sessions_user_status` ON `upload_sessions` (`user`,`status`,`updated`);