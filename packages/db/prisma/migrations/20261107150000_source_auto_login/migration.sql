-- Automatic MahaHRD sign-in status (2026-11-07). Hand-written; table name in schema case.
ALTER TABLE `SourceConnection`
    ADD COLUMN `autoLoginAt` DATETIME(3) NULL,
    ADD COLUMN `autoLoginError` VARCHAR(300) NULL,
    ADD COLUMN `loginTestRequestedAt` DATETIME(3) NULL;
