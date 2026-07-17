/**
 * 강착원반 회귀 테스트 — "게임성 자체를 다르게"의 계약들.
 *
 * ① 조류: 원반 대역은 흐른다 — 서 있어도 궤도에 실려 간다
 * ② 경제 반전: 같은 킬이라도 원반이 외곽보다 값지다 (강하할 이유)
 * ③ 파편 광맥: 원반 대역에 XP 무리가 응결된다 (캐러 갈 이유)
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { diskBandAt } from './acts'
import { Game, Phase } from './game'
import { Drop, Foe } from './pools'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

describe('강착원반', () => {
  it('조류가 원반 대역에서 나를 접선으로 실어 나른다', () => {
    const g = new Game()
    g.start(21)
    g.terrain.hp.fill(0) // 벽이 측정을 오염시키면 안 된다 — 조류만 잰다
    const hr = g.holeR()
    g.player.x = hr * 2.2 // 대역 중심(조류 최대), 각도 0
    g.player.y = 0
    const input = mockInput(0, 0)
    for (let s = 0; s < 60; s++) {
      g.player.hp = g.player.stats.maxHp // 관찰자 불사 — 재는 건 흐름이다
      if (g.phase !== Phase.Playing) break
      g.update(input, 1 / 60)
    }
    // 반시계 접선: (r, 0) 에서의 흐름은 +y. 1초에 유속(170)의 절반은 가야 흐름이다.
    expect(g.player.y, '접선으로 실려 갔다').toBeGreaterThan(70)
    const r1 = Math.hypot(g.player.x, g.player.y)
    expect(Math.abs(r1 - hr * 2.2), '궤도는 대체로 유지된다').toBeLessThan(hr * 0.5)
  })

  it('같은 킬이라도 원반이 외곽보다 값지다 (경제 반전)', () => {
    const g = new Game()
    g.start(22)
    g.act = 1 // 1막은 튜토리얼 램프(외곽 0.85)라 풀 반전(0.55)은 2막부터 잰다
    const hr = g.holeR()
    const xpValues = (): number[] => {
      const out: number[] = []
      for (let i = 0; i < g.drops.high; i++) {
        if (g.drops.alive[i] === 1 && g.drops.type[i] === Drop.Xp) out.push(g.drops.value[i]!)
      }
      return out
    }
    const before = xpValues().length
    const inner = g.foes.spawn(hr * 2.2, 0, Foe.Mote, 1, 0.5)
    g.damageFoe(inner, 1e9, 1, 0)
    const v1 = xpValues()[before]!
    const outer = g.foes.spawn(2100, 0, Foe.Mote, 1, 0.5)
    g.damageFoe(outer, 1e9, 1, 0)
    const v2 = xpValues()[before + 1]!
    // 대역 중심 1.6배 vs 외곽 0.55배 = 약 2.9배
    expect(v1 / v2).toBeGreaterThan(2.5)
    expect(v1 / v2).toBeLessThan(3.3)
  })

  it('파편 광맥이 원반 대역에 응결된다', () => {
    const g = new Game()
    g.start(23)
    const input = mockInput(0, 0)
    const bandXp = (): number => {
      const hr = g.holeR()
      let n = 0
      for (let i = 0; i < g.drops.high; i++) {
        if (g.drops.alive[i] !== 1 || g.drops.type[i] !== Drop.Xp) continue
        if (diskBandAt(Math.hypot(g.drops.x[i]!, g.drops.y[i]!), hr) > 0) n++
      }
      return n
    }
    let prev = 0
    let condensedAt = -1
    let guard = 0
    while (g.elapsed < 64 && guard++ < 70 * 60 + 3000) {
      if (g.phase === Phase.LevelUp) {
        g.choose(g.pendingChoices[0]!)
        continue
      }
      if (g.phase !== Phase.Playing) break
      g.player.hp = g.player.stats.maxHp
      g.update(input, 1 / 60)
      const now = bandXp()
      // 한 스텝에 10개가 무리로 나타나면 그게 응결이다 (킬 드랍은 낱개로 온다)
      if (condensedAt < 0 && now - prev >= 10) condensedAt = g.elapsed
      prev = now
    }
    expect(condensedAt, '광맥 응결 시각').toBeGreaterThanOrEqual(49)
    expect(condensedAt).toBeLessThanOrEqual(62)
  })
})
