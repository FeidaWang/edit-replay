// The band's drawings: a summary of the replay and the desktop's SVGs. Pure:
// no `$`, so the tests read it directly. Sized to sit beside Token Weather's
// band (a 28px icon, a 20px-high strip of 7px cells).

import type { ReplayStep } from '../types'

export const PX_PER_CELL = 7
export const ADD = '#0ca30c'
export const DEL = '#d03b3b'
const IDLE = '#8a8f98'
const ACCENT_FROM = '#e2639b'
const ACCENT_TO = '#9b5de5'

export type Summary = { edits: number; files: number; add: number; del: number; edit: number; write: number }

export function summarize(steps: readonly ReplayStep[]): Summary {
  let add = 0
  let del = 0
  let edit = 0
  for (const s of steps) {
    add += s.add
    del += s.del
    if (s.tool === 'Edit') edit++
  }
  return { edits: steps.length, files: new Set(steps.map(s => s.file)).size, add, del, edit, write: steps.length - edit }
}

export type Frame = { add: number; del: number }

// One frame per step, or, past `max`, runs of neighbouring steps summed into
// one frame each, so the strip keeps its order at any length.
export function frames(steps: readonly ReplayStep[], max: number): Frame[] {
  const n = Math.max(1, Math.min(steps.length, Math.floor(max)))
  const out: Frame[] = Array.from({ length: n }, () => ({ add: 0, del: 0 }))
  steps.forEach((s, k) => {
    const f = out[Math.floor((k * n) / steps.length)]!
    f.add += s.add
    f.del += s.del
  })
  return out
}

export function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}

const iconCache = new Map<number, string>()

// A frame of film with its sprocket holes rolling by and a play mark that
// breathes: the replay's icon, beside the weather's sky. Built once per size.
export function iconSvg(size: number): string {
  let svg = iconCache.get(size)
  if (svg === undefined) {
    svg = buildIcon(size)
    iconCache.set(size, svg)
  }
  return svg
}

function buildIcon(size: number): string {
  const holes = (y: number) =>
    Array.from({ length: 7 }, (_, k) => `<rect x="${3 + k * 5}" y="${y}" width="2.6" height="2" rx=".6"/>`).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
    '<style>' +
    '@keyframes roll{from{transform:translateX(0)}to{transform:translateX(-5px)}}' +
    '@keyframes breathe{0%,100%{transform:scale(.88)}50%{transform:scale(1.06)}}' +
    '@keyframes glow{0%,100%{opacity:.5}50%{opacity:1}}' +
    '.roll{animation:roll .9s linear infinite}' +
    '.play{transform-box:fill-box;transform-origin:center;animation:breathe 2.4s ease-in-out infinite}' +
    '.glow{animation:glow 2.4s ease-in-out infinite}' +
    '</style>' +
    '<defs>' +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ACCENT_FROM}"/><stop offset="1" stop-color="${ACCENT_TO}"/></linearGradient>` +
    '<clipPath id="f"><rect x="3" y="6" width="26" height="20" rx="4.5"/></clipPath>' +
    '</defs>' +
    `<rect class="glow" x="1" y="4" width="30" height="24" rx="6" fill="${ACCENT_FROM}" fill-opacity=".4"/>` +
    '<rect x="3" y="6" width="26" height="20" rx="4.5" fill="url(#g)"/>' +
    `<g clip-path="url(#f)" fill="#fff" fill-opacity=".55"><g class="roll">${holes(7.5)}${holes(22.5)}</g></g>` +
    '<path class="play" d="M13.2 11.6 21.4 16 13.2 20.4Z" fill="#fff"/>' +
    '</svg>'
  )
}

// The replay as a strip of film: a frame per step (or per run of steps), its
// green and red split by the lines it added and removed, and a playhead of
// light sweeping across, again and again.
export function stripSvg(fs: readonly Frame[], w: number): string {
  const h = 20
  const y = 5
  const bh = 10
  const fw = w / fs.length
  const gap = fs.length > 1 ? Math.min(2, fw / 4) : 0
  const cells = fs
    .map((f, k) => {
      const x = k * fw + gap / 2
      const cw = Math.max(0.5, fw - gap)
      const sum = f.add + f.del
      if (sum === 0) return `<rect x="${x.toFixed(1)}" y="${y}" width="${cw.toFixed(1)}" height="${bh}" fill="${IDLE}" fill-opacity=".45"/>`
      const aw = (cw * f.add) / sum
      return (
        (aw > 0 ? `<rect x="${x.toFixed(1)}" y="${y}" width="${aw.toFixed(1)}" height="${bh}" fill="${ADD}"/>` : '') +
        (cw - aw > 0
          ? `<rect x="${(x + aw).toFixed(1)}" y="${y}" width="${(cw - aw).toFixed(1)}" height="${bh}" fill="${DEL}"/>`
          : '')
      )
    })
    .join('')
  const sweep = w + 16
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    '<style>' +
    `@keyframes sweep{0%{transform:translateX(0);opacity:0}8%{opacity:1}88%{opacity:1}100%{transform:translateX(${sweep}px);opacity:0}}` +
    '.head{animation:sweep 2.8s cubic-bezier(.45,0,.55,1) infinite}' +
    '</style>' +
    '<defs>' +
    `<clipPath id="t"><rect x="0" y="${y}" width="${w}" height="${bh}" rx="3"/></clipPath>` +
    '<linearGradient id="p" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".75"/>' +
    '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '</defs>' +
    `<rect x="0" y="${y}" width="${w}" height="${bh}" rx="3" fill="${IDLE}" fill-opacity=".15"/>` +
    `<g clip-path="url(#t)">${cells}</g>` +
    `<g class="head"><rect x="-16" y="${y - 3}" width="14" height="${bh + 6}" rx="2" fill="url(#p)"/>` +
    `<rect x="-3" y="${y - 3}" width="2" height="${bh + 6}" rx="1" fill="#fff" fill-opacity=".9"/></g>` +
    '</svg>'
  )
}
