-- Rollback 422 — drop recurring_payment_profiles.stripe_customer_id.
DROP PROCEDURE IF EXISTS rollback_422_recurring_profile_stripe_customer;
DELIMITER //
CREATE PROCEDURE rollback_422_recurring_profile_stripe_customer()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recurring_payment_profiles'
      AND COLUMN_NAME = 'stripe_customer_id') THEN
    ALTER TABLE recurring_payment_profiles DROP COLUMN stripe_customer_id;
  END IF;
END //
DELIMITER ;
CALL rollback_422_recurring_profile_stripe_customer();
DROP PROCEDURE IF EXISTS rollback_422_recurring_profile_stripe_customer;
