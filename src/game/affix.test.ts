/**
 * 엘리트 어픽스 회귀 테스트 — 군중 속 단기 목표("저놈부터")의 규칙들.
 */
import { describe, expect, it } from 'vitest'
import { Affix, FOE_STATS } from './foes'
import { Game } from './game'
import { Drop, Foe } from './pools'

function fresh(): Game {
  const g = new Game()
  g.start(51)
  g.player.stats.critChance = 0 // 치명타 난수가 피해 검증을 흐리면 안 된다
  return g
}

describe('엘리트 어픽스', () => {
  it('수정(Prism)은 받는 피해가 40% 줄어든다', () => {
    const g = fresh()
    const hp = FOE_STATS[Foe.Hex]!.hp * 100
    const plain = g.foes.spawn(500, 0, Foe.Hex, hp, 0.5)
    const prism = g.foes.spawn(-500, 0, Foe.Hex, hp, 0.5)
    g.foes.affix[prism] = Affix.Prism
    g.damageFoe(plain, 100, 1, 0)
    g.damageFoe(prism, 100, 1, 0)
    expect(g.foes.hp[plain]).toBeCloseTo(hp - 100, 3)
    expect(g.foes.hp[prism]).toBeCloseTo(hp - 60, 3)
  })

  it('분열(Brood)은 죽으며 Mote 를 낳고, 어픽스 처치는 확정 회복을 남긴다', () => {
    const g = fresh()
    const j = g.foes.spawn(400, 0, Foe.Hex, 1, 0.5)
    g.foes.affix[j] = Affix.Brood
    const before = g.foes.count
    g.damageFoe(j, 1e9, 1, 0)
    // Hex 하나가 죽고 Mote 여섯이 태어났다
    expect(g.foes.count).toBe(before - 1 + 6)
    let heals = 0
    for (let i = 0; i < g.drops.high; i++) {
      if (g.drops.alive[i] === 1 && g.drops.type[i] === Drop.Heal) heals++
    }
    expect(heals, '확정 회복 드랍').toBeGreaterThanOrEqual(1)
  })

  it('장벽(Bulwark)은 넉백에 밀리지 않는다', () => {
    const g = fresh()
    const hp = FOE_STATS[Foe.Hex]!.hp * 100
    const plain = g.foes.spawn(500, 0, Foe.Hex, hp, 0.5)
    const wall = g.foes.spawn(-500, 0, Foe.Hex, hp, 0.5)
    g.foes.affix[wall] = Affix.Bulwark
    g.damageFoe(plain, 10, 1, 0)
    g.damageFoe(wall, 10, 1, 0)
    expect(Math.abs(g.foes.pushX[plain]!)).toBeGreaterThan(0)
    expect(g.foes.pushX[wall]).toBe(0)
  })
})
