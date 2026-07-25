-- Rollback 423 — drop the active-default unique guard on recurring_payment_profiles.
DROP PROCEDURE IF EXISTS rollback_423_recurring_profile_default_guard;
DELIMITER //
CREATE PROCEDURE rollback_423_recurring_profile_default_guard()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recurring_payment_profiles'
      AND INDEX_NAME = 'uq_recurring_profiles_default_guard') THEN
    ALTER TABLE recurring_payment_profiles DROP INDEX uq_recurring_profiles_default_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recurring_payment_profiles'
      AND COLUMN_NAME = 'default_guard') THEN
    ALTER TABLE recurring_payment_profiles DROP COLUMN default_guard;
  END IF;
END //
DELIMITER ;
CALL rollback_423_recurring_profile_default_guard();
DROP PROCEDURE IF EXISTS rollback_423_recurring_profile_default_guard;
