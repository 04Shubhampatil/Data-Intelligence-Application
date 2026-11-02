-- Employee ID printed on the source profile card (differs from the profile id used as sourceEmployeeCode).
ALTER TABLE `Candidate` ADD COLUMN `officialEmployeeId` VARCHAR(20) NULL;
CREATE INDEX `Candidate_officialEmployeeId_idx` ON `Candidate`(`officialEmployeeId`);
