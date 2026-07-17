/**
 * 초반 경험 회귀 테스트 — "시작 무기 복권" 방지.
 *
 * 접촉 피해가 진짜가 된 뒤(R5) 시작 무기 10종 중 5종(광선·신문·호·위성·혜성)이
 * 봇 계측에서 22~40초에 죽었다 — 무기를 뽑는 순간 판의 생사가 갈리는 복권이었다.
 * 세 가지로 풀었다: 피격 반동(문 것들을 한 뼘 밀어냄), 광선 주기 1.9→1.35,
 * 호 부채꼴 ±86°→±115°. 이 테스트는 그 계약을 잠근다:
 *
 *  1) 어떤 시작 무기든 봇이 90초를 산다 (사람은 봇보다 못하므로 이건 하한이 아니라
 *     "무기 간 격차가 즉사 수준은 아니다"의 증명이다)
 *  2) 어떤 시작 무기든 첫 레벨업이 15초 안에 온다 — 튜토리얼이 없는 게임이라
 *     첫 레벨업 화면이 곧 첫 수업이고, 그게 늦으면 아무도 기다리지 않는다
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Rng } from '../engine/rng'
import { Bot } from './bot'
import { Game, Phase } from './game'
import { STARTER_WEAPONS, WEAPONS } from './weapons'

/**
 * 각 시작 무기가 자연히 걸리는 시드. start() 의 **첫** rng 사용이 시작 무기 선택이라
 * 전체 부팅 없이 재현할 수 있다 — 이 가정이 깨지면 아래 def 대조가 즉시 잡는다.
 */
function seedsPerStarter(): Map<number, number> {
  const map = new Map<number, number>()
  for (let s = 1; s <= 4000 && map.size < STARTER_WEAPONS.length; s++) {
    const w = STARTER_WEAPONS[new Rng(s).int(STARTER_WEAPONS.length)]!
    if (!map.has(w)) map.set(w, s)
  }
  return map
}

describe('시작 무기 복권 방지 (봇 90초 × 10종)', () => {
  const seeds = seedsPerStarter()

  it('모든 시작 무기를 시드로 찾았다', () => {
    expect(seeds.size).toBe(STARTER_WEAPONS.length)
  })

  for (const [weapon, seed] of seedsPerStarter()) {
    it(`${WEAPONS[weapon]!.name} (seed ${seed}) — 90초 생존 + 첫 레벨업 15초 이내`, () => {
      const g = new Game()
      g.start(seed)
      expect(g.loadout.weapons[0]!.def, '시드→시작무기 대응이 틀어졌다').toBe(weapon)
      const bot = new Bot()
      const rng = new Rng(seed ^ 0x9e3779b9)
      const input = { move: bot.move } as unknown as Input
      const dt = 1 / 60
      let firstLevel = -1
      for (let i = 0; i < 90 * 60 + 3000; i++) {
        if (g.phase === Phase.LevelUp) {
          if (firstLevel < 0) firstLevel = g.elapsed
          g.choose(g.pendingChoices[rng.int(g.pendingChoices.length)]!)
          continue
        }
        if (g.phase !== Phase.Playing) break
        bot.think(g, dt)
        g.update(input, dt)
        if (g.elapsed > 90) break
      }
      expect(g.phase, `${g.elapsed.toFixed(1)}s 에 죽었다`).not.toBe(Phase.Dead)
      expect(firstLevel, '첫 레벨업이 아예 없었다').toBeGreaterThan(0)
      expect(firstLevel, '첫 수업이 너무 늦다').toBeLessThanOrEqual(15)
    })
  }
})
