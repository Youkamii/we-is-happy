/**
 * 연출 파티클 헬퍼.
 *
 * 전부 순수 연출이다 — 시뮬레이션에 영향을 주면 협동 동기화가 깨진다.
 * 그래서 여기서만 Math.random 을 써도 안전하다.
 */
import { Shape } from '../engine/shapes'
import type { Motes } from './pools'

/**
 * 스텝당 연출 예산.
 *
 * 후반엔 초당 수백 킬이 나고, 킬·폭발·연쇄가 전부 폭죽을 쏘면 가법 블렌딩이
 * 겹침 수만으로 화면을 태워 **적과 나 자신이 안 보인다 — 게임이 불가능해진다**
 * (실플레이 보고). 개별 밝기를 palette 위계로 지켜도 수량은 별개의 축이라,
 * 여기서 수량 자체에 상한을 건다. 예산이 다하면 이번 스텝의 나머지 연출은
 * 조용히 생략된다 — 시뮬레이션은 모른다(파티클은 판정에 안 쓰인다).
 *
 * 값의 근거: 평시 스텝은 킬 3~8 × 조각 3~9 ≈ 최대 70쯤을 쓴다. 120이면 평시는
 * 전혀 안 깎이고, 반향 연쇄·특이점 붕괴 같은 폭발 폭풍만 잘린다.
 */
const STEP_BUDGET = 120
let budget = STEP_BUDGET

function take(n: number): boolean {
  if (budget < n) return false
  budget -= n
  return true
}

/** 사방으로 터지는 기본 폭발. 적이 죽을 때마다 불린다 — 싸야 한다. */
export function burst(
  motes: Motes,
  x: number, y: number,
  count: number,
  r: number, g: number, b: number,
  speed: number,
  life: number,
  size: number,
  shape: number = Shape.Spark,
): void {
  if (!take(count)) return
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2
    const s = speed * (0.35 + Math.random() * 0.9)
    motes.spawn(
      x, y,
      Math.cos(a) * s, Math.sin(a) * s,
      life * (0.6 + Math.random() * 0.7),
      size * (0.7 + Math.random() * 0.7),
      r, g, b,
      shape,
      (Math.random() - 0.5) * 14,
      a,
      2.6,
    )
  }
}

/** 한 방향으로 부채꼴. 명중 지점에서 튀는 불똥. */
export function spray(
  motes: Motes,
  x: number, y: number,
  dirX: number, dirY: number,
  spread: number,
  count: number,
  r: number, g: number, b: number,
  speed: number,
  life: number,
  size: number,
): void {
  if (!take(count)) return
  const base = Math.atan2(dirY, dirX)
  for (let k = 0; k < count; k++) {
    const a = base + (Math.random() - 0.5) * spread
    const s = speed * (0.4 + Math.random() * 0.9)
    motes.spawn(
      x, y,
      Math.cos(a) * s, Math.sin(a) * s,
      life * (0.5 + Math.random() * 0.8),
      size * (0.6 + Math.random() * 0.8),
      r, g, b,
      Shape.Spark,
      (Math.random() - 0.5) * 10,
      a,
      3.4,
    )
  }
}

/** 팽창하는 충격파 링 하나. 폭발·레벨업·진화에 쓴다. */
export function shockwave(
  motes: Motes,
  x: number, y: number,
  size: number,
  r: number, g: number, b: number,
  life = 0.42,
): void {
  // 링은 크고 밝아서 조각보다 비싸게 친다 — 폭발 폭풍에서 제일 먼저 잘려야 할 것
  if (!take(5)) return
  motes.spawn(x, y, 0, 0, life, size, r, g, b, Shape.Ring, 0, 0, 1)
}

/** 위로 떠오르며 사라지는 연기. 지형이 부서질 때. */
export function smoke(
  motes: Motes,
  x: number, y: number,
  count: number,
  r: number, g: number, b: number,
  size: number,
): void {
  if (!take(count)) return
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2
    const s = 18 + Math.random() * 40
    motes.spawn(
      x + Math.cos(a) * 6, y + Math.sin(a) * 6,
      Math.cos(a) * s, Math.sin(a) * s + 22,
      0.7 + Math.random() * 0.8,
      size * (0.8 + Math.random() * 1.1),
      r, g, b,
      Shape.Smoke,
      (Math.random() - 0.5) * 2,
      Math.random() * 6.283,
      1.4,
    )
  }
}

/** 파티클 한 틱. 여기도 hot path 라 분기를 줄인다. 스텝마다 연출 예산도 되찬다. */
export function updateMotes(motes: Motes, dt: number): void {
  budget = STEP_BUDGET
  const high = motes.high
  for (let i = 0; i < high; i++) {
    if (motes.alive[i] === 0) continue
    const life = motes.life[i]! - dt
    if (life <= 0) {
      motes.kill(i)
      continue
    }
    motes.life[i] = life
    const drag = Math.exp(-motes.drag[i]! * dt)
    motes.vx[i]! *= drag
    motes.vy[i]! *= drag
    motes.x[i]! += motes.vx[i]! * dt
    motes.y[i]! += motes.vy[i]! * dt
    motes.rot[i]! += motes.spin[i]! * dt
  }
}
