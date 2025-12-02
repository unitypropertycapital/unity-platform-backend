/**
 * Centralized Error Handler
 *
 * Provides consistent error types and handling across the application.
 * All errors are logged and never silently caught.
 */

import { logger } from './logger';

// Base application error
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, code: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error types
export class ValidationError extends AppError {
  public readonly fields: string[];

  constructor(message: string, fields: string[] = []) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ExternalServiceError extends AppError {
  public readonly service: string;

  constructor(service: string, message: string) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`, 'TIMEOUT', 504);
    this.name = 'TimeoutError';
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 500, false);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error response structure for API responses
 */
export interface ErrorResponse {
  error: string;
  code: string;
  details?: string;
  fields?: string[];
}

/**
 * Convert any error to a standardized ErrorResponse
 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      error: err.message,
      code: err.code,
    };

    if (err instanceof ValidationError && err.fields.length > 0) {
      response.fields = err.fields;
    }

    return response;
  }

  if (err instanceof Error) {
    return {
      error: err.message,
      code: 'INTERNAL_ERROR',
    };
  }

  return {
    error: 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR',
  };
}

/**
 * Get HTTP status code for an error
 */
export function getStatusCode(err: unknown): number {
  if (err instanceof AppError) {
    return err.statusCode;
  }
  return 500;
}

/**
 * Centralized error handler - logs and formats errors
 * NEVER silently catches - all errors are logged
 */
export function handleError(err: unknown, context?: Record<string, unknown>): ErrorResponse {
  const response = toErrorResponse(err);
  const statusCode = getStatusCode(err);

  // Log with full context - never silent
  if (err instanceof AppError) {
    if (err.isOperational) {
      logger.warn('Operational error', {
        ...context,
        code: err.code,
        statusCode,
        message: err.message,
      });
    } else {
      logger.error('Programming error', {
        ...context,
        code: err.code,
        statusCode,
        message: err.message,
        stack: err.stack,
      });
    }
  } else if (err instanceof Error) {
    logger.error('Unexpected error', {
      ...context,
      message: err.message,
      stack: err.stack,
    });
  } else {
    logger.error('Unknown error type', {
      ...context,
      error: String(err),
    });
  }

  return response;
}

/**
 * Wrap async handlers with centralized error handling
 */
export function asyncHandler<T extends (...args: unknown[]) => Promise<void>>(
  fn: T
): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>): Promise<void> => {
    try {
      await fn(...args);
    } catch (err) {
      handleError(err, { handler: fn.name });
      throw err;
    }
  };
}

