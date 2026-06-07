import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  DB_URL: Joi.string().trim().required(),
  REDIS_URL: Joi.string().uri().required(),
  PORT: Joi.number().port().default(8000),
  APP_URL: Joi.string().uri().required(),
  THROTTLE_TTL_MS: Joi.number().integer().positive().required(),
  THROTTLE_LIMIT: Joi.number().integer().positive().required(),
  AUTH_THROTTLE_TTL_MS: Joi.number().integer().positive().required(),
  AUTH_THROTTLE_LIMIT: Joi.number().integer().positive().required(),
  JWT_SECRET: Joi.string().trim().required(),
  JWT_ALGORITHM: Joi.string().valid('HS256', 'HS384', 'HS512').required(),
  JWT_EXPIRY: Joi.string().trim().required(),
  JWT_REFRESH_EXPIRY: Joi.string().trim().required(),
  PASSWORD_RESET_TOKEN_EXPIRY_HOURS: Joi.number()
    .integer()
    .positive()
    .required(),
  PASSWORD_RESET_MAX_ATTEMPTS: Joi.number().integer().positive().required(),
  EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS: Joi.number()
    .integer()
    .positive()
    .required(),
  EMAIL_FROM_ADDRESS: Joi.string().email().required(),
  EMAIL_FROM_NAME: Joi.string().trim().required(),
  SMTP_HOST: Joi.string().hostname().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_USER: Joi.string().trim().required(),
  SMTP_PASS: Joi.string().allow('').required(),
  SMTP_SECURE: Joi.boolean().required(),
});
