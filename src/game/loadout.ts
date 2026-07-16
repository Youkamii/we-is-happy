/**
 * 보유 장비와 레벨업 선택지.
 *
 * 설계 원칙 하나: 플레이어가 시너지를 **발견하게** 만든다. 조합을 숨겨 놓고
 * 위키를 찾게 하면 그건 리플레이가 아니라 숙제다. 그래서 짝이 맞아 들어가면
 * 선택지에 힌트가 뜨고, 조건을 채우면 진화가 선택지로 올라온다.
 */
import type { Rng } from '../engine/rng'
import { baseStats, type Player } from './player'
import {
  EVO_PASSIVE_LEVEL, EVO_WEAPON_LEVEL, PASSIVES, WEAPONS, WeaponSlot,
} from './weapons'

export const MAX_WEAPONS = 5
export const MAX_PASSIVES = 5

export type ChoiceKind = 'weapon' | 'passive' | 'evolve' | 'heal'

export interface Choice {
  kind: ChoiceKind
  /** weapon/passive 인덱스 (heal 은 -1) */
  index: number
  title: string
  desc: string
  /** 적용 후 레벨. 신규면 1. */
  level: number
  r: number
  g: number
  b: number
  /** "○○와 맞물린다" 같은 시너지 힌트. 없으면 빈 문자열. */
  hint: string
}

export class Loadout {
  readonly weapons: WeaponSlot[] = []
  /** 인덱스 = 패시브 id, 값 = 레벨 (0 = 미보유) */
  readonly passives: number[] = new Array(PASSIVES.length).fill(0)

  reset(startingWeapon: number): void {
    this.weapons.length = 0
    this.passives.fill(0)
    this.weapons.push(new WeaponSlot(startingWeapon))
  }

  findWeapon(def: number): WeaponSlot | undefined {
    return this.weapons.find((w) => w.def === def)
  }

  /**
   * 스탯 전체 재계산. 패시브는 곱연산이라 증분 적용하면 되돌릴 수가 없다 —
   * 매번 처음부터 다시 쌓는 게 유일하게 안전한 방법이다.
   */
  recomputeStats(player: Player): void {
    const hpRatio = player.stats.maxHp > 0 ? player.hp / player.stats.maxHp : 1
    player.stats = baseStats()
    for (let i = 0; i < PASSIVES.length; i++) {
      const lv = this.passives[i]!
      if (lv > 0) PASSIVES[i]!.apply(player, lv)
    }
    // 최대 체력이 오르면 비율을 유지한다 (수호를 찍었는데 체력이 안 늘면 함정이다)
    player.hp = Math.min(player.stats.maxHp, player.stats.maxHp * hpRatio)
  }

  /** 이 무기가 지금 진화 가능한가 */
  canEvolve(slot: WeaponSlot): boolean {
    if (slot.evolved) return false
    const def = WEAPONS[slot.def]!
    return slot.level >= EVO_WEAPON_LEVEL && this.passives[def.evoPassive]! >= EVO_PASSIVE_LEVEL
  }

  /** 아직 진화 못 했지만 짝이 보이는 상태인지 — 힌트 문구용 */
  private evoHint(slot: WeaponSlot): string {
    if (slot.evolved) return ''
    const def = WEAPONS[slot.def]!
    const pLv = this.passives[def.evoPassive]!
    if (pLv === 0) return ''
    const pName = PASSIVES[def.evoPassive]!.name
    const needW = Math.max(0, EVO_WEAPON_LEVEL - slot.level)
    const needP = Math.max(0, EVO_PASSIVE_LEVEL - pLv)
    if (needW === 0 && needP === 0) return `${pName}와 맞물린다 — 진화 준비 완료`
    const parts: string[] = []
    if (needW > 0) parts.push(`${def.name} +${needW}`)
    if (needP > 0) parts.push(`${pName} +${needP}`)
    return `${pName}와 맞물린다 (${parts.join(', ')})`
  }

  /** 이 패시브를 올리면 어떤 무기가 진화에 가까워지는지 */
  private passiveHint(passiveId: number, nextLevel: number): string {
    for (const slot of this.weapons) {
      if (slot.evolved) continue
      const def = WEAPONS[slot.def]!
      if (def.evoPassive !== passiveId) continue
      const needW = Math.max(0, EVO_WEAPON_LEVEL - slot.level)
      const needP = Math.max(0, EVO_PASSIVE_LEVEL - nextLevel)
      if (needW === 0 && needP === 0) return `${def.name}이(가) 진화한다`
      const parts: string[] = []
      if (needW > 0) parts.push(`${def.name} +${needW}`)
      if (needP > 0) parts.push(`이것 +${needP}`)
      return `${def.name}와 맞물린다 (${parts.join(', ')})`
    }
    return ''
  }

  /**
   * 레벨업 선택지 뽑기.
   * 진화가 가능하면 반드시 하나는 진화를 띄운다 — 어렵게 맞춘 조합이
   * 확률에 묻혀 안 나오면 그건 그냥 화나는 일이다.
   */
  roll(rng: Rng, count = 3): Choice[] {
    const out: Choice[] = []

    for (const slot of this.weapons) {
      if (!this.canEvolve(slot)) continue
      const def = WEAPONS[slot.def]!
      out.push({
        kind: 'evolve', index: slot.def,
        title: `${def.evoName}`,
        desc: def.evoDesc,
        level: slot.level,
        r: def.r * 1.25 + 0.4, g: def.g * 0.9, b: def.b * 0.8,
        hint: `${def.name} 진화`,
      })
      break // 한 번에 하나씩만
    }

    const pool: Choice[] = []

    // 보유 무기 레벨업
    for (const slot of this.weapons) {
      const def = WEAPONS[slot.def]!
      if (slot.level >= def.maxLevel) continue
      pool.push({
        kind: 'weapon', index: slot.def,
        title: slot.evolved ? def.evoName : def.name,
        desc: slot.evolved ? def.evoDesc : def.desc,
        level: slot.level + 1,
        r: def.r, g: def.g, b: def.b,
        hint: this.evoHint(slot),
      })
    }

    // 새 무기
    if (this.weapons.length < MAX_WEAPONS) {
      for (const def of WEAPONS) {
        if (this.findWeapon(def.id)) continue
        pool.push({
          kind: 'weapon', index: def.id,
          title: def.name, desc: def.desc, level: 1,
          r: def.r, g: def.g, b: def.b,
          hint: '새 무기',
        })
      }
    }

    // 패시브
    const ownedPassives = this.passives.filter((l) => l > 0).length
    for (const def of PASSIVES) {
      const lv = this.passives[def.id]!
      if (lv >= def.maxLevel) continue
      if (lv === 0 && ownedPassives >= MAX_PASSIVES) continue
      pool.push({
        kind: 'passive', index: def.id,
        title: def.name, desc: def.desc, level: lv + 1,
        r: 1.6, g: 1.7, b: 2.0,
        hint: this.passiveHint(def.id, lv + 1),
      })
    }

    // 시너지에 걸린 선택지를 더 자주 띄운다. 조합이 안 굴러가면 매판 똑같아진다.
    const weights = pool.map((c) => (c.hint && c.hint !== '새 무기' ? 3.4 : 1))
    while (out.length < count && pool.length > 0) {
      const pick = rng.weighted(weights)
      if (pick < 0) break
      out.push(pool[pick]!)
      pool.splice(pick, 1)
      weights.splice(pick, 1)
    }

    // 전부 만렙이면 회복이라도 준다 (선택지가 빈 화면은 버그처럼 보인다)
    while (out.length < count) {
      out.push({
        kind: 'heal', index: -1,
        title: '숨 고르기', desc: '체력 30 회복',
        level: 0, r: 0.5, g: 2.6, b: 1.2, hint: '',
      })
    }
    return out
  }

  /** 선택 적용. 스탯 재계산까지 여기서 끝낸다. */
  apply(choice: Choice, player: Player): void {
    switch (choice.kind) {
      case 'evolve': {
        const slot = this.findWeapon(choice.index)
        if (slot) {
          slot.evolved = true
          slot.level = Math.max(slot.level, EVO_WEAPON_LEVEL)
        }
        break
      }
      case 'weapon': {
        const slot = this.findWeapon(choice.index)
        if (slot) slot.level++
        else if (this.weapons.length < MAX_WEAPONS) this.weapons.push(new WeaponSlot(choice.index))
        break
      }
      case 'passive': {
        this.passives[choice.index]!++
        this.recomputeStats(player)
        break
      }
      case 'heal': {
        player.heal(30)
        break
      }
    }
  }
}
