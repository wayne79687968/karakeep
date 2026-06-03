CREATE TABLE `assistantConversations` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`createdAt` integer NOT NULL,
	`modifiedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistantConversations_userId_idx` ON `assistantConversations` (`userId`);--> statement-breakpoint
CREATE INDEX `assistantConversations_modifiedAt_idx` ON `assistantConversations` (`modifiedAt`);--> statement-breakpoint
CREATE TABLE `assistantMessages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`sources` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`conversationId`) REFERENCES `assistantConversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistantMessages_conversationId_idx` ON `assistantMessages` (`conversationId`);