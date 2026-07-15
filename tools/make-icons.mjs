import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Generates the extension icons. No image dependencies — a PNG is a signature
// plus three chunks, and zlib is built into node.
//
// Design: a broadcast/signal mark. Indigo tile with a near-white glyph, because
// a dark icon vanishes on a dark Chrome toolbar and a light one vanishes on a
// light toolbar — a coloured tile reads on both.

const OUT = join(process.cwd(), 'extension', 'icons')
const SIZES = [16, 32, 48, 128]
const SS = 4 // supersample factor; cheap anti-aliasing

const BG = [0x63, 0x66, 0xf1] // --accent
const FG = [0xf5, 0xf5, 0xf7]

// ---- png encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12: deflate, adaptive filtering, no interlace — all zero

  // Each scanline is prefixed with its filter byte; 0 = none.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- the mark ---------------------------------------------------------------

// Signed distance to a rounded rectangle centred on the origin.
function sdRoundRect(x, y, halfW, halfH, r) {
  const qx = Math.abs(x) - halfW + r
  const qy = Math.abs(y) - halfH + r
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

/**
 * Coverage of the glyph at a point in a -0.5..0.5 unit square: a dot with two
 * arcs radiating up-right, opened toward the top-right corner.
 */
function glyph(x, y) {
  // Origin sits low-left so the arcs have room to sweep.
  const ox = -0.22
  const oy = 0.28
  const dx = x - ox
  const dy = y - oy
  const dist = Math.hypot(dx, dy)

  // Dot
  if (dist < 0.075) return true

  // Only the wedge sweeping up and to the right.
  const angle = Math.atan2(-dy, dx) // 0 = right, +pi/2 = up
  if (angle < 0.02 || angle > Math.PI / 2 - 0.02) return false

  for (const r of [0.26, 0.42]) {
    if (Math.abs(dist - r) < 0.052) return true
  }
  return false
}

function render(size) {
  const dim = size * SS
  const rgba = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0
      let fgHits = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px * SS + sx + 0.5) / dim - 0.5
          const v = (py * SS + sy + 0.5) / dim - 0.5

          // Tile: a rounded square with a small margin.
          if (sdRoundRect(u, v, 0.47, 0.47, 0.14) > 0) continue
          bgHits++
          if (glyph(u, v)) fgHits++
        }
      }

      const total = SS * SS
      const alpha = bgHits / total
      const i = (py * size + px) * 4
      if (alpha === 0) continue

      // Blend glyph over tile, then apply tile coverage as alpha.
      const mix = fgHits / Math.max(bgHits, 1)
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - mix) + FG[c] * mix)
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }

  return encodePng(size, size, rgba)
}

mkdirSync(OUT, { recursive: true })
for (const size of SIZES) {
  const png = render(size)
  writeFileSync(join(OUT, `${size}.png`), png)
  console.log(`  icons/${size}.png  ${png.length} bytes`)
}
console.log('\ndone')
