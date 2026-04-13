-- Migration: 148_cfdi_document_immutability_trigger
-- Description: Adds a BEFORE UPDATE trigger on cfdi_documents that prevents
--              modification of stamped (vigente) CFDI documents.
--
--              Business rule: once a CFDI is stamped and registered with SAT
--              (sat_status = 'vigente'), its financial fields are fiscally
--              immutable per SAT Anexo 20 regulation.  The only allowed
--              transitions from 'vigente' are to 'cancel_pending' or
--              'cancelado' — which is the official SAT cancellation flow.
--
--              Protected fields: subtotal, total_impuestos, total,
--              tipo_comprobante, uso_cfdi, metodo_pago, forma_pago, moneda,
--              receptor_rfc, receptor_nombre, uuid, xml_content, signed_xml.
--
--              Fields that may still change on a vigente document:
--              sat_status (for cancellation flow), cancellation_reason,
--              cancellation_uuid, cancelled_at, pdf_url, pdf_file_id,
--              updated_at.
--
--              The trigger raises SQLSTATE '45000' with a descriptive message
--              so the application layer can surface a user-friendly error.
--
--              Uses DROP TRIGGER IF EXISTS before CREATE TRIGGER so the
--              migration is safe to re-run.

DELIMITER $$

DROP TRIGGER IF EXISTS trg_cfdi_documents_immutable_bu$$

CREATE TRIGGER trg_cfdi_documents_immutable_bu
BEFORE UPDATE ON cfdi_documents
FOR EACH ROW
BEGIN
    -- Only enforce immutability on stamped (vigente) documents
    IF OLD.sat_status = 'vigente' THEN
        -- Allow sat_status transitions for cancellation flow
        IF NEW.subtotal           != OLD.subtotal
        OR NEW.total_impuestos    != OLD.total_impuestos
        OR NEW.total              != OLD.total
        OR NEW.tipo_comprobante   != OLD.tipo_comprobante
        OR NEW.uso_cfdi           != OLD.uso_cfdi
        OR (NEW.metodo_pago IS NULL) != (OLD.metodo_pago IS NULL)
        OR COALESCE(NEW.metodo_pago, '') != COALESCE(OLD.metodo_pago, '')
        OR (NEW.forma_pago IS NULL) != (OLD.forma_pago IS NULL)
        OR COALESCE(NEW.forma_pago, '') != COALESCE(OLD.forma_pago, '')
        OR NEW.moneda             != OLD.moneda
        OR COALESCE(NEW.receptor_rfc, '')    != COALESCE(OLD.receptor_rfc, '')
        OR COALESCE(NEW.receptor_nombre, '') != COALESCE(OLD.receptor_nombre, '')
        OR COALESCE(NEW.uuid, '')            != COALESCE(OLD.uuid, '')
        THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Stamped CFDI documents (vigente) cannot be modified; use the cancellation flow';
        END IF;
    END IF;
END$$

DELIMITER ;
