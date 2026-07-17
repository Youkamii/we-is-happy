/**
 * 보스전 공정성 회귀 테스트 — Game 통합 경로로 확인한다.
 *
 * boss.test.ts 는 Boss 를 단독으로 재서, 링 피해·XP 보상처럼 game.ts 에 사는
 * 로직의 회귀를 못 본다 — stamp 버그가 정확히 그 틈으로 빠져나갔었다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { BossState } from './boss'
import { Game, Phase } from './game'
import { xpForLevel } from './player'
import { Drop } from './pools'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

/** 수축장을 강제 발동시키고 2.6초를 돌린다. 잃은 체력을 반환. */
function collapseRun(moveX: number, moveY: number): number {
  const g = new Game()
  g.start(11)
  // 스폰을 끈다 — 링 피해만 계측한다 (잡졸 접촉 소음 제거)
  ;(g as unknown as { spawnTimer: number }).spawnTimer = -1e9
  g.spawnBoss()
  const b = g.boss
  expect(b.idx).toBeGreaterThanOrEqual(0)
  // 보스 몸은 멀리 치운다 — 접촉·돌진이 아니라 링만 재야 한다
  g.foes.x[b.idx] = 2200
  g.foes.y[b.idx] = 2200
  b.state = BossState.Collapse
  b.timer = 2.6
  b.ringX = g.player.x
  b.ringY = g.player.y
  b.ringR = 520
  const hp0 = g.player.hp
  const input = mockInput(moveX, moveY)
  for (let i = 0; i < Math.ceil(2.6 * 60) && g.phase === Phase.Playing; i++) {
    g.update(input, 1 / 60)
  }
  return hp0 - g.player.hp
}

describe('수축장 공정성', () => {
  it('즉시 도주하면 무피해다 — "이동만으로 피할 수 있다"는 계약', () => {
    // 링이 발밑(반경 520, 조임 210px/s)에서 시작하므로 밖까지 1.16초가 걸린다.
    // 유예(COLLAPSE_GRACE 1.5s)가 그보다 길어야 완벽한 반응 = 0 피해가 성립한다.
    // 유예 0이던 시절엔 이 값이 ~33(시작 체력의 18%)으로 **확정**이었다.
    expect(collapseRun(1, 0)).toBe(0)
  })

  it('서 있으면 확실히 아프다 — 유예가 처벌까지 없애면 안 된다', () => {
    expect(collapseRun(0, 0)).toBeGreaterThanOrEqual(30)
  })
})

describe('보스 처치 보상', () => {
  it('XP 총량이 한 레벨의 절반쯤이다 — 오브당/총량 착각(440%) 재발 방지', () => {
    const g = new Game()
    g.start(11)
    g.spawnBoss()
    const need = xpForLevel(g.player.level)
    g.damageFoe(g.boss.idx, 1e9, 1, 0)
    let total = 0
    for (let i = 0; i < g.drops.high; i++) {
      if (g.drops.alive[i] === 1 && g.drops.type[i] === Drop.Xp) total += g.drops.value[i]!
    }
    expect(total).toBeGreaterThan(need * 0.4)
    expect(total).toBeLessThan(need * 0.7)
  })
})
