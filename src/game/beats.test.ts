/**
 * 압박 비트 회귀 테스트 — "루즈함" 방지 장치가 실제로 작동하는지.
 * 균일 스폰만으론 몇 분이면 자동사냥 구경이 된다(실플레이 보고) — 비트가 그 해독제다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Game, Phase } from './game'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

describe('압박 비트', () => {
  it('35초 언저리에 첫 비트가 실제로 밀려온다', () => {
    const g = new Game()
    g.start(31)
    // 배경 스폰을 꺼 비트 진형만 잰다
    ;(g as unknown as { spawnTimer: number }).spawnTimer = -1e9
    const input = mockInput(0, 0)
    let fired = -1
    let guard = 0
    while (fired < 0 && guard++ < 45 * 60) {
      if (g.phase === Phase.LevelUp) {
        g.choose(g.pendingChoices[0]!)
        continue
      }
      if (g.phase !== Phase.Playing) break
      g.update(input, 1 / 60)
      if (g.beatIntro > 0) fired = g.elapsed
    }
    expect(fired, '비트 발동 시각').toBeGreaterThanOrEqual(34.9)
    expect(fired).toBeLessThanOrEqual(36)
    expect(g.beatName).not.toBe('')
    // 1막 비트는 조류(55) 아니면 사냥대(11) — 진형이 통째로 스폰돼야 한다
    expect(g.foes.count, '비트 진형 스폰 수').toBeGreaterThanOrEqual(11)
  })

  it('보스가 살아 있는 동안엔 비트가 안 온다 (고비 둘을 포개지 않는다)', () => {
    const g = new Game()
    g.start(32)
    ;(g as unknown as { spawnTimer: number }).spawnTimer = -1e9
    g.spawnBoss()
    const j = g.boss.idx
    expect(j).toBeGreaterThanOrEqual(0)
    const input = mockInput(0, 0)
    let guard = 0
    while (g.elapsed < 44 && guard++ < 60 * 60) {
      if (g.phase === Phase.LevelUp) {
        g.choose(g.pendingChoices[0]!)
        continue
      }
      if (g.phase !== Phase.Playing) break
      // 보스를 멀리 고정하고 플레이어를 만피로 유지한다 — 보스 패턴(돌진·수축)에
      // 죽어서 44초 전에 루프가 끝나면 이 테스트는 아무것도 재지 않은 것이 된다
      g.foes.x[j] = 2300
      g.foes.y[j] = 2300
      g.player.hp = g.player.stats.maxHp
      g.update(input, 1 / 60)
    }
    expect(g.elapsed).toBeGreaterThanOrEqual(44)
    expect(g.beatName, '보스 생존 중 비트가 발동했다').toBe('')
  })
})
