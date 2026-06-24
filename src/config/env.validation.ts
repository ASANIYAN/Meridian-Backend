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
  OUTBOX_MAX_ATTEMPTS: Joi.number().integer().positive().required(),
  EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS: Joi.number()
    .integer()
    .positive()
    .required(),
  SMTP_HOST: Joi.string().hostname().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_USER: Joi.string().trim().required(),
  SMTP_PASS: Joi.string().allow('').required(),
  SMTP_SECURE: Joi.boolean().required(),
  SHARE_LINK_EXPIRY_DAYS: Joi.number().integer().positive().default(7),
  WS_PORT: Joi.number().port().default(8001),
  GEMINI_API_KEY: Joi.string().trim().required(),
  GEMINI_MODEL: Joi.string().trim().default('gemini-2.5-flash'),
  AI_MAX_TOKENS: Joi.number().integer().positive().default(1000),
  AI_MAX_DOC_CHARS: Joi.number().integer().positive().default(60000),
  AI_FUZZY_THRESHOLD: Joi.number().min(0).max(1).default(0.7),
  AI_REQUESTS_PER_MINUTE: Joi.number().integer().positive().required(),
  WS_CONNECTION_RATE_LIMIT: Joi.number().integer().positive().required(),
  WS_MESSAGE_RATE_LIMIT: Joi.number().integer().positive().required(),
});
