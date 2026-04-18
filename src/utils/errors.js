// =============================================================================
// FireISP 5.0 — Error Handling Utilities
// =============================================================================

/**
 * Application error with HTTP status code.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

// ---------------------------------------------------------------------------
// Domain-specific error subclasses for service-level context
// ---------------------------------------------------------------------------

class InvoiceGenerationError extends AppError {
  constructor(message, details = null) {
    super(message, 500, 'INVOICE_GENERATION_FAILED');
    this.details = details;
  }
}

class CfdiStampingError extends AppError {
  constructor(message, details = null) {
    super(message, 502, 'CFDI_STAMPING_FAILED');
    this.details = details;
  }
}

class CfdiCancellationError extends AppError {
  constructor(message, details = null) {
    super(message, 502, 'CFDI_CANCELLATION_FAILED');
    this.details = details;
  }
}

class PaymentGatewayError extends AppError {
  constructor(message, details = null) {
    super(message, 502, 'PAYMENT_GATEWAY_ERROR');
    this.details = details;
  }
}

class ExternalServiceError extends AppError {
  constructor(service, message, details = null) {
    super(`${service}: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
    this.details = details;
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  InvoiceGenerationError,
  CfdiStampingError,
  CfdiCancellationError,
  PaymentGatewayError,
  ExternalServiceError,
};
