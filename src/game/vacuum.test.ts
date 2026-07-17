/**
 * 성흔(진공) 회귀 테스트 — 먹으면 맵의 모든 경험치가 날아온다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Game, Phase } from './game'
import { Drop } from './pools'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

describe('성흔(진공)', () => {
  it('먹으면 맵의 모든 XP 가 빨려오고, 결국 전부 흡수된다', () => {
    const g = new Game()
    g.start(21)
    // 스폰을 꺼 소음을 없앤다 — 흡수 경로만 잰다
    ;(g as unknown as { spawnTimer: number }).spawnTimer = -1e9
    // 맵 곳곳(자석 95px 밖, 최대 ~1800px)에 XP 를 뿌린다
    const N = 40
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2
      const d = 400 + (k % 8) * 180
      expect(g.drops.spawn(Math.cos(a) * d, Math.sin(a) * d, 0, 0, 1, Drop.Xp)).toBeGreaterThanOrEqual(0)
    }
    // 성흔을 플레이어 발밑에 놓는다 → 다음 스텝에 즉시 획득
    expect(g.drops.spawn(g.player.x, g.player.y, 0, 0, 0, Drop.Vacuum)).toBeGreaterThanOrEqual(0)

    const input = mockInput(0, 0)
    g.update(input, 1 / 60)
    // 발동 직후: 살아 있는 모든 XP 가 성흔 견인(pulled=2) 상태다
    for (let i = 0; i < g.drops.high; i++) {
      if (g.drops.alive[i] === 1 && g.drops.type[i] === Drop.Xp) {
        expect(g.drops.pulled[i], `drop ${i}`).toBe(2)
      }
    }

    // 십수 초 안에 전부 도착해 흡수된다 (견인 부스트가 없으면 수십 초가 걸린다)
    let guard = 0
    while (g.player.xp === 0 || countXp(g) > 0) {
      if (guard++ > 15 * 60) break
      if (g.phase === Phase.LevelUp) {
        g.choose(g.pendingChoices[0]!)
        continue
      }
      g.update(input, 1 / 60)
    }
    expect(countXp(g), '남은 XP 구슬').toBe(0)
    // 레벨업 처리로 xp 가 소비될 수 있으니 "총 획득"은 레벨로 확인한다 (40 XP → Lv4+)
    expect(g.player.level).toBeGreaterThan(1)
  })

  it('성흔 자체는 수명으로 증발하지 않는다', () => {
    const g = new Game()
    g.start(22)
    ;(g as unknown as { spawnTimer: number }).spawnTimer = -1e9
    const i = g.drops.spawn(800, 0, 0, 0, 0, Drop.Vacuum)
    expect(i).toBeGreaterThanOrEqual(0)
    g.drops.age[i] = 999 // DROP_LIFE(26s)를 한참 넘긴 나이
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.drops.alive[i]).toBe(1)
  })
})

function countXp(g: Game): number {
  let n = 0
  for (let i = 0; i < g.drops.high; i++) {
    if (g.drops.alive[i] === 1 && g.drops.type[i] === Drop.Xp) n++
  }
  return n
}
