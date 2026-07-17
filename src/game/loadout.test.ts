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
import {
  EVO_PASSIVE_LEVEL, EVO_WEAPON_LEVEL, P, PASSIVES, STARTER_WEAPONS, W, WEAPONS,
} from './weapons'

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

  it('진화 짝이 서로 겹치지 않는다 (한 패시브가 전부를 진화시키면 조합이 아니다)', () => {
    const pairs = WEAPONS.map((w) => w.evoPassive)
    expect(new Set(pairs).size).toBe(WEAPONS.length)
  })

  it('무기 12종 · 패시브 12종이 다 있다', () => {
    expect(WEAPONS.length).toBe(12)
    expect(PASSIVES.length).toBe(12)
  })

  it('무기/패시브 id 가 배열 인덱스와 일치한다 (테이블 조회가 id 로 이뤄진다)', () => {
    WEAPONS.forEach((w, i) => expect(w.id, w.name).toBe(i))
    PASSIVES.forEach((p, i) => expect(p.id, p.name).toBe(i))
  })

  it('이름이 중복되지 않는다 (선택지에서 뭐가 뭔지 구분이 안 된다)', () => {
    const names = [...WEAPONS.map((w) => w.name), ...WEAPONS.map((w) => w.evoName)]
    expect(new Set(names).size).toBe(names.length)
    const pNames = PASSIVES.map((p) => p.name)
    expect(new Set(pNames).size).toBe(pNames.length)
  })

  it('시작 무기는 스스로 적을 죽일 수 있어야 한다', () => {
    // 실제로 있었던 일: 반향(Echo)으로 시작하면 영원히 0킬이다 — 반향은 **내가 죽인
    // 자리**에서만 발동하는데 죽일 수단이 없다. 실측 12초에 HP 21, 킬 0.
    // 정지(Still)도 피해가 0이라 같은 문제.
    expect(STARTER_WEAPONS).not.toContain(W.Echo)
    expect(STARTER_WEAPONS).not.toContain(W.Still)
    // 나머지는 전부 출발점이 될 수 있어야 한다 (시작 빌드 다양성)
    expect(STARTER_WEAPONS.length).toBe(WEAPONS.length - 2)
    expect(new Set(STARTER_WEAPONS).size).toBe(STARTER_WEAPONS.length)
    for (const id of STARTER_WEAPONS) expect(WEAPONS[id]).toBeDefined()
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

  it('무기가 하나뿐이면 새 무기가 반드시 선택지에 뜬다 (두 번째 무기는 생존의 하한)', () => {
    // 실제로 있었던 일: 시너지 가중치(7배)가 첫 레벨업부터 짝 패시브만 계속 띄워서,
    // 짝만 쫓다 무기 1개 Lv6 으로 1막 25초에 죽는 판이 나왔다 (봇 계측 seed 8888).
    for (let i = 0; i < 40; i++) {
      const choices = lo.roll(new Rng(i + 100))
      expect(
        choices.some((c) => c.kind === 'weapon' && c.level === 1),
        `${i}번째 굴림`,
      ).toBe(true)
    }
  })
})
