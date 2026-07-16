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
  return [
    n,
    game.player.kills,
    Math.round(game.player.hp * 100),
    Math.round(sx),
    Math.round(sy),
  ].join('|')
}

/**
 * 시뮬레이션 시간 `seconds` 만큼을 프레임 `dt` 로 나눠 돌린다.
 *
 * 레벨업을 반드시 처리해야 한다. 예전엔 choose() 를 안 불러서 첫 레벨업(2초 이내)에
 * update() 가 조기 리턴했고, "400스텝"이라 믿었던 게 실제론 100스텝 + 공회전이었다.
 * 즉 이 테스트는 런의 앞 2초만 검사하고 있었다.
 */
function run(seed: number, seconds: number, dt: number, moveX: number, moveY: number): string {
  const game = new Game()
  game.start(seed)
  const input = mockInput(moveX, moveY)
  const frames = Math.round(seconds / dt)
  for (let i = 0; i < frames; i++) {
    if (game.phase === Phase.LevelUp) {
      // 선택 자체는 결정적이어야 하므로 항상 첫 번째를 고른다
      game.choose(game.pendingChoices[0]!)
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

  it('프레임률이 결과를 바꾸지 않는다 (60fps == 30fps)', () => {
    // 실제로 있었던 버그: 고정 스텝 루프가 phase 변화를 안 봐서, 2스텝 프레임은
    // 서브스텝 1에서 레벨업이 떠도 서브스텝 2를 그대로 더 돌며 rng 를 더 먹었다.
    // → 같은 데일리 시드인데 30fps 와 144fps 에게 다른 선택지가 떴다.
    // 이 테스트가 없어서 못 잡았다 — 예전 테스트는 dt=1/60 만 돌려 멀티스텝 경로를
    // 단 한 줄도 실행하지 않았다.
    // 창이 좁으면 우연히 통과한다. 차이가 나려면 레벨업이 하필 2스텝 프레임의
    // 첫 서브스텝에서 떠야 하므로, 레벨업이 여러 번 나오는 길이로 돌린다.
    expect(run(1337, 45, 2 / 60, 0.6, -0.8)).toBe(run(1337, 45, 1 / 60, 0.6, -0.8))
  })

  it('프레임률이 결과를 바꾸지 않는다 (60fps == 20fps)', () => {
    expect(run(2026, 45, 3 / 60, -0.3, 0.9)).toBe(run(2026, 45, 1 / 60, -0.3, 0.9))
  })

  it('시뮬레이션이 실제로 진행된다 (테스트가 빈 상태를 비교하는 게 아님)', () => {
    const game = new Game()
    game.start(5)
    const input = mockInput(0.5, 0.5)
    for (let i = 0; i < 600; i++) {
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
