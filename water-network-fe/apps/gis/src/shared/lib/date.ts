/**
 * Date Utilities
 *
 * Common date formatting and manipulation utilities using date-fns.
 */

import {
  format,
  formatDistance,
  formatDistanceToNow,
  parseISO,
  isValid,
  isToday,
  isYesterday,
  isThisWeek,
  isThisMonth,
  isThisYear,
} from 'date-fns'

/**
 * Format a date to a readable string
 * @param date - Date object, string, or timestamp
 * @param formatStr - Format string (default: 'MMM d, yyyy')
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | string | number,
  formatStr: string = 'MMM d, yyyy'
): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date)
    if (!isValid(dateObj)) {
      return 'Invalid date'
    }
    return format(dateObj, formatStr)
  } catch {
    return 'Invalid date'
  }
}

/**
 * Format a date to a relative time string (e.g., "2 hours ago")
 * @param date - Date object, string, or timestamp
 * @returns Relative time string
 */
export function formatRelativeTime(date: Date | string | number): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date)
    if (!isValid(dateObj)) {
      return 'Invalid date'
    }
    return formatDistanceToNow(dateObj, { addSuffix: true })
  } catch {
    return 'Invalid date'
  }
}

/**
 * Format the distance between two dates
 * @param date1 - First date
 * @param date2 - Second date
 * @returns Distance string
 */
export function formatDistanceBetween(
  date1: Date | string | number,
  date2: Date | string | number
): string {
  try {
    const dateObj1 = typeof date1 === 'string' ? parseISO(date1) : new Date(date1)
    const dateObj2 = typeof date2 === 'string' ? parseISO(date2) : new Date(date2)
    if (!isValid(dateObj1) || !isValid(dateObj2)) {
      return 'Invalid date'
    }
    return formatDistance(dateObj1, dateObj2, { addSuffix: true })
  } catch {
    return 'Invalid date'
  }
}

/**
 * Get a smart date format based on how recent the date is
 * @param date - Date object, string, or timestamp
 * @returns Smart formatted date string
 */
export function formatSmartDate(date: Date | string | number): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date)
    if (!isValid(dateObj)) {
      return 'Invalid date'
    }

    if (isToday(dateObj)) {
      return format(dateObj, 'h:mm a') // "2:30 PM"
    }

    if (isYesterday(dateObj)) {
      return `Yesterday at ${format(dateObj, 'h:mm a')}`
    }

    if (isThisWeek(dateObj)) {
      return format(dateObj, 'EEEE h:mm a') // "Monday 2:30 PM"
    }

    if (isThisMonth(dateObj)) {
      return format(dateObj, 'MMM d, h:mm a') // "Jan 15, 2:30 PM"
    }

    if (isThisYear(dateObj)) {
      return format(dateObj, 'MMM d') // "Jan 15"
    }

    return format(dateObj, 'MMM d, yyyy') // "Jan 15, 2024"
  } catch {
    return 'Invalid date'
  }
}

/**
 * Common date format presets
 */
export const dateFormats = {
  short: 'MM/dd/yyyy',
  medium: 'MMM d, yyyy',
  long: 'MMMM d, yyyy',
  full: 'EEEE, MMMM d, yyyy',
  time: 'h:mm a',
  dateTime: 'MMM d, yyyy h:mm a',
  iso: "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
} as const
