/**
 * 군체. 이 게임에서 가장 무거운 루프이자 가장 중요한 그림.
 *
 * 성능 예산: 적 1만 마리가 프레임당 1.5ms 안에 끝나야 나머지(탄·파티클·렌더)가 산다.
 * 그래서 여기엔 클로저도, 객체 생성도, 배열 할당도 없다.
 */
import type { SpatialHash } from '../engine/grid'
import { Shape } from '../engine/shapes'
import { Foe, type FoeType, type Foes } from './pools'
import type { Terrain } from './terrain'

export const Behavior = {
  Chase: 0, // 플레이어를 향해 꾸준히
  Dash: 1, // 멈췄다가 튀어나간다
  Orbit: 2, // 일정 거리를 유지하며 돈다
} as const

export interface FoeStat {
  readonly speed: number
  readonly radius: number
  readonly hp: number
  /** 접촉 피해 */
  readonly damage: number
  readonly xp: number
  readonly r: number
  readonly g: number
  readonly b: number
  readonly shape: number
  /** 서로 밀어내는 반경. 크면 넓게 퍼지고 작으면 뭉친다. */
  readonly sep: number
  readonly behavior: number
  /** 넉백 저항 (1 = 그대로 밀림, 0 = 요지부동) */
  readonly weight: number
  /** 지형을 갉아먹는 초당 피해. 큰 놈일수록 벽을 빨리 뚫는다. */
  readonly gnaw: number
}

/**
 * 색은 HDR 이라 1을 넘긴다. 넘긴 만큼 bloom 이 문다.
 * 종류를 색으로 구분해야 화면에 2만 마리가 있어도 무엇이 위험한지 읽힌다.
 */
/**
 * 속도 설계 — 이 게임의 밸런스 전부가 여기 걸려 있다.
 *
 * 플레이어는 238이다. 처음엔 잔챙이를 90으로 뒀는데, 봇 6판이 전부 5분을 완주했고
 * 그중 셋은 0~4킬이었다. 2.6배 빠르면 도망이 무적 전략이 되고, 월드가 5200 이라
 * 도망칠 공간도 무한하다. 그건 게임이 아니라 산책이다.
 *
 * 지금은 잔챙이가 플레이어의 62%다. 도망은 여전히 통하지만 영원히는 아니고,
 * 뒤에 꼬리가 쌓인다. 돌진체(Husk)는 순간 2.35배로 튀므로 실질 최고 속도가
 * 플레이어를 넘는다 — 도망만 치면 뒤통수를 맞으라는 뜻이다.
 */
export const FOE_STATS: readonly FoeStat[] = [
  // Mote — 청록. 잔챙이. 화면을 채우는 물량.
  { speed: 148, radius: 11, hp: 4, damage: 6, xp: 1, r: 0.3, g: 1.7, b: 2.1, shape: Shape.Mote, sep: 19, behavior: Behavior.Chase, weight: 1, gnaw: 7 },
  // Husk — 주황. 돌진. 방심하면 뒤통수를 친다. (버스트 시 실속도 190*2.35)
  { speed: 190, radius: 12, hp: 9, damage: 12, xp: 3, r: 2.4, g: 0.85, b: 0.2, shape: Shape.Husk, sep: 21, behavior: Behavior.Dash, weight: 0.85, gnaw: 14 },
  // Hex — 보라. 탱커. 느리지만 벽처럼 밀고 들어온다.
  { speed: 88, radius: 19, hp: 46, damage: 18, xp: 8, r: 1.5, g: 0.5, b: 2.3, shape: Shape.Hex, sep: 34, behavior: Behavior.Chase, weight: 0.35, gnaw: 40 },
  // Wisp — 연두. 주위를 돌며 거리를 잰다. 몰리면 도망칠 길이 막힌다.
  { speed: 152, radius: 10, hp: 14, damage: 9, xp: 4, r: 0.7, g: 2.2, b: 0.6, shape: Shape.Orb, sep: 24, behavior: Behavior.Orbit, weight: 0.7, gnaw: 9 },
  // Eye — 적색. 엘리트. 드물고 아프고 많이 준다.
  { speed: 132, radius: 27, hp: 190, damage: 26, xp: 40, r: 2.6, g: 0.3, b: 0.45, shape: Shape.Eye, sep: 48, behavior: Behavior.Chase, weight: 0.15, gnaw: 95 },
]

/** 이웃을 몇 마리까지 보고 끊을지. 밀집 구간에서 이게 없으면 O(n²)로 돌아간다. */
const MAX_NEIGHBORS = 24
const neighborBuf = new Int32Array(MAX_NEIGHBORS)

export interface FoeUpdateCtx {
  readonly foes: Foes
  readonly hash: SpatialHash
  readonly playerX: number
  readonly playerY: number
  readonly dt: number
  readonly time: number
  /** 월드 경계 (밖으로 새는 걸 막는다) */
  readonly worldR: number
  /**
   * 이번 틱에 화상으로 죽은 적 인덱스가 여기 담긴다.
   * 여기서 직접 죽이지 않는 이유: 보상·연출은 게임 루프의 몫이고,
   * 순회 중 풀을 건드리면 free 스택과 인덱스가 꼬인다.
   */
  readonly deadOut: Int32Array
  /** 지형. 적은 길을 찾지 않고 갉아먹는다. */
  readonly terrain: Terrain | null
}

export interface FoeUpdateResult {
  /** 플레이어에게 닿은 적들의 접촉 피해 총합 (호출자가 무적 프레임을 따져 적용한다) */
  contactDamage: number
  /** deadOut 에 담긴 유효 개수 */
  deadCount: number
}

/** 프레임당 1회만 만들어지므로 객체 반환이 GC 를 건드리지 않는다. */
const result: FoeUpdateResult = { contactDamage: 0, deadCount: 0 }

/** resolveCircle 결과를 받는 스크래치. 프레임당 수만 번 불리므로 재사용한다. */
const scratch = new Float32Array(2)

/** 군체 한 틱. */
export function updateFoes(ctx: FoeUpdateCtx, playerRadius: number): FoeUpdateResult {
  const { foes, hash, playerX, playerY, dt, time, worldR, deadOut, terrain } = ctx
  let deadCount = 0
  const high = foes.high
  const alive = foes.alive
  const xs = foes.x
  const ys = foes.y
  const vxs = foes.vx
  const vys = foes.vy
  const types = foes.type

  hash.build(xs, ys, alive, high)

  let contactDamage = 0
  const worldR2 = worldR * worldR

  for (let i = 0; i < high; i++) {
    if (alive[i] === 0) continue

    const stat = FOE_STATS[types[i]!]!
    const x = xs[i]!
    const y = ys[i]!

    // ── 화상: 지속 피해. 죽으면 목록에 담고 이번 틱 나머지는 건너뛴다.
    if (foes.burn[i]! > 0) {
      foes.burn[i]! -= dt
      foes.hp[i]! -= foes.burnDps[i]! * dt
      if (foes.hp[i]! <= 0) {
        foes.hp[i] = 0
        if (deadCount < deadOut.length) deadOut[deadCount++] = i
        continue
      }
    }

    // ── 플레이어를 향한 방향
    let dx = playerX - x
    let dy = playerY - y
    const distSq = dx * dx + dy * dy
    const dist = Math.sqrt(distSq) || 1
    dx /= dist
    dy /= dist

    // 개체마다 목표를 조금씩 빗겨 겨냥한다. 전부 정확히 플레이어를 향하면
    // 분리 힘과 균형을 이뤄 결정(結晶)처럼 규칙적인 격자로 굳는다 — 살아있는 군체로 안 보인다.
    // 수직 성분을 섞는 방식이라 sin/cos 없이 공짜다.
    const skew = (foes.seed[i]! - 0.5) * 0.5
    const adx = dx - dy * skew
    const ady = dy + dx * skew

    let desiredX = 0
    let desiredY = 0
    const speed = stat.speed

    switch (stat.behavior) {
      case Behavior.Dash: {
        // 개체마다 다른 위상으로 멈췄다 튄다. seed 가 없으면 전부 동시에 튀어 우스워진다.
        const phase = (time * 1.5 + foes.seed[i]! * 6.283) % 1
        const burst = phase > 0.55 ? 2.35 : 0.22
        desiredX = adx * speed * burst
        desiredY = ady * speed * burst
        break
      }
      case Behavior.Orbit: {
        // 접선 성분 + 목표 거리 유지. 너무 멀면 붙고 너무 가까우면 뗀다.
        const ring = 190
        const radial = (dist - ring) / ring
        const tx = -dy
        const ty = dx
        const spin = foes.seed[i]! > 0.5 ? 1 : -1
        desiredX = (tx * spin * 0.85 + dx * radial * 1.4) * speed
        desiredY = (ty * spin * 0.85 + dy * radial * 1.4) * speed
        break
      }
      default: {
        desiredX = adx * speed
        desiredY = ady * speed
      }
    }

    // ── 분리: 이웃과 겹치지 않게 밀어낸다. 이게 없으면 전부 한 점에 겹쳐 한 마리처럼 보인다.
    // 반경도 개체마다 흔든다 — 모두가 같은 간격을 원하면 그게 곧 격자다.
    const sep = stat.sep * (0.78 + foes.seed[i]! * 0.44)
    const n = hash.query(x, y, sep, neighborBuf)
    let sepX = 0
    let sepY = 0
    let sepCount = 0
    const sep2 = sep * sep
    for (let k = 0; k < n; k++) {
      const j = neighborBuf[k]!
      if (j === i) continue
      const ox = x - xs[j]!
      const oy = y - ys[j]!
      const d2 = ox * ox + oy * oy
      if (d2 > sep2 || d2 < 1e-6) continue
      // 선형 falloff. 1/d² 로 하면 힘이 너무 급격해 서로를 밀어낸 자리에 그대로 굳는다.
      const d = Math.sqrt(d2)
      const w = (sep - d) / sep
      sepX += (ox / d) * w
      sepY += (oy / d) * w
      sepCount++
    }
    if (sepCount > 0) {
      const sepScale = speed * 1.75
      desiredX += sepX * sepScale
      desiredY += sepY * sepScale
    }

    // ── 속도: 목표로 부드럽게 (즉시 반영하면 분리가 튀어 떨림이 생긴다)
    const blend = 1 - Math.exp(-9 * dt)
    let vx = vxs[i]! + (desiredX - vxs[i]!) * blend
    let vy = vys[i]! + (desiredY - vys[i]!) * blend

    // ── 넉백: 자체 이동과 별도로 더해지고 빠르게 감쇠한다
    const px = foes.pushX[i]!
    const py = foes.pushY[i]!
    if (px !== 0 || py !== 0) {
      vx += px
      vy += py
      const decay = Math.exp(-11 * dt)
      foes.pushX[i] = px * decay
      foes.pushY[i] = py * decay
      if (Math.abs(foes.pushX[i]!) < 0.5) foes.pushX[i] = 0
      if (Math.abs(foes.pushY[i]!) < 0.5) foes.pushY[i] = 0
    }

    vxs[i] = vx
    vys[i] = vy

    let nx = x + vx * dt
    let ny = y + vy * dt

    // ── 월드 경계: 원형. 밖으로 나가면 안으로 되민다.
    const rr = nx * nx + ny * ny
    if (rr > worldR2) {
      const inv = worldR / Math.sqrt(rr)
      nx *= inv
      ny *= inv
    }

    // ── 지형: 길을 찾지 않고 갉아먹는다.
    // 2만 마리에 경로탐색은 불가능하고, 파괴로 풀면 오히려 전술이 생긴다.
    if (terrain !== null && terrain.solidAt(nx, ny)) {
      // 진행 방향 앞쪽 셀을 문다
      terrain.damageAt(nx + dx * stat.radius, ny + dy * stat.radius, stat.gnaw * dt, time)
      if (terrain.resolveCircle(nx, ny, stat.radius, scratch)) {
        nx = scratch[0]!
        ny = scratch[1]!
        // 벽에 부딪힌 속도는 죽인다 — 안 그러면 벽을 타고 미끄러지며 떤다
        vxs[i] = vx * 0.25
        vys[i] = vy * 0.25
      }
    }

    xs[i] = nx
    ys[i] = ny

    // ── 플레이어 접촉
    const touch = stat.radius + playerRadius
    if (distSq < touch * touch) {
      contactDamage += stat.damage * dt
    }

    // ── 상태 타이머
    if (foes.flash[i]! > 0) foes.flash[i]! -= dt
  }

  result.contactDamage = contactDamage
  result.deadCount = deadCount
  return result
}

/**
 * 무리 스폰. 잔챙이를 낱개로 흩뿌리면 군체가 아니라 점묘화가 된다 —
 * 한 덩어리로 몰려와야 "밀려온다"가 된다.
 */
export function spawnCluster(
  foes: Foes,
  type: FoeType,
  cx: number,
  cy: number,
  ringMin: number,
  ringMax: number,
  hpScale: number,
  count: number,
  spread: number,
  rand: () => number,
  worldR: number,
): number {
  const a = rand() * Math.PI * 2
  const d = ringMin + rand() * (ringMax - ringMin)
  let bx = cx + Math.cos(a) * d
  let by = cy + Math.sin(a) * d
  if (Math.hypot(bx, by) > worldR * 0.97) {
    bx = cx - Math.cos(a) * d
    by = cy - Math.sin(a) * d
  }
  const stat = FOE_STATS[type]!
  let spawned = 0
  for (let k = 0; k < count; k++) {
    // 원 안 균일 분포 (sqrt 없이 그냥 뿌리면 가운데에 뭉친다)
    const ang = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * spread
    const i = foes.spawn(bx + Math.cos(ang) * r, by + Math.sin(ang) * r, type, stat.hp * hpScale, rand())
    if (i < 0) break
    spawned++
  }
  return spawned
}

/** 링 밖 랜덤 위치 한 마리. */
export function spawnRing(
  foes: Foes,
  type: FoeType,
  cx: number,
  cy: number,
  ringMin: number,
  ringMax: number,
  hpScale: number,
  rand: () => number,
  worldR: number,
): number {
  const a = rand() * Math.PI * 2
  const d = ringMin + rand() * (ringMax - ringMin)
  let x = cx + Math.cos(a) * d
  let y = cy + Math.sin(a) * d
  // 월드 밖이면 반대편으로 접는다 (안 그러면 경계 근처에서 스폰이 한쪽으로 쏠린다)
  const rr = Math.hypot(x, y)
  if (rr > worldR * 0.97) {
    x = cx - Math.cos(a) * d
    y = cy - Math.sin(a) * d
  }
  const stat = FOE_STATS[type]!
  return foes.spawn(x, y, type, stat.hp * hpScale, rand())
}

/** 표시용 회전각. Husk 만 진행 방향을 본다 (삼각형이라 방향이 읽힌다). */
export function foeRotation(foes: Foes, i: number, time: number): number {
  const t = foes.type[i]!
  if (t === Foe.Husk) return Math.atan2(foes.vy[i]!, foes.vx[i]!)
  if (t === Foe.Hex) return time * 0.6 + foes.seed[i]! * 6.283
  if (t === Foe.Eye) return Math.atan2(foes.vy[i]!, foes.vx[i]!) + Math.PI * 0.5
  return foes.seed[i]! * 6.283
}
