-- Phase 10: complete employee profile & document synchronization.
-- Hand-written (Prisma's generated diff lower-cased table names on Windows and dropped the
-- CandidateDocument foreign key without re-adding it). Existing rows are kept; documents get slot 0.

-- Per-employee sync status
ALTER TABLE `Candidate`
    ADD COLUMN `documentsSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `attendanceSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `ticketsSyncedAt` DATETIME(3) NULL;

-- Documents: new kinds, slots, source verification, encryption flag, retry bookkeeping
ALTER TABLE `CandidateDocument`
    ADD COLUMN `slot` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `sourceVerification` VARCHAR(30) NULL,
    ADD COLUMN `encrypted` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `nextRetryAt` DATETIME(3) NULL,
    ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
    MODIFY `kind` ENUM('PROFILE_PHOTO', 'RESUME', 'A_FORM', 'SSC_CERTIFICATE', 'HSC_CERTIFICATE', 'OTHER_CERTIFICATE', 'AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'BANK_PASSBOOK', 'OTHER', 'VOTER_ID', 'PASSPORT', 'DRIVING_LICENCE', 'RATION_CARD', 'RESIDENCE_PROOF', 'EXPERIENCE_LETTER') NOT NULL;

-- New unique key first, then drop the old one (the candidateId foreign key keeps its own index).
CREATE UNIQUE INDEX `CandidateDocument_candidateId_kind_slot_key` ON `CandidateDocument`(`candidateId`, `kind`, `slot`);
DROP INDEX `CandidateDocument_candidateId_kind_key` ON `CandidateDocument`;
CREATE INDEX `CandidateDocument_status_nextRetryAt_idx` ON `CandidateDocument`(`status`, `nextRetryAt`);

ALTER TABLE `DocumentPolicy`
    MODIFY `kind` ENUM('PROFILE_PHOTO', 'RESUME', 'A_FORM', 'SSC_CERTIFICATE', 'HSC_CERTIFICATE', 'OTHER_CERTIFICATE', 'AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'BANK_PASSBOOK', 'OTHER', 'VOTER_ID', 'PASSPORT', 'DRIVING_LICENCE', 'RATION_CARD', 'RESIDENCE_PROOF', 'EXPERIENCE_LETTER') NOT NULL;

-- Office location (work location map on the source profile)
ALTER TABLE `CandidateProfile`
    ADD COLUMN `officeLat` DOUBLE NULL,
    ADD COLUMN `officeLng` DOUBLE NULL;

-- Sensitive groups: one encrypted JSON blob per (candidate, group)
CREATE TABLE `CandidateSensitiveData` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `group` VARCHAR(30) NOT NULL,
    `encrypted` TEXT NOT NULL,
    `hash` VARCHAR(64) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CandidateSensitiveData_candidateId_group_key`(`candidateId`, `group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CandidateAttendanceMonth` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `present` INTEGER NOT NULL DEFAULT 0,
    `absent` INTEGER NOT NULL DEFAULT 0,
    `halfDay` INTEGER NOT NULL DEFAULT 0,
    `lateMark` INTEGER NOT NULL DEFAULT 0,
    `weeklyOff` INTEGER NOT NULL DEFAULT 0,
    `holiday` INTEGER NOT NULL DEFAULT 0,
    `attendanceOut` INTEGER NOT NULL DEFAULT 0,
    `workingDays` INTEGER NOT NULL DEFAULT 0,
    `daysInMonth` INTEGER NOT NULL DEFAULT 0,
    `days` JSON NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL,

    INDEX `CandidateAttendanceMonth_year_month_idx`(`year`, `month`),
    UNIQUE INDEX `CandidateAttendanceMonth_candidateId_year_month_key`(`candidateId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CandidateTicket` (
    `id` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `sourceTicketId` VARCHAR(40) NOT NULL,
    `ticketNumber` VARCHAR(60) NULL,
    `type` VARCHAR(100) NULL,
    `subject` VARCHAR(300) NULL,
    `priority` VARCHAR(30) NULL,
    `status` VARCHAR(30) NULL,
    `feedback` TEXT NULL,
    `attachmentRef` TEXT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `syncedAt` DATETIME(3) NOT NULL,

    INDEX `CandidateTicket_status_idx`(`status`),
    UNIQUE INDEX `CandidateTicket_candidateId_sourceTicketId_key`(`candidateId`, `sourceTicketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CandidateSensitiveData` ADD CONSTRAINT `CandidateSensitiveData_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CandidateAttendanceMonth` ADD CONSTRAINT `CandidateAttendanceMonth_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CandidateTicket` ADD CONSTRAINT `CandidateTicket_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
