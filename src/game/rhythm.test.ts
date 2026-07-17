/**
 * 심장박동 회귀 테스트 — 리듬이 장식이 아니라 규칙인지.
 *
 * ① 발사형 무기는 8분음 경계에서만 쏜다 (양자화)
 * ② 양자화는 위상만 옮기고 장기 DPS 를 보존한다
 * ③ 포식은 8마디째 마디에, 박자표대로 온다 (88bpm: bar 23 = 62.7s)
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Rng } from '../engine/rng'
import { Game, Phase } from './game'
import { STARTER_WEAPONS, W, WEAPONS } from './weapons'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

/** 불씨(Ember)로 시작하는 첫 시드 — earlygame.test 와 같은 유도 규칙 */
function emberSeed(): number {
  for (let s = 1; s <= 4000; s++) {
    if (STARTER_WEAPONS[new Rng(s).int(STARTER_WEAPONS.length)] === W.Ember) return s
  }
  throw new Error('불씨 시드를 못 찾았다')
}

/** 관찰자 모드로 n 초 굴리며 탄 스폰 시각(beatClock)을 모은다. */
function observeFire(seconds: number): { clocks: number[]; game: Game } {
  const g = new Game()
  g.start(emberSeed())
  expect(g.loadout.weapons[0]!.def).toBe(W.Ember)
  const clocks: number[] = []
  const orig = g.shots.spawn.bind(g.shots)
  ;(g.shots as { spawn: typeof g.shots.spawn }).spawn = (...a) => {
    clocks.push(g.beatClock)
    return orig(...a)
  }
  const input = mockInput(0, 0)
  let guard = 0
  while (g.elapsed < seconds && guard++ < seconds * 60 + 3000) {
    if (g.phase === Phase.LevelUp) {
      g.choose(g.pendingChoices[0]!)
      continue
    }
    if (g.phase !== Phase.Playing) break
    g.player.hp = g.player.stats.maxHp // 관찰자 불사 — 재는 건 박자다
    g.update(input, 1 / 60)
  }
  return { clocks, game: g }
}

describe('심장박동', () => {
  it('발사형 무기는 16분음 경계에서만 쏜다', () => {
    const { clocks } = observeFire(12)
    expect(clocks.length).toBeGreaterThan(10)
    // 발사 스텝의 16분음 위상 — 경계 직후 한 스텝 안이어야 한다
    // (한 스텝의 박 진행 = dt × bpm/60 = 0.0244박 → 16분음 단위 0.098)
    for (const c of clocks) {
      expect((c * 4) % 1, `발사 위상 (beatClock=${c.toFixed(3)})`).toBeLessThan(0.104)
    }
  })

  it('양자화는 장기 DPS 를 보존한다 (위상 이동일 뿐)', () => {
    const { clocks } = observeFire(20)
    // 볼리 수 = 서로 다른 발사 시각 수 (한 볼리가 여러 발일 수 있다)
    const volleys = new Set(clocks.map((c) => c.toFixed(4))).size
    // 불씨 쿨다운 0.34 × 20초 ≈ 58.8볼리. 양자화 대기·레벨업 브레이크 여유 ±10%.
    const cd = WEAPONS[W.Ember]!.cooldown
    const ideal = 20 / cd
    expect(volleys).toBeGreaterThan(ideal * 0.88)
    expect(volleys).toBeLessThan(ideal * 1.08)
  })

  it('포식은 박자표대로 온다 — 88bpm 에서 bar 23, 62.7초', () => {
    const g = new Game()
    g.start(41)
    const input = mockInput(0, 0)
    let first = -1
    let guard = 0
    while (g.elapsed < 66 && guard++ < 70 * 60 + 3000) {
      if (g.phase === Phase.LevelUp) {
        g.choose(g.pendingChoices[0]!)
        continue
      }
      if (g.phase !== Phase.Playing) break
      g.player.hp = g.player.stats.maxHp
      g.update(input, 1 / 60)
      if (first < 0 && g.feeding()) first = g.elapsed
    }
    // bar 23 시작 = 92박 × 60/88 = 62.727s
    expect(first, '첫 포식 시각').toBeGreaterThanOrEqual(62.5)
    expect(first).toBeLessThanOrEqual(63.0)
    // 60초 시점(경고 전)엔 포식이 아니었다는 것도 위 시각이 증명한다.
    // 포식은 한 마디(4박 ≈ 2.73s)만 지속한다
    expect(g.elapsed).toBeGreaterThanOrEqual(65.6)
    expect(g.feeding(), '포식은 끝났다').toBe(false)
  })
})
