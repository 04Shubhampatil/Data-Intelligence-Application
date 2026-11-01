-- CreateTable
CREATE TABLE `SuppressedRecord` (
    `id` VARCHAR(191) NOT NULL,
    `sourceConnectionId` VARCHAR(191) NOT NULL,
    `sourceEmployeeCode` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SuppressedRecord_sourceConnectionId_sourceEmployeeCode_key`(`sourceConnectionId`, `sourceEmployeeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SuppressedRecord` ADD CONSTRAINT `SuppressedRecord_sourceConnectionId_fkey` FOREIGN KEY (`sourceConnectionId`) REFERENCES `SourceConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
