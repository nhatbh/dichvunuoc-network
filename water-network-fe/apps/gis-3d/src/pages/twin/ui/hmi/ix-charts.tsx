/** ECharts (with the Siemens iX classic-dark theme) as Solid components: gauges and 24 h trends. */
import { createEffect, onCleanup, onMount, type JSX } from 'solid-js'
import { echarts, IX_CHART_THEME, setupIx } from './ix'
import type { EChartsOption } from 'echarts'

export function EChart(props: { option: EChartsOption; style?: JSX.CSSProperties; class?: string }) {
  let el!: HTMLDivElement
  let chart: ReturnType<typeof echarts.init> | null = null
  onMount(() => {
    setupIx()
    chart = echarts.init(el, IX_CHART_THEME, { renderer: 'canvas' })
    chart.setOption(props.option)
    const ro = new ResizeObserver(() => chart?.resize())
    ro.observe(el)
    onCleanup(() => {
      ro.disconnect()
      chart?.dispose()
    })
  })
  createEffect(() => {
    const o = props.option
    chart?.setOption(o, { lazyUpdate: true })
  })
  return <div ref={el} class={props.class} style={{ width: '100%', height: '100%', ...props.style }} />
}

/** Bands as fractions of the scale: [upTo, colour] (iX status colours). */
export function gaugeOption(p: { name: string; value: number; min: number; max: number; unit: string; digits?: number; bands: Array<[number, string]> }): EChartsOption {
  return {
    backgroundColor: 'transparent',
    series: [
      {
        type: 'gauge',
        min: p.min,
        max: p.max,
        radius: '92%',
        center: ['50%', '58%'],
        startAngle: 210,
        endAngle: -30,
        splitNumber: 5,
        axisLine: { lineStyle: { width: 10, color: p.bands } },
        pointer: { width: 4, length: '62%' },
        axisTick: { distance: -10, length: 4 },
        splitLine: { distance: -10, length: 10 },
        axisLabel: { distance: 14, fontSize: 9 },
        anchor: { show: true, size: 8 },
        title: { offsetCenter: [0, '78%'], fontSize: 11 },
        detail: { valueAnimation: true, offsetCenter: [0, '40%'], fontSize: 18, fontWeight: 700, formatter: (v: number) => `${v.toFixed(p.digits ?? 1).replace('.', ',')} ${p.unit}` },
        data: [{ value: p.value, name: p.name }],
      },
    ],
  }
}

/** 24 h trend: samples every 5 sim-minutes ending now; optional green limit band. */
export function trendOption(p: { series: Array<{ name: string; data: number[]; unit: string }>; band?: [number, number]; min?: number; max?: number; endClock: number }): EChartsOption {
  const n = Math.max(...p.series.map(s => s.data.length), 2)
  const labels = Array.from({ length: n }, (_, i) => {
    const t = (((p.endClock - (n - 1 - i) * 300) % 86400) + 86400) % 86400
    return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`
  })
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 44, right: 16, top: 30, bottom: 26 },
    tooltip: { trigger: 'axis' },
    legend: { top: 2, right: 8, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { interval: Math.floor(n / 6), fontSize: 10 } },
    yAxis: { type: 'value', min: p.min, max: p.max, scale: p.min === undefined, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.25 } } },
    series: p.series.map((s, i) => ({
      name: `${s.name} (${s.unit})`,
      type: 'line',
      data: s.data.map(v => Math.round(v * 100) / 100),
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { width: 1.8 },
      areaStyle: i === 0 ? { opacity: 0.08 } : undefined,
      markArea: i === 0 && p.band ? { silent: true, itemStyle: { color: 'rgba(68,204,0,0.08)' }, data: [[{ yAxis: p.band[0] }, { yAxis: p.band[1] }]] } : undefined,
    })),
  }
}
