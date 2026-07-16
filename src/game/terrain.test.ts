/**
 * 지형 회귀 테스트.
 *
 * 제일 무서운 건 크래시가 아니라 "갇히는 시드"다. 크래시는 눈에 띄지만
 * 갇힌 판은 그냥 재미없는 판처럼 보이고, 그게 데일리 시드면 그날 전 세계가 당한다.
 */
import { describe, expect, it } from 'vitest'
import { CELL, Terrain } from './terrain'
import { WORLD_R } from './game'

function build(seed: number): Terrain {
  const t = new Terrain(WORLD_R)
  t.generate(seed, WORLD_R, 1)
  return t
}

/** 시작점(0,0)에서 flood fill 해 닿는 빈 셀 수 / 전체 빈 셀 수 (월드 안쪽만) */
function reachableRatio(t: Terrain): number {
  const { cols, rows } = t
  const seen = new Uint8Array(cols * rows)
  const inside = (cx: number, cy: number): boolean => {
    const wx = t.originX + cx * CELL + CELL * 0.5
    const wy = t.originY + cy * CELL + CELL * 0.5
    return Math.hypot(wx, wy) < WORLD_R - CELL * 2
  }

  const sx = t.cellX(0)
  const sy = t.cellY(0)
  const stack = [sy * cols + sx]
  seen[sy * cols + sx] = 1
  let reached = 0

  while (stack.length > 0) {
    const cur = stack.pop()!
    const cx = cur % cols
    const cy = (cur / cols) | 0
    if (inside(cx, cy)) reached++
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0)
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0)
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const ni = ny * cols + nx
      if (seen[ni] === 1 || t.hp[ni]! > 0) continue
      seen[ni] = 1
      stack.push(ni)
    }
  }

  let total = 0
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (t.hp[cy * cols + cx]! > 0) continue
      if (inside(cx, cy)) total++
    }
  }
  return total === 0 ? 1 : reached / total
}

const SEEDS = [1, 2, 3, 42, 99, 1337, 2026, 8888, 31337, 65535]

describe('지형', () => {
  it('같은 시드 = 같은 맵', () => {
    for (const s of [1, 42, 1337]) {
      const a = build(s)
      const b = build(s)
      expect(Array.from(a.hp), `seed ${s}`).toEqual(Array.from(b.hp))
    }
  })

  it('다른 시드 = 다른 맵', () => {
    const a = build(1)
    const b = build(2)
    expect(Array.from(a.hp)).not.toEqual(Array.from(b.hp))
  })

  it('시작 지점이 항상 뚫려 있다 (스폰하자마자 벽에 끼면 안 된다)', () => {
    for (const s of SEEDS) {
      expect(t_solidNear(build(s), 0, 0, 90), `seed ${s}`).toBe(false)
    }
  })

  it('플레이어가 갇히는 시드가 없다 (닿을 수 있는 빈 칸 95% 이상)', () => {
    for (const s of SEEDS) {
      const ratio = reachableRatio(build(s))
      expect(ratio, `seed ${s} 도달률 ${(ratio * 100).toFixed(1)}%`).toBeGreaterThan(0.95)
    }
  })

  it('지형이 맵 한쪽으로 쏠리지 않는다', () => {
    // 실제로 있었던 버그: 2번째 옥타브가 좌표를 2.7배로 늘리는데 노이즈 격자는
    // 원본 크기라, 범위 밖 인덱스가 Float32Array 에서 undefined → NaN 이 되고
    // `NaN > threshold` 가 항상 false 라 맵의 왼쪽 위 구석에만 지형이 남았다.
    // solidRatio 는 10%로 멀쩡해 보였기 때문에 총량으로는 절대 못 잡는다.
    for (const s of [1, 42, 1337, 2026]) {
      const t = build(s)
      const mid = t.cols / 2
      const solidQ = [0, 0, 0, 0]
      const totalQ = [0, 0, 0, 0]
      for (let cy = 0; cy < t.rows; cy++) {
        for (let cx = 0; cx < t.cols; cx++) {
          const wx = t.originX + cx * CELL + CELL * 0.5
          const wy = t.originY + cy * CELL + CELL * 0.5
          // 경계 근처는 원래 비우므로 안쪽만 센다
          if (Math.hypot(wx, wy) > WORLD_R * 0.72) continue
          const qi = (cx > mid ? 1 : 0) + (cy > mid ? 2 : 0)
          totalQ[qi]!++
          if (t.hp[cy * t.cols + cx]! > 0) solidQ[qi]!++
        }
      }
      for (let q = 0; q < 4; q++) {
        const d = solidQ[q]! / Math.max(1, totalQ[q]!)
        expect(d, `seed ${s} 사분면 ${q} 밀도 ${(d * 100).toFixed(1)}%`).toBeGreaterThan(0.03)
      }
    }
  })

  it('맵이 비지도 꽉 차지도 않는다', () => {
    for (const s of SEEDS) {
      const r = build(s).solidRatio()
      expect(r, `seed ${s} 밀도 ${(r * 100).toFixed(1)}%`).toBeGreaterThan(0.02)
      expect(r, `seed ${s} 밀도 ${(r * 100).toFixed(1)}%`).toBeLessThan(0.42)
    }
  })

  it('부수면 뚫린다', () => {
    const t = build(42)
    // 아무 단단한 셀이나 하나 찾아 두들긴다
    let found = -1
    for (let i = 0; i < t.hp.length; i++) {
      if (t.hp[i]! > 0) { found = i; break }
    }
    expect(found).toBeGreaterThanOrEqual(0)
    const cx = found % t.cols
    const cy = (found / t.cols) | 0
    expect(t.hpAt(cx, cy)).toBeGreaterThan(0)
    let broke = false
    for (let k = 0; k < 200 && !broke; k++) broke = t.damageCell(cx, cy, 5, 1)
    expect(broke).toBe(true)
    expect(t.hpAt(cx, cy)).toBe(0)
    // 이미 뚫린 곳을 또 때려도 true 를 반환하면 파괴 연출이 무한 반복된다
    expect(t.damageCell(cx, cy, 5, 1)).toBe(false)
  })

  it('월드 밖은 지형이 없다', () => {
    const t = build(7)
    for (let cy = 0; cy < t.rows; cy++) {
      for (let cx = 0; cx < t.cols; cx++) {
        const wx = t.originX + cx * CELL + CELL * 0.5
        const wy = t.originY + cy * CELL + CELL * 0.5
        if (Math.hypot(wx, wy) > WORLD_R) {
          expect(t.hp[cy * t.cols + cx]).toBe(0)
        }
      }
    }
  })

  it('벽에 파묻힌 원을 밖으로 밀어낸다', () => {
    const t = build(42)
    let found = -1
    for (let i = 0; i < t.hp.length; i++) if (t.hp[i]! > 0) { found = i; break }
    const cx = found % t.cols
    const cy = (found / t.cols) | 0
    const wx = t.originX + cx * CELL + CELL * 0.5
    const wy = t.originY + cy * CELL + CELL * 0.5
    const out = new Float32Array(2)
    expect(t.resolveCircle(wx, wy, 13, out)).toBe(true)
    // 정확히 셀 한가운데라 어느 방향으로든 밀려나야 한다
    expect(Math.hypot(out[0]! - wx, out[1]! - wy)).toBeGreaterThan(0)
  })
})

/** (x,y) 반경 r 안에 단단한 셀이 있는가 */
function t_solidNear(t: Terrain, x: number, y: number, r: number): boolean {
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2
    for (let d = 0; d <= r; d += CELL * 0.5) {
      if (t.solidAt(x + Math.cos(ang) * d, y + Math.sin(ang) * d)) return true
    }
  }
  return false
}
