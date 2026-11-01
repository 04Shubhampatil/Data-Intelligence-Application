-- CreateTable
CREATE TABLE `CandidateDocument` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `kind` ENUM('PROFILE_PHOTO', 'RESUME', 'A_FORM', 'SSC_CERTIFICATE', 'HSC_CERTIFICATE', 'OTHER_CERTIFICATE', 'AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'BANK_PASSBOOK', 'OTHER') NOT NULL,
    `status` ENUM('STORED', 'MISSING_AT_SOURCE', 'UNSUPPORTED', 'FAILED', 'QUARANTINED') NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `sha256` VARCHAR(191) NULL,
    `storageKey` VARCHAR(191) NULL,
    `sourceRef` TEXT NOT NULL,
    `scanStatus` VARCHAR(191) NULL,
    `error` VARCHAR(191) NULL,
    `extractedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CandidateDocument_candidateId_idx`(`candidateId`),
    UNIQUE INDEX `CandidateDocument_candidateId_kind_key`(`candidateId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentPolicy` (
    `sourceConnectionId` VARCHAR(191) NOT NULL,
    `kind` ENUM('PROFILE_PHOTO', 'RESUME', 'A_FORM', 'SSC_CERTIFICATE', 'HSC_CERTIFICATE', 'OTHER_CERTIFICATE', 'AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'BANK_PASSBOOK', 'OTHER') NOT NULL,
    `allowed` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`sourceConnectionId`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CandidateDocument` ADD CONSTRAINT `CandidateDocument_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentPolicy` ADD CONSTRAINT `DocumentPolicy_sourceConnectionId_fkey` FOREIGN KEY (`sourceConnectionId`) REFERENCES `SourceConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
