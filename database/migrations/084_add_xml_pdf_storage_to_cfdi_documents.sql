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

-- Disable FK checks: files table is created in migration 017.
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE cfdi_documents
    ADD COLUMN signed_xml   LONGTEXT        NULL
                                COMMENT 'Complete signed and stamped CFDI XML document as returned by PAC'
                                AFTER sat_seal,
    ADD COLUMN xml_file_id  BIGINT UNSIGNED NULL
                                COMMENT 'Reference to XML file in files table for large-document or archival storage'
                                AFTER signed_xml,
    ADD COLUMN pdf_file_id  BIGINT UNSIGNED NULL
                                COMMENT 'Reference to generated PDF representation in files table'
                                AFTER xml_file_id,

    ADD CONSTRAINT fk_cfdi_documents_xml_file FOREIGN KEY (xml_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT fk_cfdi_documents_pdf_file FOREIGN KEY (pdf_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
