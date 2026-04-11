-- Migration: 098_set_country_default_null
-- Description: Changes the DEFAULT for the country column on clients and
--              organizations from 'US' to NULL.
--
--              For a truly global multi-tenant system the appropriate default is
--              NULL (country not yet specified) rather than silently assuming the
--              United States.  Existing rows that already have 'US' are NOT
--              changed — only future rows inserted without an explicit country
--              value will receive NULL instead of 'US'.

ALTER TABLE clients
    ALTER COLUMN country SET DEFAULT NULL;

ALTER TABLE organizations
    ALTER COLUMN country SET DEFAULT NULL;
