/**
 * SVG mimic primitives for the mock HMI / SCADA screens (P&ID style, dark operator theme).
 * Every equipment symbol is clickable and opens its faceplate; colours follow the plant state
 * (running green, manual amber, stopped grey, fault red blinking).
 */
import { Show, type JSX, For } from 'solid-js'
import { IX } from './ix'

export type MimicState = 'run' | 'man' | 'stop' | 'fault' | 'na' | 'travel'
/** state colours: Siemens iX classic theme tokens (CSS variables, so they are applied through `style`) */
export const FILL: Record<MimicState, string> = { run: IX.success, man: IX.warning, stop: IX.neutral, fault: IX.alarm, na: IX.neutral, travel: IX.warning }
export const FLUID: Record<string, string> = { raw: '#a07c4c', settled: '#5fa8a0', clean: '#3c9be8', chem: '#d9a21b', cl: '#8fc93a', air: '#c9d4dc', waste: '#7b6650', wash: '#62c0f0' }

export function Pipe(props: { d: string; fluid?: keyof typeof FLUID; flow?: boolean; w?: number }) {
  return (
    <>
      <path d={props.d} fill="none" style={{ stroke: IX.bg }} stroke-width={(props.w ?? 6) + 3} stroke-linejoin="round" />
      <path d={props.d} fill="none" stroke={FLUID[props.fluid ?? 'clean']} stroke-width={props.w ?? 6} stroke-linejoin="round" />
      <Show when={props.flow}>
        <path d={props.d} fill="none" stroke="rgba(255,255,255,.55)" stroke-width={Math.max(1.5, (props.w ?? 6) / 3)} class="hm-flow" stroke-linejoin="round" />
      </Show>
    </>
  )
}

function Clickable(props: { tag?: string; onOpen?: (t: string) => void; children: JSX.Element; title?: string }) {
  return (
    <g class={props.tag ? 'hm-click' : undefined} onClick={() => props.tag && props.onOpen?.(props.tag)} role={props.tag ? 'button' : undefined} aria-label={props.title ?? props.tag}>
      {props.children}
    </g>
  )
}

export function Pump(props: { tag: string; x: number; y: number; r?: number; state: MimicState; onOpen?: (t: string) => void; label?: string; sub?: string; rot?: number }) {
  const r = () => props.r ?? 15
  return (
    <Clickable tag={props.tag} onOpen={props.onOpen}>
      <g transform={`translate(${props.x} ${props.y}) rotate(${props.rot ?? 0})`}>
        <circle r={r()} style={{ fill: FILL[props.state], stroke: IX.text }} stroke-width="2" class={props.state === 'fault' ? 'hm-blink' : undefined} />
        <path d={`M${-r() * 0.45} ${-r() * 0.55}L${r() * 0.65} 0L${-r() * 0.45} ${r() * 0.55}Z`} style={{ fill: IX.bg }} />
      </g>
      <text x={props.x} y={props.y + r() + 13} class="hm-tag" text-anchor="middle">
        {props.label ?? props.tag}
      </text>
      <Show when={props.sub}>
        <text x={props.x} y={props.y + r() + 25} class="hm-sub" text-anchor="middle">
          {props.sub}
        </text>
      </Show>
    </Clickable>
  )
}

export function Valve(props: { tag: string; x: number; y: number; open: number; vertical?: boolean; onOpen?: (t: string) => void; label?: boolean; s?: number }) {
  const s = () => props.s ?? 10
  const fill = () => (props.open > 0.98 ? FILL.run : props.open < 0.02 ? FILL.fault : FILL.travel)
  return (
    <Clickable tag={props.tag} onOpen={props.onOpen}>
      <g transform={`translate(${props.x} ${props.y}) rotate(${props.vertical ? 90 : 0})`}>
        <path d={`M${-s()} ${-s() * 0.7}L0 0L${-s()} ${s() * 0.7}ZM${s()} ${-s() * 0.7}L0 0L${s()} ${s() * 0.7}Z`} style={{ fill: fill(), stroke: IX.text }} stroke-width="1.5" />
        <rect x={-s() * 0.45} y={-s() * 1.9} width={s() * 0.9} height={s() * 0.8} style={{ fill: IX.warning, stroke: IX.bg }} />
        <line x1="0" y1={-s() * 1.1} x2="0" y2="0" style={{ stroke: IX.text }} stroke-width="1.5" />
      </g>
      <Show when={props.label !== false}>
        <text x={props.x} y={props.y + s() + 14} class="hm-tag" text-anchor="middle">
          {props.tag}
        </text>
      </Show>
    </Clickable>
  )
}

export function Motor(props: { tag: string; x: number; y: number; state: MimicState; onOpen?: (t: string) => void; letter?: string; label?: string }) {
  return (
    <Clickable tag={props.tag} onOpen={props.onOpen}>
      <circle cx={props.x} cy={props.y} r="11" style={{ fill: FILL[props.state], stroke: IX.text }} stroke-width="1.5" class={props.state === 'fault' ? 'hm-blink' : undefined} />
      <text x={props.x} y={props.y + 4} class="hm-letter" text-anchor="middle">
        {props.letter ?? 'M'}
      </text>
      <text x={props.x} y={props.y - 15} class="hm-tag" text-anchor="middle">
        {props.label ?? props.tag}
      </text>
    </Clickable>
  )
}

export function Tank(props: { x: number; y: number; w: number; h: number; level: number; label?: string; fluid?: keyof typeof FLUID; tag?: string; onOpen?: (t: string) => void; open?: boolean }) {
  const lv = () => Math.max(0, Math.min(1, props.level))
  return (
    <Clickable tag={props.tag} onOpen={props.onOpen}>
      <rect x={props.x} y={props.y} width={props.w} height={props.h} style={{ fill: IX.bg, stroke: IX.border }} stroke-width="2" />
      <rect x={props.x + 2} y={props.y + props.h - (props.h - 4) * lv() - 2} width={props.w - 4} height={(props.h - 4) * lv()} fill={FLUID[props.fluid ?? 'clean']} opacity="0.85" />
      <Show when={props.open === false}>
        <line x1={props.x} y1={props.y} x2={props.x + props.w} y2={props.y} style={{ stroke: IX.border }} stroke-width="4" />
      </Show>
      <Show when={props.label}>
        <text x={props.x + props.w / 2} y={props.y - 7} class="hm-title" text-anchor="middle">
          {props.label}
        </text>
      </Show>
      <text x={props.x + props.w / 2} y={props.y + props.h / 2 + 4} class="hm-pct" text-anchor="middle">
        {Math.round(lv() * 100)} %
      </text>
    </Clickable>
  )
}

export function Value(props: { x: number; y: number; label: string; value: string; unit?: string; warn?: boolean; tag?: string; onOpen?: (t: string) => void; w?: number }) {
  const w = () => props.w ?? 118
  return (
    <Clickable tag={props.tag} onOpen={props.onOpen}>
      <rect x={props.x} y={props.y} width={w()} height="34" rx="3" style={{ fill: IX.bg, stroke: props.warn ? IX.alarm : IX.weakBorder }} stroke-width={props.warn ? 2 : 1} class={props.warn ? 'hm-blink-soft' : undefined} />
      <text x={props.x + 6} y={props.y + 12} class="hm-label">
        {props.label}
      </text>
      <text x={props.x + w() - 6} y={props.y + 28} class={props.warn ? 'hm-val warn' : 'hm-val'} text-anchor="end">
        {props.value}
        <tspan class="hm-unit"> {props.unit}</tspan>
      </text>
    </Clickable>
  )
}

export function Box(props: { x: number; y: number; w: number; h: number; label?: string; fill?: string; tag?: string; onOpen?: (t: string) => void; children?: JSX.Element }) {
  return (
    <Clickable tag={props.tag} onOpen={props.onOpen}>
      <rect x={props.x} y={props.y} width={props.w} height={props.h} style={{ fill: props.fill ?? IX.bg, stroke: IX.border }} stroke-width="1.5" />
      <Show when={props.label}>
        <text x={props.x + props.w / 2} y={props.y - 6} class="hm-title" text-anchor="middle">
          {props.label}
        </text>
      </Show>
      {props.children}
    </Clickable>
  )
}

export function Bar(props: { x: number; y: number; w: number; value: number; max: number; warnAt?: number; label?: string }) {
  const k = () => Math.max(0, Math.min(1, props.value / props.max))
  return (
    <>
      <rect x={props.x} y={props.y} width={props.w} height="7" style={{ fill: IX.bg, stroke: IX.weakBorder }} />
      <rect x={props.x + 1} y={props.y + 1} width={(props.w - 2) * k()} height="5" style={{ fill: props.warnAt !== undefined && props.value > props.warnAt ? IX.warning : IX.primary }} />
      <Show when={props.label}>
        <text x={props.x + props.w / 2} y={props.y + 19} class="hm-sub" text-anchor="middle">
          {props.label}
        </text>
      </Show>
    </>
  )
}

export function Trend(props: { x: number; y: number; w: number; h: number; data: number[]; color: string; label: string; unit: string; min?: number; max?: number; band?: [number, number] }) {
  const lo = () => props.min ?? Math.min(...props.data)
  const hi = () => props.max ?? Math.max(...props.data)
  const yOf = (v: number) => props.y + props.h - ((v - lo()) / (hi() - lo() || 1)) * (props.h - 4) - 2
  const d = () => props.data.map((v, i) => `${i ? 'L' : 'M'}${(props.x + (i / Math.max(1, props.data.length - 1)) * props.w).toFixed(1)} ${yOf(v).toFixed(1)}`).join('')
  const last = () => props.data[props.data.length - 1] ?? 0
  return (
    <>
      <rect x={props.x} y={props.y} width={props.w} height={props.h} style={{ fill: IX.bg, stroke: IX.weakBorder }} />
      <Show when={props.band}>
        {b => {
          const top = () => Math.max(props.y, Math.min(props.y + props.h, yOf(b()[1])))
          const bottom = () => Math.max(props.y, Math.min(props.y + props.h, yOf(b()[0])))
          return <rect x={props.x} y={top()} width={props.w} height={Math.max(0, bottom() - top())} style={{ fill: IX.success }} opacity="0.12" />
        }}
      </Show>
      <For each={[0.25, 0.5, 0.75]}>{k => (
        <line x1={props.x} x2={props.x + props.w} y1={props.y + props.h * k} y2={props.y + props.h * k} style={{ stroke: IX.weakBorder }} opacity="0.4" />
      )}</For>
      <path d={d()} fill="none" stroke={props.color} stroke-width="1.8" />
      <text x={props.x + 6} y={props.y + 14} class="hm-label">
        {props.label}
      </text>
      <text x={props.x + props.w - 6} y={props.y + 16} class="hm-val" text-anchor="end">
        {last().toLocaleString('vi-VN', { maximumFractionDigits: last() > 50 ? 0 : 2 })}
        <tspan class="hm-unit"> {props.unit}</tspan>
      </text>
      <text x={props.x + 4} y={props.y + props.h - 4} class="hm-sub">
        −24 h
      </text>
      <text x={props.x + props.w - 4} y={props.y + props.h - 4} class="hm-sub" text-anchor="end">
        bây giờ
      </text>
    </>
  )
}

/** Clickable command button drawn in the mimic (e.g. "Rửa lọc"). */
export function MimicButton(props: { x: number; y: number; w?: number; label: string; onClick: () => void; disabled?: boolean; tone?: 'ok' | 'danger' | 'primary' }) {
  const w = () => props.w ?? 76
  return (
    <g class={props.disabled ? 'hm-btn disabled' : 'hm-btn'} onClick={() => !props.disabled && props.onClick()} role="button" aria-label={props.label}>
      <rect x={props.x} y={props.y} width={w()} height="22" rx="3" class={`hm-btn-bg ${props.tone ?? ''}`} />
      <text x={props.x + w() / 2} y={props.y + 15} text-anchor="middle" class="hm-btn-t">
        {props.label}
      </text>
    </g>
  )
}
