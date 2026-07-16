/**
 * 절차적 지형.
 *
 * 핵심 설계: **적은 길을 찾지 않고 지형을 갉아먹는다.**
 * 2만 마리에 경로탐색을 돌릴 방법은 없고, 파괴로 풀면 오히려 전술이 생긴다 —
 * 엄폐물 뒤에 숨으면 적이 뚫는 동안 시간을 벌 수 있고, 그 벽은 영원하지 않다.
 *
 * 격자는 hp 배열 하나다. hp 0 = 뚫린 곳.
 */
import { Rng } from '../engine/rng'

export const CELL = 46

export class Terrain {
  readonly cols: number
  readonly rows: number
  readonly originX: number
  readonly originY: number
  /** 셀 내구도. 0 이면 뚫려 있다. */
  readonly hp: Float32Array
  readonly maxHp: Float32Array
  /** 부서지는 중 연출용 — 최근 피격 시각 */
  readonly flash: Float32Array
  /** 렌더 색을 흔드는 셀별 고정 난수 */
  readonly tint: Float32Array

  constructor(worldR: number) {
    const size = Math.ceil((worldR * 2) / CELL) + 2
    this.cols = size
    this.rows = size
    this.originX = -worldR - CELL
    this.originY = -worldR - CELL
    const n = size * size
    this.hp = new Float32Array(n)
    this.maxHp = new Float32Array(n)
    this.flash = new Float32Array(n)
    this.tint = new Float32Array(n)
  }

  private idx(cx: number, cy: number): number {
    return cy * this.cols + cx
  }

  cellX(x: number): number {
    return Math.floor((x - this.originX) / CELL)
  }

  cellY(y: number): number {
    return Math.floor((y - this.originY) / CELL)
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows
  }

  /** 월드 좌표가 막혀 있는가 */
  solidAt(x: number, y: number): boolean {
    const cx = this.cellX(x)
    const cy = this.cellY(y)
    if (!this.inBounds(cx, cy)) return false
    return this.hp[this.idx(cx, cy)]! > 0
  }

  hpAt(cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return 0
    return this.hp[this.idx(cx, cy)]!
  }

  /** 셀을 때린다. 부쉈으면 true. */
  damageCell(cx: number, cy: number, amount: number, time: number): boolean {
    if (!this.inBounds(cx, cy)) return false
    const i = this.idx(cx, cy)
    if (this.hp[i]! <= 0) return false
    this.hp[i]! -= amount
    this.flash[i] = time
    if (this.hp[i]! <= 0) {
      this.hp[i] = 0
      return true
    }
    return false
  }

  /** 월드 좌표로 때린다. */
  damageAt(x: number, y: number, amount: number, time: number): boolean {
    return this.damageCell(this.cellX(x), this.cellY(y), amount, time)
  }

  /**
   * 시드로 지형을 짓는다.
   * 값 노이즈로 덩어리를 만들고 → 셀룰러 오토마타로 다듬고 → 시작점 주변을 비우고
   * → 연결되지 않은 구역을 뚫어 준다. 갇히는 시드가 하나라도 있으면 그 판은 사기다.
   */
  generate(seed: number, worldR: number, hardness: number): void {
    const rng = new Rng(seed ^ 0x7e44a1)
    const { cols, rows } = this
    const solid = new Uint8Array(cols * rows)

    // 1) 값 노이즈 — 격자 코너에 난수를 깔고 보간
    const NOISE = 12 // 노이즈 격자 간격(셀 단위). 클수록 덩어리가 커진다.
    const gw = Math.ceil(cols / NOISE) + 2
    const gh = Math.ceil(rows / NOISE) + 2
    const grid = new Float32Array(gw * gh)
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next()

    const smooth = (t: number): number => t * t * (3 - 2 * t)
    /**
     * 격자 코너 읽기. **반드시 랩해서 읽는다.**
     * 2번째 옥타브가 좌표를 2.7배로 늘리는데 격자는 원본 크기라, 범위를 넘긴
     * 인덱스는 Float32Array 에서 조용히 undefined 가 되고 → NaN → `NaN > 0.56`
     * 이 항상 false → 맵 대부분이 통째로 사라졌다. 눈에 안 띄는 종류의 버그다.
     */
    const at = (gx: number, gy: number): number => {
      const x = ((gx % gw) + gw) % gw
      const y = ((gy % gh) + gh) % gh
      return grid[y * gw + x]!
    }
    const sample = (fx: number, fy: number): number => {
      const gx = Math.floor(fx / NOISE)
      const gy = Math.floor(fy / NOISE)
      const tx = smooth((fx - gx * NOISE) / NOISE)
      const ty = smooth((fy - gy * NOISE) / NOISE)
      const a = at(gx, gy)
      const b = at(gx + 1, gy)
      const c = at(gx, gy + 1)
      const d = at(gx + 1, gy + 1)
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    }

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        // 두 옥타브면 충분하다. 더 넣어 봐야 46px 셀에선 안 보인다.
        const v = sample(cx, cy) * 0.65 + sample(cx * 2.7 + 31, cy * 2.7 + 17) * 0.35
        // 임계값이 곧 맵 밀도다. 0.54 면 32% 라 화면이 벽으로 꽉 차 이동이 답답했다.
        solid[cy * cols + cx] = v > 0.615 ? 1 : 0
      }
    }

    // 2) 셀룰러 오토마타 — 외톨이 셀을 지우고 덩어리를 매끈하게
    const next = new Uint8Array(cols * rows)
    for (let pass = 0; pass < 3; pass++) {
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          let n = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = cx + dx
              const ny = cy + dy
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
              n += solid[ny * cols + nx]!
            }
          }
          const me = solid[cy * cols + cx]!
          next[cy * cols + cx] = n > 4 ? 1 : n < 3 ? 0 : me
        }
      }
      solid.set(next)
    }

    // 3) 월드 경계 밖과 시작점 주변은 비운다.
    //    넓게 비우는 게 중요하다. 좁게 비우면 시작 지점이 **요새**가 된다 —
    //    적은 벽을 갉느라 느리고 그동안 자동 무기가 다 죽여서, 가만히 서 있어도
    //    5분을 완주했다(실측). 조작이 필요 없는 게임은 게임이 아니다.
    const cx0 = this.cellX(0)
    const cy0 = this.cellY(0)
    const clearR = 13
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const wx = this.originX + cx * CELL + CELL * 0.5
        const wy = this.originY + cy * CELL + CELL * 0.5
        if (Math.hypot(wx, wy) > worldR - CELL) {
          solid[cy * cols + cx] = 0
          continue
        }
        const dx = cx - cx0
        const dy = cy - cy0
        if (dx * dx + dy * dy < clearR * clearR) solid[cy * cols + cx] = 0
      }
    }

    // 4) 연결성 — 시작점에서 못 닿는 빈 칸이 있으면 벽을 뚫어 잇는다
    this.carveConnectivity(solid, cx0, cy0, worldR)

    // 5) hp 배정. 큰 덩어리 안쪽일수록 단단하다.
    this.hp.fill(0)
    this.maxHp.fill(0)
    this.flash.fill(-999)
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx
        if (solid[i] === 0) continue
        // 이웃이 많을수록(=안쪽일수록) 두껍다
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            n += solid[ny * cols + nx]!
          }
        }
        const h = (26 + n * 9) * hardness
        this.hp[i] = h
        this.maxHp[i] = h
        this.tint[i] = rng.next()
      }
    }
  }

  /**
   * 시작점에서 flood fill 해서 닿지 않는 빈 구역을 찾고, 가장 가까운 도달 구역까지
   * 직선으로 뚫는다. 완벽한 미로 이론은 필요 없다 — 갇히지만 않으면 된다.
   */
  private carveConnectivity(solid: Uint8Array, sx: number, sy: number, worldR: number): void {
    const { cols, rows } = this
    const seen = new Uint8Array(cols * rows)
    const stack: number[] = [sy * cols + sx]
    seen[sy * cols + sx] = 1

    while (stack.length > 0) {
      const cur = stack.pop()!
      const cx = cur % cols
      const cy = (cur / cols) | 0
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0)
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0)
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const ni = ny * cols + nx
        if (seen[ni] === 1 || solid[ni] === 1) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    // 도달 못한 빈 칸을 모아 대표 하나씩 시작점 방향으로 뚫는다
    for (let cy = 1; cy < rows - 1; cy += 3) {
      for (let cx = 1; cx < cols - 1; cx += 3) {
        const i = cy * cols + cx
        if (solid[i] === 1 || seen[i] === 1) continue
        const wx = this.originX + cx * CELL
        const wy = this.originY + cy * CELL
        if (Math.hypot(wx, wy) > worldR - CELL * 2) continue
        // 시작점까지 직선으로 벽을 지운다
        let x = cx
        let y = cy
        let guard = 0
        while ((x !== sx || y !== sy) && guard++ < cols * 2) {
          solid[y * cols + x] = 0
          seen[y * cols + x] = 1
          if (Math.abs(sx - x) > Math.abs(sy - y)) x += Math.sign(sx - x)
          else y += Math.sign(sy - y)
        }
      }
    }
  }

  /** 격자 전체에서 막힌 셀 비율 — 테스트/디버그용 */
  solidRatio(): number {
    let n = 0
    for (let i = 0; i < this.hp.length; i++) if (this.hp[i]! > 0) n++
    return n / this.hp.length
  }

  /**
   * 원이 지형과 겹치면 밀어낸다. 반환: 밀어냈으면 true.
   * out 에 [x, y] 를 쓴다 (할당 없이).
   */
  resolveCircle(x: number, y: number, r: number, out: Float32Array): boolean {
    const cx0 = this.cellX(x - r)
    const cx1 = this.cellX(x + r)
    const cy0 = this.cellY(y - r)
    const cy1 = this.cellY(y + r)
    let px = x
    let py = y
    let hit = false

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.inBounds(cx, cy)) continue
        if (this.hp[this.idx(cx, cy)]! <= 0) continue
        // 셀(AABB)에서 원 중심에 가장 가까운 점
        const bx = this.originX + cx * CELL
        const by = this.originY + cy * CELL
        const nx = Math.max(bx, Math.min(px, bx + CELL))
        const ny = Math.max(by, Math.min(py, by + CELL))
        const dx = px - nx
        const dy = py - ny
        const d2 = dx * dx + dy * dy
        if (d2 >= r * r) continue
        hit = true
        const d = Math.sqrt(d2)
        if (d < 1e-4) {
          // 셀 한가운데 파묻혔다 — 가장 가까운 면으로 뺀다
          const toL = px - bx
          const toR = bx + CELL - px
          const toB = py - by
          const toT = by + CELL - py
          const m = Math.min(toL, toR, toB, toT)
          if (m === toL) px = bx - r
          else if (m === toR) px = bx + CELL + r
          else if (m === toB) py = by - r
          else py = by + CELL + r
        } else {
          const push = (r - d) / d
          px += dx * push
          py += dy * push
        }
      }
    }
    out[0] = px
    out[1] = py
    return hit
  }
}
