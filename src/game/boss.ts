/**
 * 보스 — 패턴을 읽고 피하는 것.
 *
 * 예전 보스는 **체력만 큰 잔챙이**였다. 3.4배 크고 체력이 2,400 일 뿐 하는 일이
 * 잔챙이와 똑같았다 — 플레이어를 향해 걸어온다. 그건 "고비"가 아니라 그냥
 * 오래 걸리는 적이고, 15분 런에 5번 나오면 5번 다 지루하다.
 *
 * 조작이 이동뿐이므로 보스는 **읽고 피하는 것**이어야 한다. 각 패턴은:
 *  1) 예고가 있다 (읽을 시간)
 *  2) 이동만으로 피할 수 있다 (공정하다)
 *  3) 피하면 보상이 있다 (돌진 후 기절 = 딜 기회)
 *
 * 보스는 한 번에 하나뿐이라 여기서 객체를 써도 hot path 를 건드리지 않는다.
 */
import type { Rng } from '../engine/rng'

export const BossState = {
  /** 걸어온다. 다음 패턴을 고르는 중. */
  Stalk: 0,
  /** 조준 — 멈춰서 플레이어를 본다. 예고. */
  Aim: 1,
  /** 돌진 — 직선으로 튀어나간다 */
  Charge: 2,
  /** 기절 — 돌진 후 빈틈. 딜 기회. */
  Stagger: 3,
  /** 소환 — 인장이 차오르는 동안이 예고, 잔챙이는 상태가 끝날 때 나온다 */
  Summon: 4,
  /** 수축장 — 유예(COLLAPSE_GRACE) 동안 조여들기만 하고, 그 뒤부터 안쪽이 아프다 */
  Collapse: 5,
} as const
export type BossStateType = (typeof BossState)[keyof typeof BossState]

/** 각 상태가 유지되는 시간(초). 이 숫자가 곧 "읽을 시간"이다. */
const DURATION: Record<number, number> = {
  [BossState.Stalk]: 3.4,
  [BossState.Aim]: 1.1, // 짧으면 못 읽고, 길면 지루하다
  [BossState.Charge]: 0.85,
  [BossState.Stagger]: 2.2, // 딜 기회. 넉넉해야 보상으로 느껴진다
  [BossState.Summon]: 1.4,
  [BossState.Collapse]: 2.6,
}

/**
 * 수축장이 실제로 물기 시작하기까지의 유예(초).
 *
 * 링은 **플레이어 발밑**(반경 520, 조임 210px/s)에서 시작하므로, 최고속(238px/s)으로
 * 즉시 도주해도 링 밖까지 520/(238+210) ≈ 1.16초가 걸린다. 유예가 그보다 짧으면
 * 완벽한 반응에도 피해가 **확정**된다 — 위 계약 2번("이동만으로 피할 수 있다") 위반.
 * 실제로 유예 0이던 시절 확정 피해가 ~33(체력 180의 18%)이었다.
 * 1.5초 = 탈출 시간 + 반응 여유 0.34초.
 */
export const COLLAPSE_GRACE = 1.5

export class Boss {
  /** Foes 풀에서의 인덱스. -1 이면 보스가 없다. */
  idx = -1
  maxHp = 0
  /**
   * 신원 확인용 도장.
   *
   * **인덱스만으로는 보스를 식별할 수 없다.** Foes 풀의 acquire() 가 LIFO 라 방금 죽은
   * 슬롯을 최우선 재사용하는데, step() 순서가 `updateShots(보스 사망) → spawn → tickActs`
   * 라서 보스가 죽은 **같은 스텝의 spawn 이 그 슬롯을 잡졸에게 넘긴다**. 그러면
   * `alive[idx] === 0` 검사가 1을 보고 통과해 잡졸 하나가 보스 정체성을 통째로 상속한다
   * — 크기 3.4배, 왕관, 화면 밖 마커, 돌진 962px/s, 소환, 수축장 피해까지 전부.
   * (적대 리뷰가 잡았다. boss.test.ts 는 Boss 를 단독 테스트해서 이 경로를 못 봤다.)
   */
  stamp = 0
  state: BossStateType = BossState.Stalk
  timer = 0
  /** 돌진 방향 (Aim 끝에 확정) */
  dirX = 1
  dirY = 0
  /** 수축장 중심·반경 */
  ringX = 0
  ringY = 0
  ringR = 0
  /** 이번 막 보스가 몇 번째 패턴을 쓰는지 — 순환시켜 같은 패턴만 반복되지 않게 */
  private cycle = 0

  reset(): void {
    this.idx = -1
    this.maxHp = 0
    this.stamp = 0
    this.state = BossState.Stalk
    this.timer = 0
    this.cycle = 0
    this.ringR = 0
    // 조준 방향도 되돌린다 — 안 그러면 새 보스가 이전 보스의 마지막 조준을 물려받는다
    this.dirX = 1
    this.dirY = 0
  }

  spawn(idx: number, maxHp: number, stamp: number): void {
    this.idx = idx
    this.maxHp = maxHp
    this.stamp = stamp
    this.state = BossState.Stalk
    this.timer = DURATION[BossState.Stalk]!
    this.cycle = 0
  }

  get alive(): boolean {
    return this.idx >= 0
  }

  /** 상태 전이. 반환값이 새 상태면 호출자가 연출·소환을 한다. */
  tick(dt: number, rng: Rng, hpFrac: number): BossStateType | null {
    if (this.idx < 0) return null
    this.timer -= dt
    if (this.timer > 0) return null

    const next = this.nextState(rng, hpFrac)
    this.state = next
    this.timer = DURATION[next]!
    return next
  }

  private nextState(rng: Rng, hpFrac: number): BossStateType {
    switch (this.state) {
      // 예고 → 실행
      case BossState.Aim:
        return BossState.Charge
      // 돌진이 끝나면 반드시 빈틈. 이게 없으면 피해도 보상이 없다.
      case BossState.Charge:
        return BossState.Stagger
      // 실행이 끝나면 다시 걷는다
      case BossState.Stagger:
      case BossState.Summon:
      case BossState.Collapse:
        return BossState.Stalk
      default: {
        // 걷다가 패턴을 고른다. 순환 + 난수를 섞어 예측 가능하되 지루하지 않게.
        // 체력이 낮을수록 돌진이 잦다 — 궁지에 몰린 짐승.
        this.cycle++
        const aggressive = hpFrac < 0.4
        const roll = rng.next()
        if (aggressive && roll < 0.5) return BossState.Aim
        switch (this.cycle % 3) {
          case 0: return BossState.Summon
          case 1: return BossState.Aim
          default: return BossState.Collapse
        }
      }
    }
  }

  /** 지금 상태에서의 이동 배율. 0이면 멈춘다. */
  speedScale(): number {
    switch (this.state) {
      case BossState.Aim: return 0 // 멈춰야 예고가 읽힌다
      case BossState.Charge: return 6.5 // 튀어나간다
      case BossState.Stagger: return 0 // 빈틈
      case BossState.Summon: return 0.15
      case BossState.Collapse: return 0.3
      default: return 1
    }
  }

  /** 지금 상태에서 받는 피해 배율. 빈틈이 곧 보상이다. */
  damageScale(): number {
    return this.state === BossState.Stagger ? 2.4 : 1
  }

  /** 0..1 — 예고 진행도. 연출이 이걸로 차오른다. */
  telegraph(): number {
    const total = DURATION[this.state]!
    return 1 - Math.max(0, this.timer) / total
  }

  /** 수축장이 무는 중인가. 유예 동안은 조여들기만 한다 — 그때 나가면 무피해. */
  collapseArmed(): boolean {
    return (
      this.state === BossState.Collapse &&
      DURATION[BossState.Collapse]! - this.timer >= COLLAPSE_GRACE
    )
  }
}
