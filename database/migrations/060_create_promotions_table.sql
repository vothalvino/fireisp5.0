-- Migration: 060_create_promotions_table
-- Description: Coupon codes, promotional pricing, and referral discounts.
--              Supports percentage and fixed-amount discounts applied to
--              contracts or invoices.  Each promotion has an optional coupon
--              code, validity window, and usage limits.

CREATE TABLE IF NOT EXISTS promotions (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Owning tenant; NULL = single-tenant deployment',
    name            VARCHAR(150)     NOT NULL COMMENT 'Internal label, e.g. "Summer 2026 – 20% off"',
    code            VARCHAR(50)      NULL     COMMENT 'Coupon code entered by client or staff; NULL = auto-applied / no code',
    description     TEXT             NULL     COMMENT 'Public-facing description shown on invoices or sign-up pages',
    discount_type   ENUM('percentage', 'fixed_amount')
                                     NOT NULL DEFAULT 'percentage'
                                     COMMENT 'percentage = % off the line total; fixed_amount = flat monetary deduction',
    discount_value  DECIMAL(10, 2)   NOT NULL COMMENT 'Percentage (0.00-100.00) or fixed amount depending on discount_type',
    promotion_type  ENUM('coupon', 'promotional', 'referral')
                                     NOT NULL DEFAULT 'coupon'
                                     COMMENT 'coupon = redeemable code; promotional = time-limited pricing; referral = credited via referrer/referee',
    applies_to      ENUM('contract', 'invoice', 'plan')
                                     NOT NULL DEFAULT 'invoice'
                                     COMMENT 'What entity the discount targets',
    max_uses        INT UNSIGNED     NULL     COMMENT 'Total redemption limit across all clients; NULL = unlimited',
    max_uses_per_client INT UNSIGNED NULL     COMMENT 'Per-client redemption cap; NULL = unlimited',
    times_used      INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT 'Running counter of total redemptions',
    min_order_value DECIMAL(10, 2)   NULL     COMMENT 'Minimum invoice/contract value required to apply this promotion; NULL = no minimum',
    duration_months TINYINT UNSIGNED NULL     COMMENT 'Number of billing cycles the discount applies (e.g. 3 = first 3 months); NULL = one-time or perpetual',
    starts_at       TIMESTAMP        NULL     COMMENT 'Promotion validity start; NULL = immediately valid',
    ends_at         TIMESTAMP        NULL     COMMENT 'Promotion validity end; NULL = no expiry',
    is_active       TINYINT(1)       NOT NULL DEFAULT 1,
    created_by      BIGINT UNSIGNED  NULL     COMMENT 'Staff member who created this promotion',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_promotions_org_code (organization_id, code),
    KEY idx_promotions_organization_id (organization_id),
    KEY idx_promotions_promotion_type (promotion_type),
    KEY idx_promotions_is_active (is_active),
    KEY idx_promotions_dates (starts_at, ends_at) COMMENT 'Optimises WHERE starts_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW())',
    KEY idx_promotions_code (code),
    CONSTRAINT fk_promotions_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_promotions_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_promotions_discount_value CHECK (discount_value > 0),
    CONSTRAINT chk_promotions_ends_after_starts CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
