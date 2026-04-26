import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  DB_URL: Joi.string().trim().required(),
  PORT: Joi.number().port().default(3000),
});
