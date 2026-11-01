-- AlterTable
ALTER TABLE `candidate` ADD COLUMN `departmentId` VARCHAR(191) NULL,
    ADD COLUMN `sourceStatus` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `sourceconnection` ADD COLUMN `authMode` ENUM('MANUAL_SESSION', 'CREDENTIALS') NOT NULL DEFAULT 'MANUAL_SESSION',
    ADD COLUMN `encryptedSession` MEDIUMTEXT NULL,
    ADD COLUMN `sessionSavedAt` DATETIME(3) NULL,
    MODIFY `username` VARCHAR(191) NULL,
    MODIFY `encryptedSecret` TEXT NULL;

-- CreateTable
CREATE TABLE `Department` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Department_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Candidate_departmentId_idx` ON `Candidate`(`departmentId`);

-- AddForeignKey
ALTER TABLE `Candidate` ADD CONSTRAINT `Candidate_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
