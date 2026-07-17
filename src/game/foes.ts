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
/**
 * 색은 **1.0 을 넘지 않는다** (palette.ts 의 FOE_BASE 규칙).
 *
 * 예전엔 2.4~2.9 를 썼다. bloom 임계값이 1.05 이니 적 하나하나가 전부 번졌고,
 * 후반에 2,000마리가 몰리면 화면이 통째로 하얘져서 정작 피해야 할 것이 안 보였다
 * (사용자: "이펙트 너무 세서 화면이 안 보임"). 적은 화면의 대부분을 차지하므로
 * **여기가 기준선**이고, 여기서 1.0 을 넘으면 그 순간 게임이 안 보인다.
 *
 * 대신 색상(hue)을 확실히 갈라서 밝기 없이도 종족이 읽히게 한다.
 */
export const FOE_STATS: readonly FoeStat[] = [
  // Mote — 청록. 잔챙이. 화면을 채우는 물량이라 가장 어둡다.
  { speed: 148, radius: 11, hp: 4, damage: 6, xp: 1, r: 0.10, g: 0.52, b: 0.66, shape: Shape.Mote, sep: 19, behavior: Behavior.Chase, weight: 1, gnaw: 7 },
  // Husk — 주황. 돌진. 방심하면 뒤통수를 친다. (버스트 시 실속도 190*2.35)
  { speed: 190, radius: 12, hp: 9, damage: 12, xp: 3, r: 0.86, g: 0.34, b: 0.06, shape: Shape.Husk, sep: 21, behavior: Behavior.Dash, weight: 0.85, gnaw: 14 },
  // Hex — 보라. 탱커. 느리지만 벽처럼 밀고 들어온다.
  // 모양이 Shape.Hex 였는데 **지형이 육각 타일이라 적과 벽이 구분이 안 됐다**
  // (같은 모양 + 비슷한 보라). 지형은 격자라 육각이 자연스러우니 적을 결정으로 옮겼다.
  { speed: 88, radius: 19, hp: 46, damage: 18, xp: 8, r: 0.72, g: 0.16, b: 0.98, shape: Shape.Prism, sep: 34, behavior: Behavior.Chase, weight: 0.35, gnaw: 40 },
  // Wisp — 연두. 주위를 돌며 거리를 잰다. 몰리면 도망칠 길이 막힌다.
  { speed: 152, radius: 10, hp: 14, damage: 9, xp: 4, r: 0.26, g: 0.82, b: 0.20, shape: Shape.Orb, sep: 24, behavior: Behavior.Orbit, weight: 0.7, gnaw: 9 },
  // Eye — 적색. 엘리트. 드물고 아프고 많이 준다. 드무니까 조금 밝아도 된다.
  { speed: 132, radius: 27, hp: 190, damage: 26, xp: 40, r: 1.0, g: 0.12, b: 0.18, shape: Shape.Eye, sep: 48, behavior: Behavior.Chase, weight: 0.15, gnaw: 95 },
]

/** 이웃을 몇 마리까지 보고 끊을지. 밀집 구간에서 이게 없으면 O(n²)로 돌아간다. */
const MAX_NEIGHBORS = 24
const neighborBuf = new Int32Array(MAX_NEIGHBORS)

/**
 * 엘리트 어픽스 — 군중 속에 "저놈부터"라는 단기 목표를 만든다.
 * 전부 국소 규칙이라 hot path 에 u8 비교 하나씩만 얹힌다. 색 링으로 표시된다.
 */
export const Affix = {
  None: 0,
  /** 분열 — 죽을 때 Mote 를 낳는다 (초록) */
  Brood: 1,
  /** 광란 — 체력 절반 아래에서 1.75배로 빨라진다 (붉음) */
  Frenzy: 2,
  /** 수정 — 받는 피해 -40%, 대신 보상이 크다 (청록) */
  Prism: 3,
  /** 장벽 — 넉백에 밀리지 않는다 (금색) */
  Bulwark: 4,
} as const

/** 어픽스 표시 링 색 (인덱스 = Affix 값). 종류가 색으로 즉시 읽혀야 목표가 된다. */
export const AFFIX_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0.35, 1.35, 0.4], // 분열 — 초록
  [1.5, 0.32, 0.28], // 광란 — 붉음
  [0.3, 1.25, 1.4], // 수정 — 청록
  [1.45, 1.1, 0.3], // 장벽 — 금색
]

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
  /** 보스 슬롯 (-1 = 없음). 판정 반경이 렌더와 같아야 하므로 여기서도 알아야 한다. */
  readonly bossIdx: number
  /** 전 적 이동 배율 — 계약(Ash Wind 류)이 올린다. 1 = 평소. */
  readonly speedMul: number
}

export interface FoeUpdateResult {
  /**
   * 지금 몸에 닿아 있는 적 중 **가장 아픈 놈의 피해**. dt 로 나누지 않는다.
   *
   * 예전엔 `contactDamage += stat.damage * dt` 로 **한 스텝치(1/60초)** 를 누적한 뒤
   * 0.55초 무적을 걸었다. 실효 DPS 가 Mote 0.40, Eye 1.73 —
   * **이 게임은 플레이어를 죽일 수 없었다.** 봇이 5/6 완주한 건 봇이 잘해서가 아니라
   * 게임이 피해를 안 줘서였고, 밸런스 측정 4회가 전부 무의미했다(적대 리뷰가 잡았다).
   *
   * 무적 프레임이 있는 게임에서 접촉 피해는 **한 방의 크기**여야 한다 — 시간당이 아니라.
   */
  contactDamage: number
  /** 몸에 닿아 있는 적 수. 포위당하면 더 아프게 만드는 데 쓴다. */
  contactCount: number
  /** deadOut 에 담긴 유효 개수 */
  deadCount: number
}

/** 프레임당 1회만 만들어지므로 객체 반환이 GC 를 건드리지 않는다. */
const result: FoeUpdateResult = { contactDamage: 0, contactCount: 0, deadCount: 0 }

/** resolveCircle 결과를 받는 스크래치. 프레임당 수만 번 불리므로 재사용한다. */
const scratch = new Float32Array(2)

/** 군체 한 틱. */
export function updateFoes(ctx: FoeUpdateCtx, playerRadius: number): FoeUpdateResult {
  const { foes, hash, playerX, playerY, dt, time, worldR, deadOut, terrain, bossIdx, speedMul } = ctx
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
  let contactCount = 0
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
    const speed = stat.speed * foes.slow[i]!

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

    // ── 어픽스·계약의 이동 배율 (추격 속도에만 — 넉백은 그대로 받는다)
    if (foes.affix[i] === Affix.Frenzy && foes.hp[i]! < foes.maxHp[i]! * 0.5) {
      vx *= 1.75
      vy *= 1.75
    }
    if (speedMul !== 1) {
      vx *= speedMul
      vy *= speedMul
    }

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

    // 몸 반경. 보스는 렌더가 3.4배라 **모든 판정**(지형·접촉)이 같은 반경을 써야 한다 —
    // 접촉·무기 판정만 고치고 지형을 빼먹어서 보스 몸통이 벽에 ~65px 파묻혀 보였다.
    const bodyR = i === bossIdx ? stat.radius * BOSS_SCALE : stat.radius

    // ── 지형: 길을 찾지 않고 갉아먹는다.
    // 2만 마리에 경로탐색은 불가능하고, 파괴로 풀면 오히려 전술이 생긴다.
    const inWall = terrain !== null && terrain.solidAt(nx, ny)
    if (terrain !== null && inWall) {
      // 진행 방향 앞쪽 셀을 문다.
      // **적이 잔해를 터뜨려선 안 된다** — 그러면 내가 파러 가기도 전에 공짜로 열리고,
      // 위험/보상 선택이 그냥 시간 문제가 된다. 적은 잔해 셀을 못 부순다(hp 를 남긴다).
      const gx = nx + dx * bodyR
      const gy = ny + dy * bodyR
      const gcx = terrain.cellX(gx)
      const gcy = terrain.cellY(gy)
      if (terrain.inBounds(gcx, gcy) && terrain.cache[gcy * terrain.cols + gcx] === 1) {
        // 잔해 셀은 1 아래로 안 내려간다 — 파는 건 플레이어의 몫이다
        const cur = terrain.hpAt(gcx, gcy)
        if (cur > 1) terrain.damageCell(gcx, gcy, Math.min(stat.gnaw * dt, cur - 1), time)
      } else {
        terrain.damageAt(gx, gy, stat.gnaw * dt, time)
      }
    }
    // 벽 밀어내기. 잔챙이는 중심이 벽 안일 때만 확인한다(2만 마리 hot path 라 solidAt 이
    // 게이트). 보스는 항상 — 반경이 3.4배라 **중심이 빈 칸이어도 몸이 벽에 걸친다.**
    if (terrain !== null && (inWall || i === bossIdx)
      && terrain.resolveCircle(nx, ny, bodyR, scratch)) {
      nx = scratch[0]!
      ny = scratch[1]!
      // 벽에 부딪힌 속도는 죽인다 — 안 그러면 벽을 타고 미끄러지며 떤다
      vxs[i] = vx * 0.25
      vys[i] = vy * 0.25
    }

    xs[i] = nx
    ys[i] = ny

    // ── 플레이어 접촉 (bodyR — 보스는 3.4배)
    const touch = bodyR + playerRadius
    if (distSq < touch * touch) {
      // 합산이 아니라 **최댓값**이다. 합치면 잔챙이 20마리가 Eye 보다 아프고,
      // dt 를 곱하면 아무도 안 아프다. 포위 보정은 호출자가 개수로 얹는다.
      if (stat.damage > contactDamage) contactDamage = stat.damage
      contactCount++
    }

    // ── 상태 타이머
    if (foes.flash[i]! > 0) foes.flash[i]! -= dt
    // 정지장을 벗어나면 스스로 회복한다. 필드가 매 틱 다시 덮어쓰므로,
    // 안에 있는 동안은 이 회복이 무의미하고 나가는 순간부터 유효해진다.
    if (foes.slow[i]! < 1) foes.slow[i] = Math.min(1, foes.slow[i]! + dt * 1.1)
    if (foes.frail[i]! > 1) foes.frail[i] = Math.max(1, foes.frail[i]! - dt * 2.5)
  }

  result.contactDamage = contactDamage
  result.contactCount = contactCount
  result.deadCount = deadCount
  return result
}

/**
 * 링 스폰 위치 스크래치 — spawnRing/spawnCluster 가 공유한다 (프레임당 몇 번뿐).
 *
 * **일반 변수(float64)여야 한다.** Float32Array 로 뒀더니 좌표 하위 비트가 잘려
 * 시뮬레이션이 리팩토링 전과 비트 단위로 갈라졌다 — 접촉·킬 타이밍이 미세하게
 * 밀리면서 칼끝에 있던 결정론 테스트(seed 5, 10s 내 첫 레벨업)가 뒤집혔다.
 */
let ringX = 0
let ringY = 0

/**
 * 링 밖 랜덤 위치 하나를 ringX/ringY 에 담는다.
 * 월드 밖이면 반대편으로 접는다 — 안 그러면 경계 근처에서 스폰이 한쪽으로 쏠린다.
 * (spawnRing/spawnCluster 에 7줄이 verbatim 복붙돼 있었고, 접는 이유 주석이 한쪽에만
 * 남아 이미 열화가 시작돼 있었다 — #9)
 */
function rollRingPos(
  cx: number, cy: number, ringMin: number, ringMax: number,
  rand: () => number, worldR: number,
): void {
  const a = rand() * Math.PI * 2
  const d = ringMin + rand() * (ringMax - ringMin)
  let x = cx + Math.cos(a) * d
  let y = cy + Math.sin(a) * d
  if (Math.hypot(x, y) > worldR * 0.97) {
    x = cx - Math.cos(a) * d
    y = cy - Math.sin(a) * d
  }
  ringX = x
  ringY = y
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
  rollRingPos(cx, cy, ringMin, ringMax, rand, worldR)
  const bx = ringX
  const by = ringY
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
  rollRingPos(cx, cy, ringMin, ringMax, rand, worldR)
  const stat = FOE_STATS[type]!
  return foes.spawn(ringX, ringY, type, stat.hp * hpScale, rand())
}

/**
 * 압박 비트 진형 스폰. 한 방향(bearing)에서 뭉쳐 오는 게 핵심이다 —
 * 사방 균일 스폰과 달리 "어디서 오는지"가 정보가 되고, 자리 잡기가 결정이 된다.
 * form: 0 = 쐐기(한 방향 덩어리), 1 = 올가미(포위 링), 2 = 호송대(진행선에 수직 행렬).
 */
export function spawnFormation(
  foes: Foes,
  type: FoeType,
  form: number,
  count: number,
  px: number,
  py: number,
  bearing: number,
  hpScale: number,
  rand: () => number,
  worldR: number,
): void {
  const stat = FOE_STATS[type]!
  const dirX = Math.cos(bearing)
  const dirY = Math.sin(bearing)
  const perpX = -dirY
  const perpY = dirX
  for (let k = 0; k < count; k++) {
    let x: number
    let y: number
    if (form === 1) {
      // 올가미 — 사방에서 균등하게 조여온다 (bearing 은 위상만 준다)
      const a = bearing + (k / count) * Math.PI * 2 + rand() * 0.2
      const d = 520 + rand() * 90
      x = px + Math.cos(a) * d
      y = py + Math.sin(a) * d
    } else if (form === 2) {
      // 호송대 — 진행선에 수직으로 한 줄, 벽처럼 가로지른다
      const off = (k - (count - 1) * 0.5) * 130
      x = px + dirX * 640 + perpX * off
      y = py + dirY * 640 + perpY * off
    } else {
      // 쐐기 — 한 방향에서 덩어리로 밀려온다
      x = px + dirX * (620 + rand() * 160) + perpX * (rand() - 0.5) * 280
      y = py + dirY * (620 + rand() * 160) + perpY * (rand() - 0.5) * 280
    }
    // 월드 밖이면 안쪽으로 눌러 담는다 — 접으면(반대편) 진형이 깨진다
    const rr = Math.hypot(x, y)
    if (rr > worldR * 0.95) {
      const s = (worldR * 0.95) / rr
      x *= s
      y *= s
    }
    if (foes.spawn(x, y, type, stat.hp * hpScale, rand()) < 0) return
  }
}

/**
 * 보스 크기 배율. **렌더와 판정이 같은 값을 써야 한다.**
 *
 * 렌더만 3.4배로 키우고 판정은 원본을 썼더니 보이는 몸통의 71%가 관통 불가 허상이었다 —
 * 5막 Eye 보스는 반경 92px 로 보이는데 40px 안에 들어가야 맞았고, 돌진이 몸을 지나가도
 * 안 아팠다. 예고·회피·빈틈 3단 설계가 전부 연극이었다(적대 리뷰가 잡았다).
 */
export const BOSS_SCALE = 3.4

/** 표시용 회전각. Husk 만 진행 방향을 본다 (삼각형이라 방향이 읽힌다). */
export function foeRotation(foes: Foes, i: number, time: number): number {
  const t = foes.type[i]!
  if (t === Foe.Husk) return Math.atan2(foes.vy[i]!, foes.vx[i]!)
  if (t === Foe.Hex) return time * 0.6 + foes.seed[i]! * 6.283
  if (t === Foe.Eye) return Math.atan2(foes.vy[i]!, foes.vx[i]!) + Math.PI * 0.5
  return foes.seed[i]! * 6.283
}
