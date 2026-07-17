/**
 * 막의 계약 회귀 테스트 — 막 전환이 배너가 아니라 결정이 되는지.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { PACTS } from './acts'
import { Game, Phase } from './game'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

describe('막의 계약', () => {
  it('2막으로 넘어가는 순간 계약 3택이 뜬다 (서로 다른 셋)', () => {
    const g = new Game()
    g.start(41)
    const input = mockInput(0, 0)
    let pactAt = -1
    let kinds: string[] = []
    let ids: number[] = []
    let guard = 0
    while (pactAt < 0 && guard++ < 200 * 60) {
      if (g.phase === Phase.LevelUp) {
        if (g.pendingChoices[0]!.kind === 'pact') {
          pactAt = g.elapsed
          kinds = g.pendingChoices.map((c) => c.kind)
          ids = g.pendingChoices.map((c) => c.index)
          break
        }
        g.choose(g.pendingChoices[0]!)
        continue
      }
      if (g.phase !== Phase.Playing) break
      // 관찰자 불사 — 여기서 재는 건 생존이 아니라 계약 제시다
      g.player.hp = g.player.stats.maxHp
      g.update(input, 1 / 60)
    }
    expect(pactAt, '계약 제시 시각').toBeGreaterThanOrEqual(179)
    expect(pactAt).toBeLessThanOrEqual(183)
    expect(kinds).toEqual(['pact', 'pact', 'pact'])
    expect(new Set(ids).size, '계약 셋이 서로 달라야 한다').toBe(3)
  })

  it('계약이 실제로 스탯을 바꾼다 (유리심장: 피해 +40%, 체력 -25%)', () => {
    const g = new Game()
    g.start(42)
    const dmg0 = g.player.stats.damage
    const hp0 = g.player.stats.maxHp
    g.choose({
      kind: 'pact', index: 1, title: PACTS[1]!.name, desc: '', level: 0,
      r: 0, g: 0, b: 0, hint: '',
    })
    expect(g.player.stats.damage).toBeCloseTo(dmg0 * 1.4, 5)
    expect(g.player.stats.maxHp).toBe(Math.round(hp0 * 0.75))
    // 레벨업 재계산에도 살아남아야 한다
    g.loadout.recomputeStats(g.player)
    expect(g.player.stats.damage).toBeCloseTo(dmg0 * 1.4, 5)
  })

  it('다시 뽑기는 막마다 1회다', () => {
    const g = new Game()
    g.start(43)
    g.phase = Phase.LevelUp
    g.pendingChoices = g.loadout.roll(g.rng, 3, 0)
    expect(g.rerollLeft).toBe(1)
    g.reroll()
    expect(g.rerollLeft).toBe(0)
    expect(g.pendingChoices.length).toBe(3)
    const after = g.pendingChoices
    g.reroll() // 소진 — 아무 일도 안 일어나야 한다
    expect(g.pendingChoices).toBe(after)
    expect(g.rerollLeft).toBe(0)
  })
})
