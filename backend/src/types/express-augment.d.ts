/**
 * TypeScript module augmentation for Express Request.
 * Adds `requestId` set by RequestIdMiddleware (TZ-163).
 */
import 'express';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}
