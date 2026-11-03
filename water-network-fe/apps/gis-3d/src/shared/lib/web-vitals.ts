/**
 * Web Vitals Performance Tracking
 *
 * Tracks Core Web Vitals (CLS, FID, LCP) and other performance metrics.
 * Sends data to analytics or monitoring services.
 *
 * Core Web Vitals:
 * - CLS (Cumulative Layout Shift): Visual stability
 * - FID (First Input Delay): Interactivity (deprecated, use INP)
 * - LCP (Largest Contentful Paint): Loading performance
 *
 * Additional metrics:
 * - FCP (First Contentful Paint): Initial render
 * - TTFB (Time to First Byte): Server response time
 * - INP (Interaction to Next Paint): Responsiveness (new metric)
 *
 * @see https://web.dev/vitals/
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import { env } from '@/shared/config/env'

/**
 * Performance metrics interface
 */
export interface PerformanceMetric {
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  delta: number
  id: string
  navigationType: string
}

/**
 * Convert web-vitals Metric to our PerformanceMetric format
 */
function formatMetric(metric: Metric): PerformanceMetric {
  return {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType,
  }
}

/**
 * Send metric to analytics service
 *
 * Customize this function to send to your preferred analytics service:
 * - Google Analytics
 * - Sentry Performance Monitoring
 * - Custom analytics endpoint
 * - DataDog, New Relic, etc.
 */
function sendToAnalytics(metric: PerformanceMetric): void {
  // Log to console in development
  if (env.NODE_ENV === 'development' || env.VITE_DEBUG_MODE === 'true') {
    console.log('[Web Vitals]', metric.name, {
      value: `${metric.value.toFixed(2)}ms`,
      rating: metric.rating,
      id: metric.id,
    })
  }

  // Send to Google Analytics (if configured)
  if (typeof window !== 'undefined' && 'gtag' in window) {
    // @ts-expect-error - gtag is globally available when GA is loaded
    window.gtag('event', metric.name, {
      value: Math.round(metric.value),
      metric_id: metric.id,
      metric_value: metric.value,
      metric_delta: metric.delta,
      metric_rating: metric.rating,
    })
  }

  // Send to custom analytics endpoint
  if (env.VITE_API_URL) {
    // Batch metrics and send periodically to avoid too many requests
    queueMetric(metric)
  }

  // Send to Sentry Performance Monitoring (if enabled)
  if (env.VITE_SENTRY_ENABLED === 'true' && typeof window !== 'undefined') {
    // Sentry will automatically collect these if performance monitoring is enabled
    // You can also manually send: Sentry.metrics.distribution(metric.name, metric.value)
  }
}

/**
 * Metric queue for batching
 */
let metricQueue: PerformanceMetric[] = []
let sendTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Queue metric for batched sending
 */
function queueMetric(metric: PerformanceMetric): void {
  metricQueue.push(metric)

  // Send batch after 5 seconds of inactivity
  if (sendTimeout) {
    clearTimeout(sendTimeout)
  }

  sendTimeout = setTimeout(() => {
    sendMetricBatch()
  }, 5000)
}

/**
 * Send batched metrics to server
 */
async function sendMetricBatch(): Promise<void> {
  if (metricQueue.length === 0) return

  const metricsToSend = [...metricQueue]
  metricQueue = []

  try {
    // Send to your custom analytics endpoint
    // await httpClient.post('/api/analytics/web-vitals', { metrics: metricsToSend })

    // For now, just log in non-production
    if (env.NODE_ENV !== 'production') {
      console.log('[Web Vitals] Batch sent:', metricsToSend.length, 'metrics')
    }
  } catch (error) {
    console.error('[Web Vitals] Failed to send metrics:', error)
  }
}

/**
 * Initialize Web Vitals tracking
 *
 * Call this function once when your app starts (e.g., in app initialization).
 *
 * @example
 * ```typescript
 * // In src/app/providers.tsx
 * useEffect(() => {
 *   initWebVitals()
 * }, [])
 * ```
 */
export function initWebVitals(): void {
  // Check if performance monitoring is enabled
  if (env.VITE_ENABLE_PERFORMANCE_MONITORING !== 'true') {
    console.log('[Web Vitals] Performance monitoring is disabled')
    return
  }

  // Check if browser supports Performance API
  if (typeof window === 'undefined' || !('performance' in window)) {
    console.warn('[Web Vitals] Performance API not supported in this browser')
    return
  }

  console.log('[Web Vitals] Initializing performance monitoring...')

  // Track Cumulative Layout Shift (CLS)
  // Good: < 0.1, Needs Improvement: 0.1-0.25, Poor: > 0.25
  onCLS(metric => {
    sendToAnalytics(formatMetric(metric))
  })

  // Track Interaction to Next Paint (INP) - Replaces FID
  // Good: < 200ms, Needs Improvement: 200-500ms, Poor: > 500ms
  onINP(metric => {
    sendToAnalytics(formatMetric(metric))
  })

  // Track Largest Contentful Paint (LCP)
  // Good: < 2.5s, Needs Improvement: 2.5-4s, Poor: > 4s
  onLCP(metric => {
    sendToAnalytics(formatMetric(metric))
  })

  // Track First Contentful Paint (FCP)
  // Good: < 1.8s, Needs Improvement: 1.8-3s, Poor: > 3s
  onFCP(metric => {
    sendToAnalytics(formatMetric(metric))
  })

  // Track Time to First Byte (TTFB)
  // Good: < 800ms, Needs Improvement: 800-1800ms, Poor: > 1800ms
  onTTFB(metric => {
    sendToAnalytics(formatMetric(metric))
  })

  // Send any remaining metrics before page unload
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sendMetricBatch()
    }
  })

  console.log('[Web Vitals] Performance monitoring initialized')
}

/**
 * Manually report a custom performance metric
 *
 * @param name - Metric name
 * @param value - Metric value in milliseconds
 *
 * @example
 * ```typescript
 * const start = performance.now()
 * await heavyOperation()
 * const duration = performance.now() - start
 * reportCustomMetric('heavy-operation-duration', duration)
 * ```
 */
export function reportCustomMetric(name: string, value: number): void {
  const metric: PerformanceMetric = {
    name: `custom-${name}`,
    value,
    rating: 'good', // You can add custom rating logic
    delta: value,
    id: `custom-${Date.now()}`,
    navigationType: 'custom',
  }

  sendToAnalytics(metric)
}

/**
 * Get current Web Vitals scores
 *
 * @returns Promise with current metric values
 */
export async function getWebVitalsScores(): Promise<Record<string, number>> {
  return new Promise(resolve => {
    const scores: Record<string, number> = {}

    onCLS(metric => (scores.CLS = metric.value))
    onINP(metric => (scores.INP = metric.value))
    onLCP(metric => (scores.LCP = metric.value))
    onFCP(metric => (scores.FCP = metric.value))
    onTTFB(metric => (scores.TTFB = metric.value))

    // Wait for all metrics to be collected
    setTimeout(() => {
      resolve(scores)
    }, 3000)
  })
}

/**
 * Check if Web Vitals score is "good"
 *
 * @param name - Metric name (CLS, INP, LCP, etc.)
 * @param value - Metric value
 * @returns True if score is in "good" range
 */
export function isGoodScore(name: string, value: number): boolean {
  const thresholds: Record<string, number> = {
    CLS: 0.1,
    INP: 200,
    LCP: 2500,
    FCP: 1800,
    TTFB: 800,
  }

  return value <= (thresholds[name] || 0)
}
