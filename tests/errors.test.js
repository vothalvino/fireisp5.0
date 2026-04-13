// =============================================================================
// FireISP 5.0 — Error Utility Tests
// =============================================================================

const {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  InvoiceGenerationError,
  CfdiStampingError,
  PaymentGatewayError,
  ExternalServiceError,
} = require('../src/utils/errors');

describe('Error Classes', () => {
  test('AppError has statusCode and code', () => {
    const err = new AppError('test', 500, 'TEST');
    expect(err.message).toBe('test');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('TEST');
    expect(err.name).toBe('AppError');
  });

  test('NotFoundError defaults to 404', () => {
    const err = new NotFoundError('Client');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('Client');
  });

  test('ValidationError defaults to 422 with details', () => {
    const err = new ValidationError('Bad input', [{ field: 'email' }]);
    expect(err.statusCode).toBe(422);
    expect(err.details).toHaveLength(1);
  });

  test('UnauthorizedError defaults to 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
  });

  test('ForbiddenError defaults to 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
  });

  test('ConflictError defaults to 409', () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
  });

  // -------------------------------------------------------------------------
  // Domain-specific error subclasses
  // -------------------------------------------------------------------------
  test('InvoiceGenerationError defaults to 500 with correct code', () => {
    const err = new InvoiceGenerationError('Tax rate missing', { contractId: 5 });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INVOICE_GENERATION_FAILED');
    expect(err.details).toEqual({ contractId: 5 });
    expect(err.message).toBe('Tax rate missing');
  });

  test('CfdiStampingError defaults to 502 with correct code', () => {
    const err = new CfdiStampingError('PAC unreachable');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('CFDI_STAMPING_FAILED');
  });

  test('PaymentGatewayError defaults to 502 with correct code', () => {
    const err = new PaymentGatewayError('Stripe declined');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('PAYMENT_GATEWAY_ERROR');
  });

  test('ExternalServiceError includes service name in message', () => {
    const err = new ExternalServiceError('Finkok', 'Connection refused');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(err.service).toBe('Finkok');
    expect(err.message).toBe('Finkok: Connection refused');
  });
});
