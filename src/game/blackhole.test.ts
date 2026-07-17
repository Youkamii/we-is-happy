/**
 * 블랙홀 회귀 테스트 — 사건의 지평선이 지키는 계약들.
 *
 * ① 삼켜진 적은 보상이 없다 (킬 카운트·XP 둘 다) — 아니면 최적 플레이가
 *    "다 밀어 넣기"가 된다.
 * ② 주인 없는 XP 는 중심으로 흐르고, 지평선을 넘으면 사라진다.
 * ③ 플레이어는 지평선 안에서도 **항상 탈출할 수 있다** — 떨어지면 죽는 게 아니라
 *    비싸야 한다. 대신 머무르면 물린다.
 * ④ 스폰은 지평선 안에 놓이지 않는다 (태어나자마자 삼켜지는 낭비 금지).
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Game, Phase } from './game'
import { Drop, Foe } from './pools'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

function countXp(g: Game): number {
  let n = 0
  for (let i = 0; i < g.drops.high; i++) {
    if (g.drops.alive[i] === 1 && g.drops.type[i] === Drop.Xp) n++
  }
  return n
}

describe('블랙홀', () => {
  it('지평선을 넘은 적은 보상 없이 소멸한다', () => {
    const g = new Game()
    g.start(11)
    const hr = g.holeR()
    const kills0 = g.player.kills
    const xp0 = countXp(g)
    const i = g.foes.spawn(hr * 0.5, 0, Foe.Mote, 1e9, 0.5)
    expect(i).toBeGreaterThanOrEqual(0)
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.foes.alive[i], '삼켜져 사라졌다').toBe(0)
    expect(g.player.kills, '킬로 치지 않는다').toBe(kills0)
    expect(countXp(g), 'XP 를 떨구지 않는다').toBe(xp0)
  })

  it('주인 없는 XP 는 중심으로 흐르고, 지평선 안에서는 사라진다', () => {
    const g = new Game()
    g.start(12)
    const hr = g.holeR()
    // 지평선 안 — 즉시 삼켜진다
    const inside = g.drops.spawn(hr * 0.5, 0, 0, 0, 5, Drop.Xp)
    // 밖 — 나선을 그리며 안으로 표류한다 (자석 밖 거리).
    // 1막은 막 램프로 흐름이 가장 약하니, 중력이 충분한 안쪽 궤도에서 잰다.
    const outside = g.drops.spawn(hr * 1.6, 0, 0, 0, 5, Drop.Xp)
    const d0 = Math.hypot(g.drops.x[outside]!, g.drops.y[outside]!)
    for (let s = 0; s < 90; s++) {
      // 레벨업 브레이크에 걸리면 시뮬이 멈춰 표류를 못 잰다 (양자화로 킬 타이밍이
      // 옮겨지자 이 시드에서 실제로 걸렸다) — 자동으로 고르고 계속 간다.
      if (g.phase === Phase.LevelUp) {
        g.choose(g.pendingChoices[0]!)
        continue
      }
      g.update(mockInput(0, 0), 1 / 60)
    }
    expect(g.drops.alive[inside], '지평선 안 XP 는 삼켜졌다').toBe(0)
    expect(g.drops.alive[outside], '밖의 XP 는 아직 산다').toBe(1)
    const d1 = Math.hypot(g.drops.x[outside]!, g.drops.y[outside]!)
    expect(d1, '중심으로 표류했다').toBeLessThan(d0 - 4)
  })

  it('플레이어는 지평선 안에서도 탈출할 수 있다 — 대신 물린다', () => {
    const g = new Game()
    g.start(13)
    const hr = g.holeR()
    g.player.x = 0
    g.player.y = hr * 0.55 // 깊숙이
    const hp0 = g.player.hp
    // 바깥(+y) 방향으로 전력 질주
    const input = mockInput(0, 1)
    let steps = 0
    while (Math.hypot(g.player.x, g.player.y) < hr && steps < 60 * 5) {
      g.update(input, 1 / 60)
      steps++
    }
    expect(steps, '5초 안에 탈출한다').toBeLessThan(60 * 5)
    expect(g.player.alive, '탈출 비용이 죽음이면 안 된다').toBe(true)
    expect(g.player.hp, '공짜도 아니다 — 물렸다').toBeLessThan(hp0)
  })

  it('스폰은 지평선 안에 놓이지 않는다', () => {
    const g = new Game()
    g.start(14)
    // 플레이어를 지평선 곁에 세워 스폰 링이 중심을 덮게 한다
    g.player.x = 0
    g.player.y = g.holeR() + 160
    g.benchSpawn(600)
    const hr = g.holeR()
    let inHole = 0
    for (let i = 0; i < g.foes.high; i++) {
      if (g.foes.alive[i] === 0) continue
      if (Math.hypot(g.foes.x[i]!, g.foes.y[i]!) < hr) inHole++
    }
    expect(inHole, '지평선 안 스폰 0').toBe(0)
  })
})
