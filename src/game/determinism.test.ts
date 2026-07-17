/**
 * 결정론 회귀 테스트.
 *
 * 이게 깨지면 데일리 시드(전 세계가 같은 맵)도 협동 동기화도 성립하지 않는다.
 * 시뮬레이션 어딘가에 Math.random 이 섞여 들어가면 여기서 잡힌다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Rng, dailySeed, hashSeed } from '../engine/rng'
import { Game, Phase } from './game'
import { xpForLevel } from './player'

/** Game.update 는 input.move 만 읽는다. */
function mockInput(x: number, y: number): Input {
  return {
    move: { x, y },
    update() {},
    endFrame() {},
    consumePressed: () => false,
    isDown: () => false,
    moving: x !== 0 || y !== 0,
  } as unknown as Input
}

/** 시뮬레이션 상태를 한 줄로 요약. 부동소수점을 그대로 비교하면 무의미하게 깨진다. */
function fingerprint(game: Game): string {
  const f = game.foes
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i < f.high; i++) {
    if (f.alive[i] === 0) continue
    sx += f.x[i]!
    sy += f.y[i]!
    n++
  }
  // **정밀도를 낮춘다.** 적 2,000마리 좌표 합을 그대로 비교하면 부동소수점 누적
  // 오차(소수점 3자리)만으로 깨진다 — 그건 결정론이 깨진 게 아니라 지문이 잡음을
  // 재는 것이다. 스텝 순서가 진짜로 갈리면 개체 수·킬·체력이 먼저 달라진다.
  return [
    n,
    game.player.kills,
    Math.round(game.player.hp),
    Math.round(sx / 100),
    Math.round(sy / 100),
  ].join('|')
}

/**
 * **시뮬레이션 시간** `seconds` 에 도달할 때까지 프레임 `dt` 로 돌린다.
 *
 * 벽시계 프레임 수(seconds/dt)로 돌리면 안 된다. update() 가 float 누적으로 스텝 수를
 * 유도하므로, 1/60 을 2700번 더한 값(44.99999…)과 2/60 을 1350번 더한 값의 드리프트가
 * 달라서 **실제 스텝이 2690 vs 2682 로 갈린다**(실측). 정수 µs 로 바꿔도 16666.67 이
 * 딱 안 나눠떨어져 같은 문제가 남는다 — 구조적이라 없앨 수 없다.
 *
 * 그래서 계약을 바로잡았다: "같은 벽시계 시간"이 아니라 **"같은 시뮬레이션 시간에
 * 같은 상태"**. 이게 실제로 지켜져야 하는 것이고(협동 lockstep 도 스텝 기준이다),
 * game.elapsed 는 스텝마다만 증가하므로 여기서 멈추면 양쪽이 같은 스텝 수를 돈다.
 *
 * 레벨업도 반드시 처리해야 한다. 예전엔 choose() 를 안 불러서 첫 레벨업(2초 이내)에
 * update() 가 조기 리턴했고, "400스텝"이라 믿었던 게 실제론 100스텝 + 공회전이었다.
 */
function run(seed: number, seconds: number, dt: number, moveX: number, moveY: number): string {
  const game = new Game()
  game.start(seed)
  const input = mockInput(moveX, moveY)
  let guard = 0
  while (game.elapsed < seconds) {
    if (guard++ > 200000) throw new Error('루프가 안 끝난다')
    if (game.phase === Phase.LevelUp) {
      // 선택 자체는 결정적이어야 하므로 항상 첫 번째를 고른다
      game.choose(game.pendingChoices[0]!)
      continue
    }
    if (game.phase === Phase.Dead || game.phase === Phase.Won) break
    game.update(input, dt)
  }
  return fingerprint(game)
}

describe('결정론', () => {
  it('같은 시드 + 같은 입력 = 같은 결과', () => {
    expect(run(1337, 8, 1 / 60, 0.6, -0.8)).toBe(run(1337, 8, 1 / 60, 0.6, -0.8))
  })

  it('다른 시드 = 다른 결과', () => {
    expect(run(1337, 5, 1 / 60, 1, 0)).not.toBe(run(9001, 5, 1 / 60, 1, 0))
  })

  it('멈춰 있어도 결정적이다', () => {
    expect(run(77, 4, 1 / 60, 0, 0)).toBe(run(77, 4, 1 / 60, 0, 0))
  })

  /**
   * 프레임률 교차 검증.
   *
   * **스텝 수로 멈춘다. 시간으로 멈추지 않는다.**
   *
   * update() 는 dt 크기만큼 스텝을 묶어 돌므로, 벽시계나 elapsed 로 멈추면 3스텝
   * 프레임이 목표를 최대 2스텝 넘어간다 — 그 2스텝이 적을 더 스폰하고 rng 를 더
   * 뽑아서 "결정론 파괴"처럼 보인다(실측: 적 423 vs 417). 그건 양자화지 버그가 아니다.
   *
   * 진짜 계약은 **같은 스텝 수를 돌면 같은 상태**이고, 협동 lockstep 도 스텝을 센다.
   * 여기서 rng 상태까지 비교하는 게 핵심이다 — 이게 같으면 난수를 정확히 같은
   * 횟수·같은 순서로 뽑았다는 뜻이고, 곧 스폰·크리·레벨업 선택지가 전부 같았다는 뜻이다.
   */
  const decisions = (game: Game): string =>
    [game.player.level, game.player.kills, game.foes.count, game.rng.state].join('|')

  function runSteps(seed: number, targetSteps: number, dt: number): { sig: string; steps: number } {
    const game = new Game()
    game.start(seed)
    const input = mockInput(0.6, -0.8)
    let guard = 0
    while (game.stepsDone < targetSteps) {
      if (guard++ > 400000) throw new Error('루프가 안 끝난다')
      if (game.phase === Phase.LevelUp) {
        game.choose(game.pendingChoices[0]!)
        continue
      }
      if (game.phase === Phase.Dead || game.phase === Phase.Won) break
      game.update(input, dt)
    }
    return { sig: decisions(game), steps: game.stepsDone }
  }

  /**
   * 거친 dt 를 먼저 돌리고, 기준(1스텝 프레임)을 **그 스텝 수에 맞춘다.**
   *
   * 3스텝 프레임은 레벨업 브레이크 때문에 정렬이 어긋나 목표를 최대 2 넘긴다.
   * 1스텝 프레임은 항상 정확히 착지하므로(스텝을 돌고 나서 break 하니 손실이 없다),
   * 거친 쪽을 먼저 재고 거기에 맞추면 **양쪽이 정확히 같은 스텝 수**를 돈다.
   */
  function crossCheck(seed: number, target: number, coarseDt: number): void {
    const coarse = runSteps(seed, target, coarseDt)
    const fine = runSteps(seed, coarse.steps, 1 / 60)
    expect(fine.steps, `기준이 ${coarse.steps} 스텝에 못 맞췄다`).toBe(coarse.steps)
    expect(coarse.sig).toBe(fine.sig)
  }

  it('프레임률이 결과를 바꾸지 않는다 (60fps == 30fps)', () => {
    // 실제로 있었던 버그: 고정 스텝 루프가 phase 변화를 안 봐서, 2스텝 프레임은
    // 서브스텝 1에서 레벨업이 떠도 서브스텝 2를 그대로 더 돌며 rng 를 더 먹었다.
    // → 같은 데일리 시드인데 30fps 와 144fps 에게 다른 선택지가 떴다.
    // 창이 좁으면 우연히 통과한다(레벨업이 하필 2스텝 프레임의 첫 서브스텝에서 떠야
    // 차이가 난다) — 레벨업이 수십 번 나오는 길이로 돌린다.
    crossCheck(1337, 2700, 2 / 60)
  })

  it('프레임률이 결과를 바꾸지 않는다 (60fps == 20fps)', () => {
    crossCheck(2026, 2700, 3 / 60)
  })

  it('프레임률이 결과를 바꾸지 않는다 (60fps == 12fps, 프레임 드랍)', () => {
    crossCheck(42, 2700, 5 / 60)
  })

  it('시뮬레이션이 실제로 진행된다 (테스트가 빈 상태를 비교하는 게 아님)', () => {
    const game = new Game()
    game.start(5)
    const input = mockInput(0.5, 0.5)
    // 600(10초)이던 것을 900(15초)으로 — 심장박동 양자화가 첫 발사를 최대 8분음
    // 미루면서 칼끝에 있던 이 시드의 첫 레벨업이 10초 밖으로 밀렸다.
    // 재는 건 "시뮬이 진짜 돈다"는 새니티지 초반 속도가 아니다 (그건 earlygame 몫).
    for (let i = 0; i < 900; i++) {
      if (game.phase === Phase.LevelUp) game.choose(game.pendingChoices[0]!)
      if (game.phase !== Phase.Playing) break
      game.update(input, 1 / 60)
    }
    expect(game.foes.count).toBeGreaterThan(10)
    expect(game.elapsed).toBeGreaterThan(8)
    // 레벨업이 실제로 처리됐는지 — 이게 0이면 위 run() 들이 앞 2초만 재고 있는 것이다
    expect(game.player.level).toBeGreaterThan(1)
  })
})

describe('Rng', () => {
  it('같은 시드면 같은 수열', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 200; i++) expect(a.next()).toBe(b.next())
  })

  it('[0,1) 범위를 벗어나지 않는다', () => {
    const r = new Rng(3)
    for (let i = 0; i < 5000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('시드 0도 죽지 않는다', () => {
    const r = new Rng(0)
    const vals = new Set<number>()
    for (let i = 0; i < 50; i++) vals.add(r.next())
    expect(vals.size).toBeGreaterThan(40)
  })

  it('weighted 가 가중치 0인 항목을 고르지 않는다', () => {
    const r = new Rng(9)
    for (let i = 0; i < 500; i++) {
      expect(r.weighted([0, 1, 0])).toBe(1)
    }
  })

  it('weighted 는 합이 0이면 -1', () => {
    expect(new Rng(1).weighted([0, 0])).toBe(-1)
  })

  it('데일리 시드는 UTC 날짜에만 의존한다', () => {
    const a = dailySeed(new Date('2026-07-16T00:00:01Z'))
    const b = dailySeed(new Date('2026-07-16T23:59:59Z'))
    const c = dailySeed(new Date('2026-07-17T00:00:01Z'))
    expect(a.seed).toBe(b.seed)
    expect(a.label).toBe('2026-07-16')
    expect(a.seed).not.toBe(c.seed)
  })

  it('hashSeed 는 충돌이 흔하지 않다', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(hashSeed(`seed-${i}`))
    expect(seen.size).toBeGreaterThan(1990)
  })
})

describe('XP 곡선', () => {
  it('단조 증가한다', () => {
    for (let l = 1; l < 120; l++) {
      expect(xpForLevel(l + 1), `Lv${l}→${l + 1}`).toBeGreaterThan(xpForLevel(l))
    }
  })

  it('지수적이다 — 다항식으로 네 번 실패했다', () => {
    // 다항식이면 후반 비율이 1에 수렴한다. 지수면 일정하게 유지된다.
    // 킬 수가 후반에 지수적으로 느는데 요구치가 다항이면 언젠가 따라잡혀서
    // 잘 굴러가는 빌드가 Lv 111 까지 갔다(실측).
    const early = xpForLevel(21) / xpForLevel(20)
    const late = xpForLevel(61) / xpForLevel(60)
    expect(late).toBeGreaterThan(1.08)
    expect(Math.abs(late - early)).toBeLessThan(0.05)
  })

  it('상한을 만든다 (XP 10배 = 레벨 +25 미만)', () => {
    const total = (lv: number): number => {
      let s = 0
      for (let l = 1; l <= lv; l++) s += xpForLevel(l)
      return s
    }
    const at = (xp: number): number => {
      let l = 1
      let acc = 0
      while (acc + xpForLevel(l) <= xp && l < 500) { acc += xpForLevel(l); l++ }
      return l
    }
    const base = total(40)
    const lv10x = at(base * 10)
    expect(lv10x - 40, `XP 10배면 Lv 40 → ${lv10x}`).toBeLessThan(25)
  })

  it('초반이 빠르다 (첫 레벨업이 늦으면 아무도 안 기다린다)', () => {
    expect(xpForLevel(1)).toBeLessThan(15)
    expect(xpForLevel(2)).toBeLessThan(20)
  })
})
