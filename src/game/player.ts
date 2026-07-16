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
    // 빠르게 뺀다. 적에 둘러싸이면 피격이 매번 리셋돼서 화면이 계속 빨갛고,
    // 그러면 정작 피해야 할 적이 안 보인다.
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 5.5)
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
    this.hurtFlash = 1
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
    }
    return true
  }

  /**
   * 오른 레벨 수를 반환한다. XP 곡선은 완만하게 — 5분에 12~16레벨이 목표.
   * 한 번에 여러 레벨이 오를 수 있다(자석으로 XP 를 한꺼번에 빨아들일 때).
   * 한 레벨만 올리면 나머지 XP 가 조용히 증발한다.
   */
  gainXp(amount: number): number {
    this.xp += amount * this.stats.greed
    let gained = 0
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded
      this.level++
      this.xpNeeded = Math.floor(5 + this.level * 3.1 + this.level * this.level * 0.42)
      gained++
    }
    return gained
  }

  heal(amount: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + amount)
  }
}
