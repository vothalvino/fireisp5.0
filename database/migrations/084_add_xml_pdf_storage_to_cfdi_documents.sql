-- Migration: 084_add_xml_pdf_storage_to_cfdi_documents
-- Description: Extends cfdi_documents with dedicated columns for the signed
--              timbrado XML and references to file-table records for large-document
--              or archival storage of both the XML and the generated PDF.
--
--              SAT legally requires retaining the signed XML for a minimum of 5 years.
--              The signed_xml LONGTEXT column covers the immediate use case; the
--              xml_file_id and pdf_file_id FKs to the files table support archival
--              pipelines that store documents on object storage (S3, GCS, etc.).
--
--              Columns are added after sat_seal to keep PAC stamping metadata
--              together in a logical block.
--
--              Column / FK additions use stored-procedure IF NOT EXISTS guards
--              so the file is safe to re-run after a mid-file failure.

-- Disable FK checks: files table is created in migration 017.
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- cfdi_documents: signed_xml, xml_file_id, pdf_file_id columns + file FKs
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_084_add_cfdi_documents_xml_pdf_storage;
DELIMITER //
CREATE PROCEDURE migration_084_add_cfdi_documents_xml_pdf_storage()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cfdi_documents'
      AND COLUMN_NAME  = 'signed_xml'
  ) THEN
    ALTER TABLE cfdi_documents
        ADD COLUMN signed_xml   LONGTEXT        NULL
                                    COMMENT 'Complete signed and stamped CFDI XML document as returned by PAC'
                                    AFTER sat_seal;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cfdi_documents'
      AND COLUMN_NAME  = 'xml_file_id'
  ) THEN
    ALTER TABLE cfdi_documents
        ADD COLUMN xml_file_id  BIGINT UNSIGNED NULL
                                    COMMENT 'Reference to XML file in files table for large-document or archival storage'
                                    AFTER signed_xml;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cfdi_documents'
      AND COLUMN_NAME  = 'pdf_file_id'
  ) THEN
    ALTER TABLE cfdi_documents
        ADD COLUMN pdf_file_id  BIGINT UNSIGNED NULL
                                    COMMENT 'Reference to generated PDF representation in files table'
                                    AFTER xml_file_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_documents'
      AND CONSTRAINT_NAME         = 'fk_cfdi_documents_xml_file'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_documents
        ADD CONSTRAINT fk_cfdi_documents_xml_file FOREIGN KEY (xml_file_id)
            REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'cfdi_documents'
      AND CONSTRAINT_NAME         = 'fk_cfdi_documents_pdf_file'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE cfdi_documents
        ADD CONSTRAINT fk_cfdi_documents_pdf_file FOREIGN KEY (pdf_file_id)
            REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_084_add_cfdi_documents_xml_pdf_storage();
DROP PROCEDURE IF EXISTS migration_084_add_cfdi_documents_xml_pdf_storage;

SET FOREIGN_KEY_CHECKS = 1;
