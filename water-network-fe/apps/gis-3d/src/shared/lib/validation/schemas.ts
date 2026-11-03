/**
 * Common Validation Schemas
 *
 * Reusable Zod schemas for common form validations.
 * These can be composed into larger schemas.
 */

import { z } from 'zod'

/**
 * Email validation schema
 */
export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')

/**
 * Password validation schema
 * @param minLength - Minimum password length (default: 8)
 */
export function passwordSchema(minLength: number = 8) {
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    )
}

/**
 * Simple password schema (no complexity requirements)
 * @param minLength - Minimum password length (default: 6)
 */
export function simplePasswordSchema(minLength: number = 6) {
  return z.string().min(minLength, `Password must be at least ${minLength} characters`)
}

/**
 * Name validation schema
 * @param minLength - Minimum name length (default: 2)
 */
export function nameSchema(minLength: number = 2) {
  return z
    .string()
    .min(minLength, `Name must be at least ${minLength} characters`)
    .max(100, 'Name must be less than 100 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes')
}

/**
 * Phone number validation schema (US format)
 */
export const phoneSchema = z
  .string()
  .regex(
    /^(\+1)?[\s.-]?\(?[0-9]{3}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/,
    'Please enter a valid phone number'
  )

/**
 * URL validation schema
 */
export const urlSchema = z.string().url('Please enter a valid URL')

/**
 * Positive number schema
 */
export const positiveNumberSchema = z
  .number()
  .positive('Must be a positive number')
  .or(z.string().regex(/^\d+$/).transform(Number))

/**
 * Non-empty string schema
 */
export const nonEmptyStringSchema = z.string().min(1, 'This field is required').trim()

/**
 * Common form schemas
 */
export const commonSchemas = {
  email: emailSchema,
  password: passwordSchema,
  simplePassword: simplePasswordSchema,
  name: nameSchema,
  phone: phoneSchema,
  url: urlSchema,
  positiveNumber: positiveNumberSchema,
  nonEmptyString: nonEmptyStringSchema,
} as const
