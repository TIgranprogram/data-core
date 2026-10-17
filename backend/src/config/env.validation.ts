import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  MONGO_URI: Joi.string().uri().required(),
  MONGO_DB: Joi.string().default('kppdf'),
  MONGO_REPLICA_SET: Joi.string().default('rs0'),

  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  ADMIN_USERNAME: Joi.string().default('admin'),
  ADMIN_PASSWORD: Joi.string().min(8).required(),

  // Owner-device invite: default 2 days (2880m). Cap 7 days — home→work handoff.
  DEVICE_INVITE_TTL_DAYS: Joi.number().integer().min(1).max(7).default(3),
  DEVICE_OWNER_INVITE_TTL_MINUTES: Joi.number().integer().min(1).max(10080).default(2880),
  DEVICE_GRANT_TTL_DAYS: Joi.number().integer().min(1).max(3650).default(365),
  DEVICE_JWT_TTL_SECONDS: Joi.number().integer().min(30).max(300).default(300),
  DEVICE_INVITE_SECRET_BYTES: Joi.number().integer().min(24).max(64).default(32),
  DEVICE_GRANT_SECRET_BYTES: Joi.number().integer().min(24).max(64).default(32),
  DEVICE_COOKIE_NAME: Joi.string().pattern(/^__Host-/).default('__Host-kppdf-device'),
  DEVICE_ENROLL_BASE_URL: Joi.string().uri().default('http://localhost:4200'),
});
