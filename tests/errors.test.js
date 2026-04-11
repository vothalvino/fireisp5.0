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
});
