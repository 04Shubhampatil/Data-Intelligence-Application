-- AlterTable
ALTER TABLE `syncjob` ADD COLUMN `scheduleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `SyncSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `sourceConnectionId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `frequency` ENUM('HOURLY', 'DAILY', 'WEEKLY') NOT NULL,
    `minute` INTEGER NOT NULL DEFAULT 0,
    `hour` INTEGER NOT NULL DEFAULT 2,
    `weekday` INTEGER NOT NULL DEFAULT 1,
    `options` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastJobId` VARCHAR(191) NULL,
    `lastStatus` ENUM('QUEUED', 'RUNNING', 'AWAITING_MFA', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED') NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SyncSchedule_enabled_nextRunAt_idx`(`enabled`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemStatus` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SyncSchedule` ADD CONSTRAINT `SyncSchedule_sourceConnectionId_fkey` FOREIGN KEY (`sourceConnectionId`) REFERENCES `SourceConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncSchedule` ADD CONSTRAINT `SyncSchedule_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
