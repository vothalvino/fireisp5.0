-- Migration: 086_backfill_mx_locale_for_company_clients
-- Description: Fixes an incomplete backfill from migration 065.
--
--              Migration 065 set locale = 'MX' only for clients with
--              curp IS NOT NULL (personal Mexican clients). Company clients
--              that have a client_mx_profiles row (created via migration 066)
--              but no CURP were left on locale = 'global', which means
--              MX compliance checks would not activate for them.
--
--              This migration catches those company clients and sets their
--              locale to 'MX' to match their actual compliance context.
--
--              Similarly, organizations with an organization_mx_profiles row
--              that are still on locale = 'global' are corrected.

-- Backfill: clients that have a client_mx_profiles row but locale = 'global'
UPDATE clients c
    INNER JOIN client_mx_profiles p ON c.id = p.client_id
SET c.locale = 'MX'
WHERE c.locale = 'global';

-- Backfill: organizations that have an organization_mx_profiles row but locale = 'global'
UPDATE organizations o
    INNER JOIN organization_mx_profiles p ON o.id = p.organization_id
SET o.locale = 'MX'
WHERE o.locale = 'global';
