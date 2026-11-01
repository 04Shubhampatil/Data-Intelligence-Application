-- AlterTable
ALTER TABLE `candidate` ADD COLUMN `reviewPendingConfirmation` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reviewStatus` ENUM('PENDING_REVIEW', 'SELECTED', 'REJECTED') NOT NULL DEFAULT 'PENDING_REVIEW',
    ADD COLUMN `reviewUpdated` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reviewedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `CandidateReview` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `decision` ENUM('SELECTED', 'REJECTED') NOT NULL,
    `remark` TEXT NOT NULL,
    `previousStatus` ENUM('PENDING_REVIEW', 'SELECTED', 'REJECTED') NOT NULL,
    `newStatus` ENUM('PENDING_REVIEW', 'SELECTED', 'REJECTED') NOT NULL,
    `isOverride` BOOLEAN NOT NULL DEFAULT false,
    `overridesId` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NOT NULL,
    `districtId` VARCHAR(191) NULL,
    `requiresConfirmation` BOOLEAN NOT NULL DEFAULT false,
    `confirmedById` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CandidateReview_candidateId_createdAt_idx`(`candidateId`, `createdAt`),
    INDEX `CandidateReview_districtId_createdAt_idx`(`districtId`, `createdAt`),
    INDEX `CandidateReview_reviewedById_createdAt_idx`(`reviewedById`, `createdAt`),
    INDEX `CandidateReview_requiresConfirmation_confirmedAt_idx`(`requiresConfirmation`, `confirmedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CandidateComment` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CandidateComment_candidateId_createdAt_idx`(`candidateId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Candidate_reviewStatus_idx` ON `Candidate`(`reviewStatus`);

-- AddForeignKey
ALTER TABLE `CandidateReview` ADD CONSTRAINT `CandidateReview_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateReview` ADD CONSTRAINT `CandidateReview_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateReview` ADD CONSTRAINT `CandidateReview_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateComment` ADD CONSTRAINT `CandidateComment_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateComment` ADD CONSTRAINT `CandidateComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
