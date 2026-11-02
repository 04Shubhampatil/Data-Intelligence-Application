-- AlterTable
ALTER TABLE `candidateprofile` ADD COLUMN `personalEncrypted` TEXT NULL,
    ADD COLUMN `personalHash` VARCHAR(64) NULL,
    ADD COLUMN `personalSyncedAt` DATETIME(3) NULL;
