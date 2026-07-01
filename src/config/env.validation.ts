import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
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
  BREVO_API_KEY: Joi.string().trim().required(),
  BREVO_FROM_EMAIL: Joi.string().trim().required(),
  SHARE_LINK_EXPIRY_DAYS: Joi.number().integer().positive().default(7),
  GEMINI_API_KEY: Joi.string().trim().required(),
  GEMINI_MODEL: Joi.string().trim().default('gemini-3-flash'),
  AI_MAX_TOKENS: Joi.number().integer().positive().default(1000),
  AI_MAX_DOC_CHARS: Joi.number().integer().positive().default(60000),
  AI_FUZZY_THRESHOLD: Joi.number().min(0).max(1).default(0.7),
  AI_PROPOSAL_TTL_SECONDS: Joi.number().integer().positive().default(900),
  AI_REQUESTS_PER_MINUTE: Joi.number().integer().positive().required(),
  WS_CONNECTION_RATE_LIMIT: Joi.number().integer().positive().required(),
  WS_MESSAGE_RATE_LIMIT: Joi.number().integer().positive().required(),
});
