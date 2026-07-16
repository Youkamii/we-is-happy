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
  /** 월드에 지속 효과체(중력정·신문·정지장)를 놓는다 */
  placeField(kind: number, x: number, y: number, radius: number, power: number, life: number): void
  /** 반경 안 적을 전부 밀거나 당긴다. force 가 음수면 당긴다. */
  pushFoes(x: number, y: number, radius: number, force: number): void
  /** 지형을 부순다 (혜성 전용) */
  breakTerrain(x: number, y: number, radius: number, power: number): void
}

/** 지속 효과체 종류. game.ts 의 Fields 풀이 이 값으로 거동을 가른다. */
export const Field = {
  Well: 0, // 중력정 — 끌어당기고 갉는다
  Sigil: 1, // 신문 — 밟으면 터진다
  Still: 2, // 정지장 — 시간을 늦춘다
  Echo: 3, // 반향 — 잠시 뒤 터진다
} as const

export const W = {
  Ember: 0,
  Arc: 1,
  Bolt: 2,
  Orbit: 3,
  Nova: 4,
  Thorn: 5,
  // ── 우주·신격 ──
  Well: 6, // 중력정 — 빨아들여 뭉친다
  Beam: 7, // 광선 — 관통 지속 빔
  Comet: 8, // 혜성 — 지형을 뚫고 폭발
  Sigil: 9, // 신문 — 발밑 인장
  Echo: 10, // 반향 — 죽인 자리에서 다시 터진다
  Still: 11, // 정지 — 시간을 늦춘다
} as const

export const P = {
  Might: 0,
  Fury: 1,
  Swift: 2,
  Bloom: 3,
  Greed: 4,
  Ward: 5,
  // ── 우주·신격 ──
  Split: 6, // 다중 — 발사체 +1
  Pierce: 7, // 관통 — 관통 +1
  Blast: 8, // 폭심 — 폭발 반경·연쇄
  Essence: 9, // 정수 — 치명타
  Recoil: 10, // 반동 — 넉백
  Awaken: 11, // 각성 — 진화 요구 완화
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
  {
    id: W.Well, name: '중력정', desc: '허공에 우물을 판다. 닿은 것이 끌려들어간다',
    evoName: '특이점', evoDesc: '삼킨 만큼 무거워지고, 한계에 닿으면 붕괴한다',
    evoPassive: P.Blast, cooldown: 3.4,
    r: 1.4, g: 0.5, b: 2.8, shape: Shape.Singularity, maxLevel: 8,
  },
  {
    id: W.Beam, name: '광선', desc: '별빛을 한 줄기로 모은다. 닿는 모든 것을 태운다',
    evoName: '천벌', evoDesc: '줄기가 갈라져 스스로 겨눈다',
    evoPassive: P.Pierce, cooldown: 1.9,
    r: 2.9, g: 2.2, b: 1.0, shape: Shape.Prism, maxLevel: 8,
  },
  {
    id: W.Comet, name: '혜성', desc: '무거운 것을 던진다. 지형도 뚫는다',
    evoName: '운석우', evoDesc: '하늘이 무너진다. 여러 개가 동시에',
    evoPassive: P.Split, cooldown: 2.2,
    r: 2.6, g: 1.3, b: 0.5, shape: Shape.Comet, maxLevel: 8,
  },
  {
    id: W.Sigil, name: '신문', desc: '지나온 자리에 문양을 새긴다. 밟으면 터진다',
    evoName: '봉인진', evoDesc: '문양이 서로를 잇는다. 선에 닿아도 터진다',
    evoPassive: P.Essence, cooldown: 0.75,
    r: 2.2, g: 1.9, b: 0.4, shape: Shape.Sigil, maxLevel: 8,
  },
  {
    id: W.Echo, name: '반향', desc: '내가 부순 자리에서 소리가 되돌아온다',
    evoName: '연쇄붕괴', evoDesc: '되돌아온 소리가 또 소리를 낳는다',
    evoPassive: P.Recoil, cooldown: 0,
    r: 0.6, g: 2.0, b: 2.6, shape: Shape.Rift, maxLevel: 8,
  },
  {
    id: W.Still, name: '정지', desc: '주위의 시간이 느려진다',
    evoName: '영겁', evoDesc: '멈춘 것들은 더 아프게 부서진다',
    evoPassive: P.Awaken, cooldown: 4.2,
    r: 0.5, g: 1.4, b: 2.9, shape: Shape.Halo, maxLevel: 8,
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
  {
    // #9 에서 "선언만 있고 배선 없음"으로 잡혔던 Stats.multi 를 여기서 되살린다.
    id: P.Split, name: '분광', desc: '발사체 +1 (2레벨마다)', maxLevel: 8,
    apply: (p, l) => { p.stats.multi += l * 0.5 },
  },
  {
    // 마찬가지로 Stats.pierce 의 첫 사용처.
    id: P.Pierce, name: '투과', desc: '관통 +1 (2레벨마다)', maxLevel: 8,
    apply: (p, l) => { p.stats.pierce += l * 0.5 },
  },
  {
    id: P.Blast, name: '폭심', desc: '폭발 반경 +20%, 연쇄 +1', maxLevel: 8,
    apply: (p, l) => { p.stats.blast *= 1 + 0.2 * l; p.stats.chain += l * 0.5 },
  },
  {
    id: P.Essence, name: '정수', desc: '치명 확률 +6%, 치명 배율 +0.25', maxLevel: 8,
    apply: (p, l) => { p.stats.critChance += 0.06 * l; p.stats.critMult += 0.25 * l },
  },
  {
    id: P.Recoil, name: '반동', desc: '넉백 +35%, 이동 +4%', maxLevel: 8,
    apply: (p, l) => { p.stats.knockback *= 1 + 0.35 * l; p.stats.speed *= 1 + 0.04 * l },
  },
  {
    // 진화 요구를 낮춘다 — 이게 있으면 조합을 더 빨리 발견하게 된다.
    id: P.Awaken, name: '각성', desc: '진화 요구 레벨 -1 (3레벨마다)', maxLevel: 6,
    apply: (p, l) => { p.stats.awaken += Math.floor(l / 3) },
  },
]

/** 진화 조건: 무기와 짝 패시브가 모두 이 레벨 이상 */
export const EVO_WEAPON_LEVEL = 5
export const EVO_PASSIVE_LEVEL = 4

/**
 * 시작 무기가 될 수 있는 것들.
 *
 * 반향(Echo)은 **내가 죽인 자리**에서만 발동하므로 그것만 들고 시작하면 영원히 0킬이다
 * (실측: 12초에 HP 21, 킬 0). 정지(Still)도 피해가 0이라 같은 문제다.
 * 스스로 적을 죽일 수 있는 무기만 출발점이 된다.
 */
export const STARTER_WEAPONS: readonly number[] = [
  W.Ember, W.Arc, W.Bolt, W.Orbit, W.Nova, W.Thorn, W.Well, W.Beam, W.Comet, W.Sigil,
]

export class WeaponSlot {
  level = 1
  timer = 0
  evolved = false
  /** 위성 각도 / 회오리 위상 등 무기별 지속 상태 */
  phase = 0

  constructor(readonly def: number) {}
}

const hitBuf = new Int32Array(4096)
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
  // 반향도 발사가 없다. 내가 뭔가를 죽일 때 game.ts 가 echoKill() 을 부른다.
  if (def.id === W.Echo) return

  slot.timer -= dt
  if (slot.timer > 0) return
  slot.timer = def.cooldown * s.cooldown

  switch (def.id) {
    case W.Ember: fireEmber(slot, ctx); break
    case W.Arc: fireArc(slot, ctx); break
    case W.Bolt: fireBolt(slot, ctx); break
    case W.Nova: fireNova(slot, ctx); break
    case W.Thorn: fireThorn(slot, ctx); break
    case W.Well: fireWell(slot, ctx); break
    case W.Beam: fireBeam(slot, ctx); break
    case W.Comet: fireComet(slot, ctx); break
    case W.Sigil: fireSigil(slot, ctx); break
    case W.Still: fireStill(slot, ctx); break
  }
}

// ── 중력정 / 특이점 ────────────────────────────────────────────────────

function fireWell(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  // 가장 붐비는 쪽에 판다 — 아무 데나 파면 우물이 허공에 뜬다
  const target = ctx.nearestFoe(p.x, p.y, 620)
  let x = p.x + p.faceX * 200
  let y = p.y + p.faceY * 200
  if (target >= 0) {
    x = ctx.foes.x[target]!
    y = ctx.foes.y[target]!
  }
  const radius = (110 + slot.level * 12) * s.area * s.blast
  const power = (14 + slot.level * 7) * s.damage
  // 진화(특이점)는 오래 남고 끝에 붕괴한다
  ctx.placeField(Field.Well, x, y, radius, power, slot.evolved ? 4.2 : 2.6)
  ctx.sfx('nova')
}

// ── 광선 / 천벌 ────────────────────────────────────────────────────────

function fireBeam(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  const def = WEAPONS[W.Beam]!
  // 진화하면 여러 줄기가 각자 겨눈다
  const beams = slot.evolved ? 3 + Math.floor(s.multi) : 1
  const len = (520 + slot.level * 40) * s.area
  const width = (16 + slot.level * 2.2) * s.area
  const dmg = (30 + slot.level * 14) * s.damage

  for (let bIdx = 0; bIdx < beams; bIdx++) {
    let dx = p.faceX
    let dy = p.faceY
    if (slot.evolved) {
      // 각 줄기가 서로 다른 적을 문다
      const t = ctx.nearestFoe(
        p.x + Math.cos(bIdx * 2.1) * 160, p.y + Math.sin(bIdx * 2.1) * 160, 700,
      )
      if (t >= 0) {
        dx = ctx.foes.x[t]! - p.x
        dy = ctx.foes.y[t]! - p.y
        const d = Math.hypot(dx, dy) || 1
        dx /= d
        dy /= d
      }
    } else {
      const t = ctx.nearestFoe(p.x, p.y, 700)
      if (t >= 0) {
        dx = ctx.foes.x[t]! - p.x
        dy = ctx.foes.y[t]! - p.y
        const d = Math.hypot(dx, dy) || 1
        dx /= d
        dy /= d
      }
    }

    // 빔 축을 따라 캡슐 판정. 선분 거리로 한 번에 훑는다.
    const ex = p.x + dx * len
    const ey = p.y + dy * len
    const midX = (p.x + ex) * 0.5
    const midY = (p.y + ey) * 0.5
    const n = ctx.foesInRadius(midX, midY, len * 0.5 + width, hitBuf)
    for (let k = 0; k < n; k++) {
      const j = hitBuf[k]!
      // 점-선분 거리
      const px = ctx.foes.x[j]! - p.x
      const py = ctx.foes.y[j]! - p.y
      const t = Math.max(0, Math.min(len, px * dx + py * dy))
      const cx = px - dx * t
      const cy = py - dy * t
      if (cx * cx + cy * cy > width * width) continue
      ctx.damageFoe(j, dmg, dx, dy)
    }

    // 연출: 축을 따라 섬광을 깐다
    const steps = 16
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      ctx.motes.spawn(
        p.x + dx * len * t, p.y + dy * len * t, 0, 0,
        0.18, width * 1.6, def.r, def.g, def.b, Shape.Spark,
        0, Math.atan2(dy, dx), 1,
      )
    }
    ctx.motes.spawn(ex, ey, 0, 0, 0.3, width * 3, def.r, def.g, def.b, Shape.Nova, 0, 0, 1)
  }
  ctx.shake(4, 14)
  ctx.sfx('bolt')
}

// ── 혜성 / 운석우 ──────────────────────────────────────────────────────

function fireComet(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  const count = (slot.evolved ? 3 : 1) + Math.floor(s.multi)
  const dmg = (26 + slot.level * 12) * s.damage
  const speed = 420 * s.projSpeed

  for (let k = 0; k < count; k++) {
    const t = ctx.nearestFoe(
      p.x + (ctx.rng.next() - 0.5) * 400, p.y + (ctx.rng.next() - 0.5) * 400, 800,
    )
    let dx = p.faceX
    let dy = p.faceY
    if (t >= 0) {
      dx = ctx.foes.x[t]! - p.x
      dy = ctx.foes.y[t]! - p.y
      const d = Math.hypot(dx, dy) || 1
      dx /= d
      dy /= d
    }
    const spread = count > 1 ? (ctx.rng.next() - 0.5) * 0.5 : 0
    const c = Math.cos(spread)
    const sn = Math.sin(spread)
    ctx.shots.spawn(
      p.x, p.y,
      (dx * c - dy * sn) * speed, (dx * sn + dy * c) * speed,
      2.2, dmg, 99, (16 + slot.level * 1.8) * s.area,
      slot.evolved ? 128 + W.Comet : W.Comet,
      ctx.rng.next(),
    )
  }
  ctx.shake(3, 16)
  ctx.sfx('shoot')
}

// ── 신문 / 봉인진 ──────────────────────────────────────────────────────

function fireSigil(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  // 지나온 자리에 새긴다 — 움직임이 곧 배치다
  const radius = (54 + slot.level * 5) * s.area * s.blast
  const power = (18 + slot.level * 9) * s.damage
  ctx.placeField(Field.Sigil, p.x, p.y, radius, power, slot.evolved ? 7 : 4.5)
  ctx.sfx('pickup')
}

// ── 정지 / 영겁 ────────────────────────────────────────────────────────

function fireStill(slot: WeaponSlot, ctx: FireCtx): void {
  const p = ctx.player
  const s = p.stats
  const radius = (150 + slot.level * 16) * s.area
  // 진화(영겁)는 멈춘 것을 더 아프게 만든다 — power 가 피해 증폭 배율로 쓰인다
  const power = slot.evolved ? 1.9 : 1
  ctx.placeField(Field.Still, p.x, p.y, radius, power, 3.2)
  ctx.sfx('nova')
  ctx.shake(3, 12)
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
      ctx.rng.next(),
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
  // 착탄 지점에 번개 문양 하나. 아틀라스에 Bolt 셀을 구워 놓고 아무 데서도 안 써서
  // 이 게임에 존재하지 않는 그림이었다.
  ctx.motes.spawn(
    x1, y1, 0, 0, 0.22, 30, r * 1.2, g * 1.2, b, Shape.Bolt,
    0, Math.atan2(dy, dx) - Math.PI * 0.5, 1,
  )
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
      ctx.rng.next(),
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

/**
 * 반향 — 무언가 죽은 자리에서 소리가 되돌아온다.
 * game.ts 의 killFoe 가 부른다. 확률로 발동해야 화면이 연쇄로 뒤덮이지 않는다.
 */
export function echoKill(slot: WeaponSlot, ctx: FireCtx, x: number, y: number, depth: number): void {
  const s = ctx.player.stats
  // 진화(연쇄붕괴)는 반향이 또 반향을 낳는다. depth 로 상한을 둔다 —
  // 없으면 후반 초당 수백 킬에서 무한 연쇄가 되어 프레임이 죽는다.
  const maxDepth = slot.evolved ? 2 + Math.floor(s.chain) : 0
  if (depth > maxDepth) return
  const chance = (0.16 + slot.level * 0.035) * (depth === 0 ? 1 : 0.45)
  if (ctx.rng.next() > chance) return

  const radius = (58 + slot.level * 7) * s.area * s.blast
  const power = (14 + slot.level * 8) * s.damage
  ctx.placeField(Field.Echo, x, y, radius, power, 0.42)
}
