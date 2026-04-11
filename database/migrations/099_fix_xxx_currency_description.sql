-- Migration: 099_fix_xxx_currency_description
-- Description: Corrects the description for the XXX currency code in sat_moneda.
--
--              The original seed (migration 069) inserted:
--                'Los derechos en esta divisa'
--
--              The official SAT CFDI 4.0 catalog description is:
--                'Los códigos asignados para las transacciones en que no intervenga ninguna moneda'
--
--              XXX is used for non-currency transactions (e.g., barter, in-kind)
--              and the correct description avoids confusion with XDR (Special
--              Drawing Rights), which is sometimes loosely described as "derechos".

UPDATE sat_moneda
    SET description = 'Los códigos asignados para las transacciones en que no intervenga ninguna moneda'
    WHERE code = 'XXX';
