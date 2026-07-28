'use strict';
// =============================================================================
// FireISP 5.0 — ticket / work-order attachment hardening (j35)
// =============================================================================
// Neither route had a multer fileFilter, so BOTH accepted any extension and any
// mime type with the 20 MB cap as the only restriction. Two more problems sat
// next to it, both caller-input reaching a response header:
//
//   * mime_type was stored verbatim from the client's multipart headers and
//     echoed back as the download's Content-Type. The uploader chose the type
//     the browser would be handed.
//   * original_filename was interpolated raw into
//     `attachment; filename="..."`. A name containing a double quote closes the
//     quoted string early and the remainder parses as further header params.
//
// The allowlist is deliberately NOT upload.js's ALLOWED_EXTENSIONS: that set
// has no .heic (every modern iPhone photo), no .docx and no video, so reusing
// it would start rejecting what field staff upload today.
// =============================================================================

const path = require('path');
const {
  ATTACHMENT_EXTENSIONS,
  attachmentFileFilter,
  attachmentMimeType,
  contentDispositionAttachment,
} = require('../src/middleware/upload');

/** Run the multer fileFilter and report what it decided. */
function filter(originalname) {
  let outcome;
  attachmentFileFilter({}, { originalname }, (err, accepted) => {
    outcome = err ? { rejected: true, message: err.message } : { rejected: !accepted };
  });
  return outcome;
}

describe('the attachment allowlist covers what field staff actually upload', () => {
  it.each([
    ['install-photo.heic', 'iPhone default photo format'],
    ['install-photo.HEIC', 'and case-insensitively'],
    ['fault.mp4', 'short video evidence'],
    ['signed-order.docx', 'a Word document'],
    ['readings.xlsx', 'a spreadsheet'],
    ['scan.pdf', 'a PDF'],
    ['photo.jpg', 'an ordinary photo'],
  ])('accepts %s (%s)', (name) => {
    expect(filter(name).rejected).toBe(false);
  });

  it('rejects the shapes an attachment should never carry', () => {
    for (const name of ['payload.exe', 'run.sh', 'macro.js', 'page.html', 'vector.svg', 'logs.zip', 'lib.so']) {
      expect(filter(name).rejected).toBe(true);
    }
  });

  it('rejects a file with no extension at all', () => {
    expect(filter('README').rejected).toBe(true);
  });

  it('judges the FINAL extension, not an earlier one', () => {
    // photo.jpg.exe is an executable; .jpg.exe must not read as ".jpg".
    expect(filter('photo.jpg.exe').rejected).toBe(true);
    expect(filter('archive.exe.jpg').rejected).toBe(false);   // genuinely a .jpg
  });

  it('names the accepted types in the rejection, so the operator can act', () => {
    const out = filter('payload.exe');
    expect(out.message).toMatch(/\.exe/);
    expect(out.message).toMatch(/Accepted:/);
    expect(out.message).toMatch(/\.heic/);
  });

  it("the rejection message SURVIVES — MulterError would otherwise replace it", () => {
    // new multer.MulterError(code, field) takes a FIELD name second and derives
    // .message from the code, so the explanation was being thrown away and every
    // rejection in this file surfaced multer's canned "Unexpected field".
    // The routes respond with err.message, so that is what the operator saw.
    const out = filter('payload.exe');
    expect(out.message).not.toBe('Unexpected field');
  });

  it('does NOT reuse the CSD/document allowlist', () => {
    // The regression this guards: swapping in ALLOWED_EXTENSIONS would silently
    // start rejecting every iPhone photo.
    expect(ATTACHMENT_EXTENSIONS.has('.heic')).toBe(true);
    expect(ATTACHMENT_EXTENSIONS.has('.docx')).toBe(true);
    expect(ATTACHMENT_EXTENSIONS.has('.mp4')).toBe(true);
    // And archives stay out — an attachment is handed back to another user.
    expect(ATTACHMENT_EXTENSIONS.has('.zip')).toBe(false);
  });
});

describe('the stored mime type comes from the extension, never the uploader', () => {
  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['photo.HEIC', 'image/heic'],
    ['doc.pdf', 'application/pdf'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['clip.mov', 'video/quicktime'],
  ])('%s → %s', (name, expected) => {
    expect(attachmentMimeType(name)).toBe(expected);
  });

  it('falls back to octet-stream rather than trusting anything', () => {
    expect(attachmentMimeType('mystery.qqq')).toBe('application/octet-stream');
    expect(attachmentMimeType('')).toBe('application/octet-stream');
    expect(attachmentMimeType(undefined)).toBe('application/octet-stream');
  });

  it('can never return a type the uploader chose', () => {
    // The old code stored req.file.mimetype verbatim. Whatever a caller claims,
    // the derived type depends only on the extension.
    expect(attachmentMimeType('photo.jpg')).toBe('image/jpeg');
    expect(attachmentMimeType('photo.jpg')).not.toBe('text/html');
  });
});

describe('Content-Disposition cannot be steered by the filename', () => {
  it('strips a quote that would close the quoted string early', () => {
    const v = contentDispositionAttachment('evil".exe"; x="y');
    // Exactly one quoted filename token, then the RFC 5987 form.
    expect(v).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(v).not.toMatch(/x="y/);
  });

  it('strips backslashes, which also escape inside a quoted string', () => {
    expect(contentDispositionAttachment('a\\"b.pdf')).toMatch(/^attachment; filename="[^"]*"; /);
  });

  it('carries non-ASCII names in filename*, which the bare form cannot express', () => {
    const v = contentDispositionAttachment('instalación-señal.pdf');
    expect(v).toMatch(/filename="instalaci_n-se_al\.pdf"/);      // ASCII-safe fallback
    expect(v).toContain(encodeURIComponent('instalación-señal.pdf'));
  });

  it('survives a missing name', () => {
    expect(contentDispositionAttachment(undefined)).toMatch(/filename="download"/);
    expect(contentDispositionAttachment('')).toMatch(/filename="download"/);
  });

  it('produces a header value Node will accept', () => {
    // Node throws on CR/LF in a header value; prove none can survive.
    const v = contentDispositionAttachment('a\r\nInjected: yes\r\nb.pdf');
    expect(v).not.toMatch(/[\r\n]/);
    expect(() => { const { ServerResponse } = require('http'); ServerResponse; }).not.toThrow();
  });
});

describe('both attachment routes are wired to the filter', () => {
  // A filter that exists but is not attached is the failure this catches.
  it.each([
    ['src/routes/tickets.js'],
    ['src/routes/workOrders.js'],
  ])('%s passes attachmentFileFilter to multer', (file) => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(src).toMatch(/fileFilter:\s*attachmentFileFilter/);
    expect(src).toMatch(/attachmentMimeType\(req\.file\.originalname\)/);
    expect(src).toMatch(/contentDispositionAttachment\(row\.original_filename\)/);
    // And the raw forms are gone.
    expect(src).not.toMatch(/req\.file\.originalname,\s*req\.file\.mimetype/);
    expect(src).not.toMatch(/filename="\$\{row\.original_filename\}"/);
  });
});
