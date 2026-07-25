-- =============================================================================
-- Migration 422 — store the Stripe customer id for off-session autopay
-- =============================================================================
-- Autopay could never actually charge a real saved card: chargeStripe built a
-- PaymentIntent with payment_method + confirm but NO customer and NO
-- off_session=true, so an unattended charge on a saved card declined with
-- authentication_required (mapped to 'pending' → autopay silently never
-- collected). Off-session charging requires BOTH a Stripe customer id and the
-- saved payment_method id. recurring_payment_profiles.token_reference holds the
-- payment_method (pm_...); this adds the customer (cus_...). Populated by the
-- Checkout-setup-mode card-capture flow (which also collects the SCA mandate).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_422_recurring_profile_stripe_customer;
DELIMITER //
CREATE PROCEDURE migration_422_recurring_profile_stripe_customer()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'recurring_payment_profiles'
      AND COLUMN_NAME  = 'stripe_customer_id'
  ) THEN
    ALTER TABLE recurring_payment_profiles
      ADD COLUMN stripe_customer_id VARCHAR(255) NULL
        COMMENT 'Stripe customer id (cus_...) for off-session charging; paired with token_reference (the pm_...) — migration 422'
        AFTER token_reference;
  END IF;
END //
DELIMITER ;
CALL migration_422_recurring_profile_stripe_customer();
DROP PROCEDURE IF EXISTS migration_422_recurring_profile_stripe_customer;
