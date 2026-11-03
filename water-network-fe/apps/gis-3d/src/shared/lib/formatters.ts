/**
 * Number and Currency Formatting Utilities
 *
 * Provides consistent formatting for numbers, currency, and percentages.
 * FSD Rule: This is in the Shared layer, accessible to all layers.
 */

/**
 * Format a number as currency
 * @param amount - The amount to format
 * @param currency - Currency code (default: USD)
 * @param locale - Locale for formatting (default: en-US)
 * @returns Formatted currency string
 */
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch (error) {
    console.error('Error formatting currency:', error)
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Format a number with abbreviations (1.2K, 1.5M, 2.3B)
 * @param num - The number to format
 * @param decimals - Number of decimal places (default: 1)
 * @returns Abbreviated number string
 */
export function formatNumber(num: number, decimals: number = 1): string {
  if (num === 0) return '0'

  const absNum = Math.abs(num)
  const sign = num < 0 ? '-' : ''

  if (absNum >= 1_000_000_000) {
    return `${sign}${(absNum / 1_000_000_000).toFixed(decimals)}B`
  }
  if (absNum >= 1_000_000) {
    return `${sign}${(absNum / 1_000_000).toFixed(decimals)}M`
  }
  if (absNum >= 1_000) {
    return `${sign}${(absNum / 1_000).toFixed(decimals)}K`
  }

  return num.toString()
}

/**
 * Format a number with thousands separators
 * @param num - The number to format
 * @param locale - Locale for formatting (default: en-US)
 * @returns Formatted number string
 */
export function formatNumberWithCommas(num: number, locale: string = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale).format(num)
  } catch (error) {
    console.error('Error formatting number:', error)
    return num.toString()
  }
}

/**
 * Format a percentage
 * @param value - The value to format (0.15 = 15%)
 * @param decimals - Number of decimal places (default: 1)
 * @param includeSign - Include + sign for positive values (default: false)
 * @returns Formatted percentage string
 */
export function formatPercent(
  value: number,
  decimals: number = 1,
  includeSign: boolean = false
): string {
  const percent = value * 100
  const sign = includeSign && percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(decimals)}%`
}

/**
 * Format a decimal as a percentage
 * @param value - The raw percentage value (15 = 15%)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentRaw(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`
}

/**
 * Format file size in human-readable format
 * @param bytes - File size in bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted file size string
 */
export function formatFileSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i] ?? 'Bytes'}`
}

/**
 * Format a phone number (US format)
 * @param phoneNumber - Phone number string (digits only or with symbols)
 * @returns Formatted phone number
 */
export function formatPhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '')

  // Format as (XXX) XXX-XXXX
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/)
  if (match) {
    return `(${match[1]}) ${match[2]}-${match[3]}`
  }

  return phoneNumber
}

/**
 * Format a credit card number with spaces
 * @param cardNumber - Card number string
 * @returns Formatted card number (XXXX XXXX XXXX XXXX)
 */
export function formatCardNumber(cardNumber: string): string {
  // Remove all non-digit characters
  const cleaned = cardNumber.replace(/\D/g, '')

  // Add space every 4 digits
  return cleaned.match(/.{1,4}/g)?.join(' ') ?? cardNumber
}

/**
 * Mask a credit card number (show only last 4 digits)
 * @param cardNumber - Card number string
 * @returns Masked card number (**** **** **** 1234)
 */
export function maskCardNumber(cardNumber: string): string {
  const cleaned = cardNumber.replace(/\D/g, '')
  if (cleaned.length < 4) return '****'

  const last4 = cleaned.slice(-4)
  const masked = '*'.repeat(Math.max(0, cleaned.length - 4))

  return `${masked.match(/.{1,4}/g)?.join(' ') ?? ''} ${last4}`.trim()
}

/**
 * Capitalize the first letter of a string
 * @param str - String to capitalize
 * @returns Capitalized string
 */
export function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * Convert a string to title case
 * @param str - String to convert
 * @returns Title case string
 */
export function toTitleCase(str: string): string {
  if (!str) return ''
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Truncate a string with ellipsis
 * @param str - String to truncate
 * @param maxLength - Maximum length before truncation
 * @param ellipsis - Ellipsis string (default: '...')
 * @returns Truncated string
 */
export function truncate(str: string, maxLength: number, ellipsis: string = '...'): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - ellipsis.length) + ellipsis
}

/**
 * Format a duration in milliseconds to human-readable format
 * @param ms - Duration in milliseconds
 * @returns Formatted duration (e.g., "2h 30m", "45s")
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

/**
 * Format a number as an ordinal (1st, 2nd, 3rd, etc.)
 * @param num - Number to format
 * @returns Ordinal string
 */
export function formatOrdinal(num: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const value = num % 100

  return num + (suffixes[(value - 20) % 10] ?? suffixes[value] ?? suffixes[0] ?? '')
}
