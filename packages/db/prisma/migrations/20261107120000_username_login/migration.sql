-- Sign in with a username instead of an email address (2026-11-07). Hand-written; table names in schema case
-- (production MySQL is case-sensitive). Existing accounts get a username from their email's local part; the
-- first Super Admin becomes "superadmin".
ALTER TABLE `User` ADD COLUMN `username` VARCHAR(191) NULL;

-- 1) Unique placeholder for every account: local part + last 6 characters of the id.
UPDATE `User` SET `username` = LOWER(CONCAT(SUBSTRING_INDEX(`email`, '@', 1), '-', RIGHT(`id`, 6)));

-- 2) Plain local part wherever it is unique (double-nested so MySQL materialises it before updating).
UPDATE `User` u
JOIN (SELECT l FROM (SELECT LOWER(SUBSTRING_INDEX(`email`, '@', 1)) AS l FROM `User` GROUP BY l HAVING COUNT(*) = 1) AS t1) AS t
  ON t.l = LOWER(SUBSTRING_INDEX(u.`email`, '@', 1))
SET u.`username` = t.l
WHERE t.l <> 'superadmin';

-- 3) The oldest Super Admin signs in as "superadmin".
UPDATE `User` SET `username` = 'superadmin'
WHERE `id` = (SELECT id FROM (SELECT u2.`id` FROM `User` u2 JOIN `Role` r ON r.`id` = u2.`roleId` WHERE r.`name` = 'SUPER_ADMIN' ORDER BY u2.`createdAt` ASC LIMIT 1) AS t);

ALTER TABLE `User` MODIFY `username` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `User_username_key` ON `User`(`username`);

-- Email is optional from now on (MySQL allows several NULLs under a unique index).
ALTER TABLE `User` MODIFY `email` VARCHAR(191) NULL;
