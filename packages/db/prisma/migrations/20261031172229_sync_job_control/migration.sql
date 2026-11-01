-- AlterTable
ALTER TABLE `candidate` ADD COLUMN `profileSyncedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `sourceconnection` ADD COLUMN `sourceFilters` JSON NULL;

-- AlterTable
ALTER TABLE `syncjob` ADD COLUMN `cancelRequested` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `heartbeatAt` DATETIME(3) NULL,
    ADD COLUMN `retryOfJobId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `SyncError_syncJobId_resolvedAt_idx` ON `SyncError`(`syncJobId`, `resolvedAt`);

-- CreateIndex
CREATE INDEX `SyncJob_status_createdAt_idx` ON `SyncJob`(`status`, `createdAt`);
