/**
 * Siemens Industrial Experience (iX, MIT) for the twin's HMI / SCADA screens, plus ECharts with the iX theme.
 *
 * Only the iX "classic" theme tokens are loaded (scoped by `data-ix-theme="classic" data-ix-color-schema="dark"`
 * on the SCADA container), not iX's global stylesheet: the rest of the app keeps its own look.
 * iX components are Stencil web components; Solid renders them as custom elements (`prop:` for non-string
 * properties, `on:` for their custom events).
 */
import '@siemens/ix/dist/siemens-ix/theme/classic-dark.css'
import './ix-scoped.css'
import { defineCustomElements } from '@siemens/ix/loader'
import { registerTheme } from '@siemens/ix-echarts'
import { defineCustomElements as defineIcons } from '@siemens/ix-icons/loader'
import * as echarts from 'echarts'

let ready = false
export function setupIx() {
  if (ready) return
  ready = true
  defineCustomElements(window)
  defineIcons(window)
  registerTheme(echarts)
}

/** ECharts theme registered by @siemens/ix-echarts for the classic dark scheme. */
export const IX_CHART_THEME = 'theme-classic-dark'
export { echarts }

/** iX status colours (theme tokens), for the SVG mimics. */
export const IX = {
  bg: 'var(--theme-color-1)',
  surface: 'var(--theme-color-2)',
  text: 'var(--theme-color-std-text)',
  soft: 'var(--theme-color-soft-text)',
  weak: 'var(--theme-color-weak-text)',
  border: 'var(--theme-color-soft-bdr)',
  weakBorder: 'var(--theme-color-weak-bdr)',
  primary: 'var(--theme-color-primary)',
  success: 'var(--theme-color-success)',
  warning: 'var(--theme-color-warning)',
  alarm: 'var(--theme-color-alarm)',
  critical: 'var(--theme-color-critical)',
  neutral: 'var(--theme-color-neutral)',
  info: 'var(--theme-color-info)',
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stencil custom elements, typed loosely for Solid JSX */
type IxEl = any
declare module 'solid-js' {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Solid's JSX typings are a namespace; this augments them
  namespace JSX {
    interface IntrinsicElements {
      'ix-kpi': IxEl
      'ix-pill': IxEl
      'ix-chip': IxEl
      'ix-tabs': IxEl
      'ix-tab-item': IxEl
      'ix-button': IxEl
      'ix-icon-button': IxEl
      'ix-icon': IxEl
      'ix-toggle': IxEl
      'ix-slider': IxEl
      'ix-key-value': IxEl
      'ix-key-value-list': IxEl
      'ix-event-list': IxEl
      'ix-event-list-item': IxEl
      'ix-typography': IxEl
      'ix-card': IxEl
      'ix-card-content': IxEl
      'ix-card-title': IxEl
      'ix-divider': IxEl
      'ix-message-bar': IxEl
      'ix-spinner': IxEl
      'ix-blind': IxEl
    }
  }
}
