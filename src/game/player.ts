/**
 * 플레이어. 조작은 이동뿐이므로 여기는 얇다.
 * 대신 스탯이 두껍다 — 패시브가 곱해지는 지점이 전부 여기로 모인다.
 */
import type { MoveVector } from '../engine/input'

/**
 * 배율은 전부 1.0 기준. 패시브는 이 값을 곱하거나 더한다.
 * "공격력 +10%" 같은 걸 무기마다 따로 계산하면 시너지 계산이 지옥이 된다.
 */
export interface Stats {
  maxHp: number
  speed: number
  /** 모든 피해 배율 */
  damage: number
  /** 발사 간격 배율 (작을수록 빠름) */
  cooldown: number
  /** 탄·폭발 크기 배율 */
  area: number
  /** 탄속 배율 */
  projSpeed: number
  /** 관통 추가 횟수 */
  pierce: number
  /** 발사체 추가 개수 */
  multi: number
  /** XP 흡수 반경 */
  magnet: number
  /** 초당 체력 재생 */
  regen: number
  /** 피격 후 무적 시간 */
  iframe: number
  /** 획득 XP 배율 */
  greed: number
  /** 치명타 확률 / 배율 */
  critChance: number
  critMult: number
  /** 넉백 배율 */
  knockback: number
  /** 폭발 반경 배율 (area 와 별개 — 폭발만 키우는 축) */
  blast: number
  /** 연쇄 추가 횟수 (번개·반향) */
  chain: number
  /** 진화 요구 레벨 완화 */
  awaken: number
}

export function baseStats(): Stats {
  return {
    maxHp: 100,
    speed: 238,
    damage: 1,
    cooldown: 1,
    area: 1,
    projSpeed: 1,
    pierce: 0,
    multi: 0,
    magnet: 95,
    regen: 0,
    iframe: 0.55,
    greed: 1,
    critChance: 0.05,
    critMult: 2,
    knockback: 1,
    blast: 1,
    chain: 0,
    awaken: 0,
  }
}

/** 레벨 성장으로 오른 양. 레벨업 화면에서 "이번에 뭐가 올랐는지" 보여줄 때 쓴다. */
export interface LevelGain {
  maxHp: number
  damage: number
  speed: number
  magnet: number
  /** 5레벨마다 오는 마일스톤이면 어떤 것인지 (없으면 빈 문자열) */
  milestone: string
}

/**
 * 레벨 자체가 주는 기초 성장.
 *
 * 3택은 안 고른 2개가 손실감이라, 레벨업이 순수한 보상이 되려면 **선택과 무관하게**
 * 강해지는 축이 있어야 한다. 5레벨마다 마일스톤으로 한 번씩 크게 준다 —
 * 15분 런에서 40레벨까지 가므로 마일스톤이 8번 온다.
 *
 * recomputeStats 가 매번 baseStats() 부터 다시 쌓으므로 이것도 거기 포함돼야 한다
 * (증분 적용하면 되돌릴 수가 없다 — 기존 테스트가 지키는 계약).
 */
export function applyLevelGrowth(s: Stats, level: number): void {
  const n = level - 1 // 1레벨은 성장 0
  if (n <= 0) return
  s.maxHp += 7 * n
  s.damage *= 1 + 0.035 * n
  s.speed *= 1 + 0.006 * n
  s.magnet *= 1 + 0.02 * n

  // 마일스톤: 5레벨마다 굵게. 순환시켜 한 축만 커지지 않게 한다.
  const milestones = Math.floor(level / 5)
  for (let m = 1; m <= milestones; m++) {
    switch (m % 4) {
      case 1: s.maxHp += 26; break
      case 2: s.cooldown *= 0.93; break
      case 3: s.area *= 1.08; break
      default: s.critChance += 0.04; break
    }
  }
}

/** 이번 레벨업으로 뭐가 올랐는지 (표시용). */
export function levelGainOf(level: number): LevelGain {
  const before = baseStats()
  applyLevelGrowth(before, level - 1)
  const after = baseStats()
  applyLevelGrowth(after, level)
  const MILESTONE_NAMES = ['치명 +4%', '체력 +26', '공속 +7%', '범위 +8%']
  return {
    maxHp: Math.round(after.maxHp - before.maxHp),
    damage: Math.round((after.damage / before.damage - 1) * 1000) / 10,
    speed: Math.round((after.speed / before.speed - 1) * 1000) / 10,
    magnet: Math.round((after.magnet / before.magnet - 1) * 1000) / 10,
    milestone: level % 5 === 0 ? MILESTONE_NAMES[Math.floor(level / 5) % 4]! : '',
  }
}

export class Player {
  x = 0
  y = 0
  vx = 0
  vy = 0
  hp = 100
  stats: Stats = baseStats()
  level = 1
  xp = 0
  xpNeeded = 5
  /** 남은 무적 시간 */
  invuln = 0
  /** 피격 연출 강도 0..1 — 화면 붉은 플래시가 여기 붙는다 */
  hurtFlash = 0
  /** 마지막으로 바라본 방향 (정지 중에도 조준에 쓴다) */
  faceX = 1
  faceY = 0
  radius = 13
  alive = true
  /** 누적 통계 — 스코어 화면용 */
  kills = 0
  damageDealt = 0
  damageTaken = 0

  reset(): void {
    this.x = 0
    this.y = 0
    this.vx = 0
    this.vy = 0
    this.stats = baseStats()
    this.hp = this.stats.maxHp
    this.level = 1
    this.xp = 0
    this.xpNeeded = 5
    this.invuln = 0
    this.hurtFlash = 0
    this.faceX = 1
    this.faceY = 0
    this.alive = true
    this.kills = 0
    this.damageDealt = 0
    this.damageTaken = 0
  }

  update(move: MoveVector, dt: number, worldR: number): void {
    const s = this.stats
    // 가속을 넣으면 "미끄러진다"는 느낌이 생겨 회피가 답답해진다. 즉시 반응이 옳다.
    const targetVx = move.x * s.speed
    const targetVy = move.y * s.speed
    const blend = 1 - Math.exp(-22 * dt)
    this.vx += (targetVx - this.vx) * blend
    this.vy += (targetVy - this.vy) * blend

    this.x += this.vx * dt
    this.y += this.vy * dt

    // 월드 경계
    const rr = Math.hypot(this.x, this.y)
    const limit = worldR - this.radius
    if (rr > limit) {
      const inv = limit / rr
      this.x *= inv
      this.y *= inv
    }

    if (move.x !== 0 || move.y !== 0) {
      this.faceX = move.x
      this.faceY = move.y
    }

    if (this.invuln > 0) this.invuln -= dt
    // 아주 빠르게 뺀다. 적에 둘러싸이면 피격이 매번 리셋돼서 상시 켜지고,
    // 그러면 "피격 표시"가 아니라 그냥 빨간 필터다.
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 9)
    if (s.regen > 0 && this.hp < s.maxHp) {
      this.hp = Math.min(s.maxHp, this.hp + s.regen * dt)
    }
  }

  /** 실제로 피해가 들어갔으면 true (무적이면 false). */
  hurt(amount: number): boolean {
    if (this.invuln > 0 || !this.alive) return false
    this.hp -= amount
    this.damageTaken += amount
    this.invuln = this.stats.iframe
    // 누적하지 않고 최대치를 낮게 잡는다 — 연속 피격이 곧 상시 점등이었다
    this.hurtFlash = 0.6
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
    }
    return true
  }

  /**
   * 오른 레벨 수를 반환한다.
   *
   * 곡선 튜닝 근거 (봇 실측 3회 — 전부 감이 아니라 측정으로 잡았다):
   * - lv²·0.42          → 5분에 Lv 91. 폭주. 만렙 뒤 50레벨이 "숨 고르기"만 떴다.
   * - lv²·1.35          → 5분엔 Lv 41 로 맞았지만 15분에서 **Lv 145** 로 재폭주.
   * - lv²·1.6 + lv³·.055 → 이번엔 반대로 부러졌다. 평균 Lv 25.5, **평균 진화 0.3** —
   *   6판 중 2판만 진화를 딱 1번 봤다. 진화는 이 게임 조합 시스템의 정점인데
   *   15분을 버텨도 못 본다면 그 시스템은 없는 거나 마찬가지다.
   *
   * 목표는 15분에 Lv 45~60, 진화 2~4회. 삼차항은 남기되(후반 폭주 방지) 계수를
   * 3분의 1로 줄이고 이차항도 낮춰서, 중반까지 잘 오르고 끝에서만 눕게 했다.
   *
   * 한 번에 여러 레벨이 오를 수 있다(자석으로 XP 를 한꺼번에 빨아들일 때).
   * 한 레벨만 올리면 나머지 XP 가 조용히 증발한다.
   */
  gainXp(amount: number): number {
    this.xp += amount * this.stats.greed
    let gained = 0
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded
      this.level++
      const l = this.level
      this.xpNeeded = Math.floor(4 + l * 4 + l * l * 0.92 + l * l * l * 0.018)
      gained++
    }
    return gained
  }

  heal(amount: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + amount)
  }
}
