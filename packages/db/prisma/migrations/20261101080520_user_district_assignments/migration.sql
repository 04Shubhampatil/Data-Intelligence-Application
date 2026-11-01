-- Replaces the implicit User<->District join table with an explicit assignment table.
-- Order matters: create the new table, COPY existing scope rows, then drop the old table.

-- CreateTable
CREATE TABLE `UserDistrictAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `districtId` VARCHAR(191) NOT NULL,
    `assignedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserDistrictAssignment_districtId_idx`(`districtId`),
    UNIQUE INDEX `UserDistrictAssignment_userId_districtId_key`(`userId`, `districtId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Copy existing scopes. In the implicit table, A = District.id and B = User.id (models ordered alphabetically).
INSERT INTO `UserDistrictAssignment` (`id`, `userId`, `districtId`, `assignedById`, `createdAt`)
SELECT CONCAT('mig_', SUBSTRING(MD5(CONCAT(`B`, ':', `A`)), 1, 20)), `B`, `A`, NULL, CURRENT_TIMESTAMP(3)
FROM `_userdistrictscope`;

-- AddForeignKey
ALTER TABLE `UserDistrictAssignment` ADD CONSTRAINT `UserDistrictAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDistrictAssignment` ADD CONSTRAINT `UserDistrictAssignment_districtId_fkey` FOREIGN KEY (`districtId`) REFERENCES `District`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDistrictAssignment` ADD CONSTRAINT `UserDistrictAssignment_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE `_userdistrictscope` DROP FOREIGN KEY `_UserDistrictScope_A_fkey`;

-- DropForeignKey
ALTER TABLE `_userdistrictscope` DROP FOREIGN KEY `_UserDistrictScope_B_fkey`;

-- DropTable
DROP TABLE `_userdistrictscope`;
