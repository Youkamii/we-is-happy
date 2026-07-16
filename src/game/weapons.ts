/**
 * 무기와 시너지.
 *
 * 이 게임의 리플레이는 전부 여기서 나온다. 무기 6종 × 패시브 6종이고,
 * 정해진 짝이 조건을 채우면 진화해서 **거동 자체**가 바뀐다 — 숫자만 커지는 게 아니라.
 *
 * game.ts 를 import 하지 않는다(순환 참조). 필요한 것은 FireCtx 로 받는다.
 */
import type { SfxName } from '../engine/audio'
import type { SpatialHash } from '../engine/grid'
import type { Rng } from '../engine/rng'
import { Shape } from '../engine/shapes'
import { spray } from './fx'
import type { Player } from './player'
import type { Foes, Motes, Shots } from './pools'

/** 무기 코드가 게임에 요구하는 최소한. Game 이 이걸 구현한다. */
export interface FireCtx {
  readonly shots: Shots
  readonly motes: Motes
  readonly foes: Foes
  readonly player: Player
  readonly rng: Rng
  readonly hash: SpatialHash
  readonly time: number
  nearestFoe(x: number, y: number, maxDist: number): number
  /** 반경 안의 적 인덱스를 out 에 담고 개수 반환 (거리 확인까지 끝난 것) */
  foesInRadius(x: number, y: number, r: number, out: Int32Array): number
  damageFoe(j: number, damage: number, fromVx: number, fromVy: number): void
  shake(amount: number, decay?: number): void
  sfx(name: SfxName): void
}

export const W = {
  Ember: 0,
  Arc: 1,
  Bolt: 2,
  Orbit: 3,
  Nova: 4,
  Thorn: 5,
} as const

export const P = {
  Might: 0,
  Fury: 1,
  Swift: 2,
  Bloom: 3,
  Greed: 4,
  Ward: 5,
} as const

export interface WeaponDef {
  readonly id: number
  readonly name: string
  readonly desc: string
  /** 진화 후 이름/설명 */
  readonly evoName: string
  readonly evoDesc: string
  /** 진화에 필요한 패시브 */
  readonly evoPassive: number
  readonly cooldown: number
  readonly r: number
  readonly g: number
  readonly b: number
  readonly shape: number
  readonly maxLevel: number
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: W.Ember, name: '불씨', desc: '가장 가까운 적에게 자동으로 쏜다',
    evoName: '장작불', evoDesc: '맞은 적이 불탄다. 불은 옆으로 옮겨붙는다',
    evoPassive: P.Might, cooldown: 0.34,
    r: 2.9, g: 1.4, b: 0.4, shape: Shape.Orb, maxLevel: 8,
  },
  {
    id: W.Arc, name: '호', desc: '주변을 베어낸다. 가까울수록 강하다',
    evoName: '회오리', evoDesc: '멈추지 않고 돈다. 벤 적을 끌고 간다',
    evoPassive: P.Swift, cooldown: 0.85,
    r: 0.5, g: 2.4, b: 2.2, shape: Shape.Blade, maxLevel: 8,
  },
  {
    id: W.Bolt, name: '번개', desc: '적에서 적으로 튄다',
    evoName: '폭풍', evoDesc: '튈 때마다 강해진다. 끝없이 갈라진다',
    evoPassive: P.Fury, cooldown: 1.15,
    r: 2.6, g: 2.4, b: 1.3, shape: Shape.Bolt, maxLevel: 8,
  },
  {
    id: W.Orbit, name: '위성', desc: '주위를 도는 구체. 닿으면 부순다',
    evoName: '후광', evoDesc: '거대해지고 스친 자리에 불티를 남긴다',
    evoPassive: P.Bloom, cooldown: 0,
    r: 1.8, g: 0.8, b: 2.7, shape: Shape.Orb, maxLevel: 8,
  },
  {
    id: W.Nova, name: '신성', desc: '주기적으로 사방을 밀어낸다',
    evoName: '붕괴', evoDesc: '밀어내는 대신 빨아들인 뒤 터뜨린다',
    evoPassive: P.Greed, cooldown: 2.6,
    r: 1.5, g: 2.0, b: 2.9, shape: Shape.Ring, maxLevel: 8,
  },
  {
    id: W.Thorn, name: '가시', desc: '뒤쪽으로 흩뿌린다. 도망칠수록 강하다',
    evoName: '덤불', evoDesc: '가시가 땅에 박혀 남는다',
    evoPassive: P.Ward, cooldown: 0.62,
    r: 1.2, g: 2.4, b: 0.7, shape: Shape.Mote, maxLevel: 8,
  },
]

export interface PassiveDef {
  readonly id: number
  readonly name: string
  readonly desc: string
  readonly maxLevel: number
  apply(p: Player, level: number): void
}

export const PASSIVES: readonly PassiveDef[] = [
  {
    id: P.Might, name: '완력', desc: '피해 +18%', maxLevel: 8,
    apply: (p, l) => { p.stats.damage *= 1 + 0.18 * l },
  },
  {
    id: P.Fury, name: '분노', desc: '공격 속도 +14%', maxLevel: 8,
    apply: (p, l) => { p.stats.cooldown *= Math.pow(0.877, l) },
  },
  {
    id: P.Swift, name: '신속', desc: '이동 +8%, 탄속 +12%', maxLevel: 8,
    apply: (p, l) => { p.stats.speed *= 1 + 0.08 * l; p.stats.projSpeed *= 1 + 0.12 * l },
  },
  {
    id: P.Bloom, name: '개화', desc: '범위 +15%', maxLevel: 8,
    apply: (p, l) => { p.stats.area *= 1 + 0.15 * l },
  },
  {
    id: P.Greed, name: '탐욕', desc: '흡수 범위 +28%, 경험치 +10%', maxLevel: 8,
    apply: (p, l) => { p.stats.magnet *= 1 + 0.28 * l; p.stats.greed *= 1 + 0.1 * l },
  },
  {
    id: P.Ward, name: '수호', desc: '최대 체력 +16, 재생 +0.5/초', maxLevel: 8,
    apply: (p, l) => { p.stats.maxHp += 16 * l; p.stats.regen += 0.5 * l },
  },
]

/** 진화 조건: 무기와 짝 패시브가 모두 이 레벨 이상 */
export const EVO_WEAPON_LEVEL = 5
export const EVO_PASSIVE_LEVEL = 4

export class WeaponSlot {
  level = 1
  timer = 0
  evolved = false
  /** 위성 각도 / 회오리 위상 등 무기별 지속 상태 */
  phase = 0

  constructor(readonly def: number) {}
}

const hitBuf = new Int32Array(1024)
const chainBuf = new Int32Array(256)

/**
 * 무기 한 틱. 쿨다운이 0인 무기(위성)는 매 틱 지속 처리를 한다.
 */
export function tickWeapon(slot: WeaponSlot, ctx: FireCtx, dt: number): void {
  const def = WEAPONS[slot.def]!
  const s = ctx.player.stats

  // 위성은 발사가 아니라 지속이다 — 쿨다운 흐름을 타지 않는다.
  if (def.id === W.Orbit) {
    tickOrbit(slot, ctx, dt)
    return
  }

  slot.timer -= dt
  if (slot.timer > 0) return
  slot.timer = def.cooldown * s.cooldown

  switch (def.id) {
    case W.Ember: fireEmber(slot, ctx); break
    case W.Arc: fireArc(slot, ctx); break
    case W.Bolt: fireBolt(slot, ctx); break
    case W.Nova: fireNova(slot, ctx); break
    case W.Thorn: fireThorn(slot, ctx); break
  }
}

// ── 불씨 / 장작불 ──────────────────────────────────────────────────────

function fireEmber(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  const target = ctx.nearestFoe(p.x, p.y, 700)
  let dx: number
  let dy: number
  if (target >= 0) {
    dx = ctx.foes.x[target]! - p.x
    dy = ctx.foes.y[target]! - p.y
    const d = Math.hypot(dx, dy) || 1
    dx /= d
    dy /= d
  } else {
    dx = p.faceX
    dy = p.faceY
  }

  const count = 1 + Math.floor(slot.level / 3) + Math.floor(s.multi)
  const speed = 640 * s.projSpeed
  const dmg = (7 + slot.level * 3.4) * s.damage
  const spread = count > 1 ? 0.2 : 0
  // 진화하면 관통이 붙고 화상을 남긴다
  const pierce = s.pierce + (slot.evolved ? 2 : 0)

  for (let k = 0; k < count; k++) {
    const off = count > 1 ? (k - (count - 1) * 0.5) * spread : 0
    const c = Math.cos(off)
    const sn = Math.sin(off)
    ctx.shots.spawn(
      p.x, p.y,
      (dx * c - dy * sn) * speed, (dx * sn + dy * c) * speed,
      1.15, dmg, pierce, (7 + slot.level * 0.5) * s.area,
      slot.evolved ? 128 + W.Ember : W.Ember,
      0, ctx.rng.next(),
    )
  }
  ctx.sfx('shoot')
}

// ── 호 / 회오리 ────────────────────────────────────────────────────────

function fireArc(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  const radius = (78 + slot.level * 9) * s.area
  const dmg = (11 + slot.level * 5.2) * s.damage

  // 진화하면 전방향, 아니면 바라보는 쪽 반원
  const full = slot.evolved
  const faceAng = Math.atan2(p.faceY, p.faceX)

  const n = ctx.foesInRadius(p.x, p.y, radius, hitBuf)
  for (let k = 0; k < n; k++) {
    const j = hitBuf[k]!
    const dx = ctx.foes.x[j]! - p.x
    const dy = ctx.foes.y[j]! - p.y
    if (!full) {
      const ang = Math.atan2(dy, dx)
      let diff = ang - faceAng
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      if (Math.abs(diff) > 1.5) continue
    }
    const d = Math.hypot(dx, dy) || 1
    // 가까울수록 강하다 — 붙어서 싸우라는 유인
    const falloff = 1.45 - (d / radius) * 0.6
    ctx.damageFoe(j, dmg * falloff, dx / d, dy / d)
  }

  // 연출: 휘두른 궤적
  const def = WEAPONS[W.Arc]!
  const steps = full ? 14 : 8
  for (let k = 0; k < steps; k++) {
    const a = full
      ? (k / steps) * Math.PI * 2 + slot.phase
      : faceAng + (k / (steps - 1) - 0.5) * 2.6
    ctx.motes.spawn(
      p.x + Math.cos(a) * radius * 0.75, p.y + Math.sin(a) * radius * 0.75,
      Math.cos(a) * 60, Math.sin(a) * 60,
      0.26, radius * 0.42, def.r, def.g, def.b, Shape.Blade,
      0, a + Math.PI * 0.5, 4,
    )
  }
  slot.phase += 0.9
  ctx.shake(slot.evolved ? 3 : 1.6, 16)
  ctx.sfx('blade')
}

// ── 번개 / 폭풍 ────────────────────────────────────────────────────────

function fireBolt(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  let chains = 3 + slot.level
  if (slot.evolved) chains += 6
  const jumpRange = 240 * s.area
  let dmg = (9 + slot.level * 4.1) * s.damage

  let fromX = p.x
  let fromY = p.y
  let used = 0
  const def = WEAPONS[W.Bolt]!

  for (let c = 0; c < chains; c++) {
    const n = ctx.foesInRadius(fromX, fromY, c === 0 ? 460 : jumpRange, chainBuf)
    // 이미 때린 적은 건너뛴다 — 안 그러면 두 마리 사이를 무한히 왕복한다
    let pick = -1
    let bestD = Infinity
    for (let k = 0; k < n; k++) {
      const j = chainBuf[k]!
      let seen = false
      for (let u = 0; u < used; u++) {
        if (chainSeen[u] === j) { seen = true; break }
      }
      if (seen) continue
      const dx = ctx.foes.x[j]! - fromX
      const dy = ctx.foes.y[j]! - fromY
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; pick = j }
    }
    if (pick < 0) break
    if (used < chainSeen.length) chainSeen[used++] = pick

    const tx = ctx.foes.x[pick]!
    const ty = ctx.foes.y[pick]!
    ctx.damageFoe(pick, dmg, tx - fromX, ty - fromY)
    drawBolt(ctx, fromX, fromY, tx, ty, def.r, def.g, def.b)
    fromX = tx
    fromY = ty
    // 진화하면 튈 때마다 세진다
    if (slot.evolved) dmg *= 1.16
  }
  if (used > 0) {
    ctx.shake(2.2, 18)
    ctx.sfx('bolt')
  }
}

/** 체인이 방문한 적. 모듈 레벨 버퍼 — 단일 스레드라 안전하다. */
const chainSeen = new Int32Array(64)

function drawBolt(
  ctx: FireCtx, x0: number, y0: number, x1: number, y1: number,
  r: number, g: number, b: number,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const steps = Math.min(18, Math.max(3, Math.floor(len / 26)))
  const nx = -dy / len
  const ny = dx / len
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    // 지그재그 — 직선이면 번개로 안 보인다
    const jitter = k === 0 || k === steps ? 0 : (Math.random() - 0.5) * 26
    ctx.motes.spawn(
      x0 + dx * t + nx * jitter, y0 + dy * t + ny * jitter,
      0, 0, 0.16, 9, r, g, b, Shape.Spark, 0, Math.atan2(dy, dx), 1,
    )
  }
}

// ── 위성 / 후광 ────────────────────────────────────────────────────────

function tickOrbit(slot: WeaponSlot, ctx: FireCtx, dt: number): void {
  const p = ctx.player
  const s = p.stats
  const count = 2 + Math.floor(slot.level * 0.75) + (slot.evolved ? 3 : 0)
  const dist = (86 + slot.level * 5) * s.area
  const size = (13 + slot.level * 1.6) * s.area * (slot.evolved ? 2.1 : 1)
  const spin = (2.1 + slot.level * 0.12) * (slot.evolved ? 1.5 : 1)
  slot.phase += spin * dt

  const dps = (26 + slot.level * 11) * s.damage
  const def = WEAPONS[W.Orbit]!

  for (let k = 0; k < count; k++) {
    const a = slot.phase + (k / count) * Math.PI * 2
    const ox = p.x + Math.cos(a) * dist
    const oy = p.y + Math.sin(a) * dist

    const n = ctx.foesInRadius(ox, oy, size, hitBuf)
    for (let m = 0; m < n; m++) {
      const j = hitBuf[m]!
      // 지속 접촉이라 dt 로 곱한다. 스치면 조금, 파묻히면 많이.
      ctx.damageFoe(j, dps * dt, Math.cos(a + 1.57), Math.sin(a + 1.57))
    }

    // 구체 자체를 파티클로 그린다 (수명이 한 프레임)
    ctx.motes.spawn(ox, oy, 0, 0, 0.02, size, def.r, def.g, def.b, Shape.Orb, 0, a, 0)
    if (slot.evolved && Math.random() < 0.3) {
      ctx.motes.spawn(
        ox, oy, Math.cos(a + 1.57) * 40, Math.sin(a + 1.57) * 40,
        0.5, size * 0.3, def.r, def.g, def.b, Shape.Spark, 4, a, 2,
      )
    }
  }
}

// ── 신성 / 붕괴 ────────────────────────────────────────────────────────

function fireNova(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  const radius = (128 + slot.level * 18) * s.area
  const dmg = (16 + slot.level * 7.5) * s.damage
  const def = WEAPONS[W.Nova]!

  const n = ctx.foesInRadius(p.x, p.y, radius, hitBuf)
  for (let k = 0; k < n; k++) {
    const j = hitBuf[k]!
    const dx = ctx.foes.x[j]! - p.x
    const dy = ctx.foes.y[j]! - p.y
    const d = Math.hypot(dx, dy) || 1
    // 진화(붕괴)는 밀어내는 대신 끌어당긴다 — 뭉쳐 놓고 다음 폭발로 쓸어버리는 빌드
    const sign = slot.evolved ? -1 : 1
    ctx.damageFoe(j, dmg, (dx / d) * sign * 2.4, (dy / d) * sign * 2.4)
  }

  ctx.motes.spawn(p.x, p.y, 0, 0, 0.5, radius * (slot.evolved ? 0.5 : 1), def.r, def.g, def.b, Shape.Ring, 0, 0, 1)
  spray(ctx.motes, p.x, p.y, 1, 0, 6.283, 18, def.r, def.g, def.b, slot.evolved ? -260 : 340, 0.5, 5)
  ctx.shake(slot.evolved ? 7 : 5, 12)
  ctx.sfx('nova')
}

// ── 가시 / 덤불 ────────────────────────────────────────────────────────

function fireThorn(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  const count = 3 + Math.floor(slot.level * 0.9) + Math.floor(s.multi)
  const dmg = (6 + slot.level * 2.9) * s.damage
  // 진행 반대 방향. 서 있으면 바라보는 반대쪽.
  const speed = Math.hypot(p.vx, p.vy)
  let bx: number
  let by: number
  if (speed > 12) {
    bx = -p.vx / speed
    by = -p.vy / speed
  } else {
    bx = -p.faceX
    by = -p.faceY
  }
  // 도망칠수록 강하다 — 이동 속도가 곧 위력
  const boost = 1 + Math.min(1.6, speed / 240)

  for (let k = 0; k < count; k++) {
    const a = Math.atan2(by, bx) + (ctx.rng.next() - 0.5) * 1.5
    const v = (300 + ctx.rng.next() * 240) * s.projSpeed
    ctx.shots.spawn(
      p.x, p.y, Math.cos(a) * v, Math.sin(a) * v,
      // 진화하면 오래 남아 땅에 박힌 함정처럼 군다
      slot.evolved ? 3.4 : 0.9,
      dmg * boost, s.pierce + (slot.evolved ? 3 : 0),
      (5 + slot.level * 0.4) * s.area,
      slot.evolved ? 128 + W.Thorn : W.Thorn,
      0, ctx.rng.next(),
    )
  }
  ctx.sfx('shoot')
}

/**
 * 탄의 weapon 필드는 하위 7비트가 무기 id, 128 비트가 진화 여부다.
 * (Uint8Array 한 칸에 둘 다 담으려고 이렇게 했다.)
 */
export function isEvolvedShot(weapon: number): boolean {
  return weapon >= 128
}
