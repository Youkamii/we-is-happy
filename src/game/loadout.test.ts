/**
 * 조합 시스템 회귀 테스트.
 *
 * "매판 다른 빌드"가 이 게임의 리플레이 전부라 여기가 조용히 깨지면
 * 게임이 그냥 심심해진다 — 크래시가 안 나서 눈치채기도 어렵다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Rng } from '../engine/rng'
import { Loadout, MAX_PASSIVES, MAX_WEAPONS } from './loadout'
import { Player } from './player'
import { EVO_PASSIVE_LEVEL, EVO_WEAPON_LEVEL, P, PASSIVES, W, WEAPONS } from './weapons'

describe('Loadout', () => {
  let lo: Loadout
  let player: Player

  beforeEach(() => {
    lo = new Loadout()
    player = new Player()
    lo.reset(W.Ember)
    lo.recomputeStats(player)
  })

  it('모든 무기의 진화 짝 패시브가 실재한다', () => {
    for (const def of WEAPONS) {
      expect(PASSIVES[def.evoPassive], `${def.name}`).toBeDefined()
    }
  })

  it('무기 6종의 진화 짝이 서로 겹치지 않는다 (한 패시브가 전부를 진화시키면 조합이 아니다)', () => {
    const pairs = WEAPONS.map((w) => w.evoPassive)
    expect(new Set(pairs).size).toBe(WEAPONS.length)
  })

  it('조건을 채우기 전에는 진화할 수 없다', () => {
    const slot = lo.weapons[0]!
    slot.level = EVO_WEAPON_LEVEL
    expect(lo.canEvolve(slot)).toBe(false) // 패시브가 없다
    lo.passives[P.Might] = EVO_PASSIVE_LEVEL - 1
    expect(lo.canEvolve(slot)).toBe(false) // 패시브가 모자라다
  })

  it('조건을 채우면 진화가 반드시 선택지에 뜬다', () => {
    const slot = lo.weapons[0]!
    slot.level = EVO_WEAPON_LEVEL
    lo.passives[P.Might] = EVO_PASSIVE_LEVEL
    expect(lo.canEvolve(slot)).toBe(true)
    // 어렵게 맞춘 조합이 확률에 묻히면 안 된다 — 20번 굴려도 매번 떠야 한다
    for (let i = 0; i < 20; i++) {
      const choices = lo.roll(new Rng(i + 1))
      expect(choices.some((c) => c.kind === 'evolve')).toBe(true)
    }
  })

  it('진화하면 다시 진화하지 않는다', () => {
    const slot = lo.weapons[0]!
    slot.level = EVO_WEAPON_LEVEL
    lo.passives[P.Might] = EVO_PASSIVE_LEVEL
    const evo = lo.roll(new Rng(1)).find((c) => c.kind === 'evolve')!
    lo.apply(evo, player)
    expect(slot.evolved).toBe(true)
    expect(lo.canEvolve(slot)).toBe(false)
    expect(lo.roll(new Rng(1)).some((c) => c.kind === 'evolve')).toBe(false)
  })

  it('패시브 스탯이 누적되지 않는다 (매번 base 에서 다시 쌓는다)', () => {
    lo.passives[P.Might] = 3
    lo.recomputeStats(player)
    const once = player.stats.damage
    lo.recomputeStats(player)
    lo.recomputeStats(player)
    expect(player.stats.damage).toBe(once)
  })

  it('수호를 찍으면 최대 체력이 오르고 현재 체력 비율이 유지된다', () => {
    player.hp = player.stats.maxHp * 0.5
    const before = player.stats.maxHp
    lo.passives[P.Ward] = 2
    lo.recomputeStats(player)
    expect(player.stats.maxHp).toBeGreaterThan(before)
    expect(player.hp / player.stats.maxHp).toBeCloseTo(0.5, 5)
  })

  it('무기 슬롯이 상한을 넘지 않는다', () => {
    const rng = new Rng(7)
    for (let i = 0; i < 200; i++) {
      const choices = lo.roll(rng)
      const w = choices.find((c) => c.kind === 'weapon')
      if (w) lo.apply(w, player)
    }
    expect(lo.weapons.length).toBeLessThanOrEqual(MAX_WEAPONS)
  })

  it('패시브 종류가 상한을 넘지 않는다', () => {
    const rng = new Rng(11)
    for (let i = 0; i < 300; i++) {
      const choices = lo.roll(rng)
      const p = choices.find((c) => c.kind === 'passive')
      if (p) lo.apply(p, player)
    }
    expect(lo.passives.filter((l) => l > 0).length).toBeLessThanOrEqual(MAX_PASSIVES)
  })

  it('만렙이지만 진화가 남았으면 진화를 준다', () => {
    for (const slot of lo.weapons) slot.level = WEAPONS[slot.def]!.maxLevel
    for (let i = 0; i < PASSIVES.length; i++) lo.passives[i] = PASSIVES[i]!.maxLevel
    // 만렙(8)은 진화 요구치(5)를 이미 넘으므로 진화가 남아 있다
    expect(lo.roll(new Rng(3)).some((c) => c.kind === 'evolve')).toBe(true)
  })

  it('전부 만렙 + 진화까지 끝나면 회복을 준다 (빈 화면은 버그처럼 보인다)', () => {
    for (const def of WEAPONS) {
      if (!lo.findWeapon(def.id) && lo.weapons.length < MAX_WEAPONS) {
        lo.apply({ kind: 'weapon', index: def.id, title: '', desc: '', level: 1, r: 0, g: 0, b: 0, hint: '' }, player)
      }
    }
    for (const slot of lo.weapons) {
      slot.level = WEAPONS[slot.def]!.maxLevel
      slot.evolved = true
    }
    for (let i = 0; i < PASSIVES.length; i++) lo.passives[i] = PASSIVES[i]!.maxLevel

    const choices = lo.roll(new Rng(3))
    expect(choices.length).toBe(3)
    expect(choices.every((c) => c.kind === 'heal')).toBe(true)
  })

  it('선택지에 같은 항목이 중복으로 뜨지 않는다', () => {
    const rng = new Rng(21)
    for (let i = 0; i < 60; i++) {
      const choices = lo.roll(rng)
      const keys = choices.map((c) => `${c.kind}:${c.index}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('짝 패시브를 들고 있으면 힌트가 붙는다', () => {
    lo.passives[P.Might] = 1
    const choices = lo.roll(new Rng(5), 3)
    const ember = choices.find((c) => c.kind === 'weapon' && c.index === W.Ember)
    // 불씨가 선택지에 있으면 완력과 맞물린다는 힌트가 있어야 한다
    if (ember) expect(ember.hint).toContain('완력')
  })
})
