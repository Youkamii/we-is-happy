/**
 * 항행·충돌·지구 시작 계약 — 2026-07-19 실플레이 3판정의 회귀 방지.
 * ㉒ 지정 항로 무상한 로그 항행 — 100광년을 시뮬 30초 안에 주파한다
 *    ("1광년에 몇십 초": 종전 계측 광년당 40초 → 수리 후 전 구간 십수 초)
 * ㉓ 천체 충돌 — 겹친 두 천체는 큰 쪽이 삼킨다 (질량 85% 보존, 작은 쪽 퇴장)
 * ㉔ 지구 시작 — 나는 지구 질량·지구 자리에서 눈뜨고, 지도의 지구는 없다
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { LY } from './starmap'
import { nameOf } from './starnames'
import { BodyKind, Voyage, volFor } from './voyage'

function mockInput(x: number, y: number, lift = 0): Input {
  return { move: { x, y }, lift } as unknown as Input
}

describe('항행·충돌·지구 시작', () => {
  it('㉒ 지정 항로 — 100광년을 시뮬 30초 안에 주파한다', () => {
    const g = new Voyage()
    g.start(null)
    ;(g as unknown as { vol: number }).vol = volFor(30) // R 30 — 여행자 체급
    g.navAssist = true
    g.navOn = true
    g.navX = g.x + LY * 100
    g.navY = g.y
    g.navZ = g.z
    const input = mockInput(1, 0)
    let arrived = -1
    for (let s = 0; s < 1800; s++) {
      g.update(input, 1 / 60)
      if (Math.hypot(g.navX - g.x, g.navY - g.y) < LY) {
        arrived = s
        break
      }
    }
    expect(arrived).toBeGreaterThanOrEqual(0)
    expect(arrived / 60).toBeLessThan(30)
  })

  it('㉓ 천체 충돌 — 겹친 두 천체는 큰 쪽이 삼킨다 (질량 85% 보존)', () => {
    const g = new Voyage()
    g.start(null)
    const rocks = g.active.filter(
      (b) => b.kind === BodyKind.Rock && b.origin === undefined && b.r >= 2,
    )
    expect(rocks.length).toBeGreaterThanOrEqual(2)
    const a = rocks[0]!
    const c = rocks[1]!
    // 내 무대(base·40) 안, 내 입 밖에 겹쳐 놓는다 — 레일에서 떼어 고정
    a.free = true
    c.free = true
    a.x = g.x + 3000
    a.y = g.y
    a.z = g.z
    c.x = a.x + 0.5
    c.y = a.y
    c.z = a.z
    a.vx = a.vy = a.vz = 0
    c.vx = c.vy = c.vz = 0
    const big = Math.max(a.r, c.r)
    const small = Math.min(a.r, c.r)
    const wantR = Math.cbrt(big * big * big + small * small * small * 0.85)
    g.update(mockInput(0, 0), 1 / 60)
    const survivors = [a, c].filter((b) => g.active.includes(b))
    expect(survivors.length).toBe(1)
    expect(survivors[0]!.r).toBeCloseTo(wantR, 1)
  })

  it('㉔ 지구 시작 — 실험 버튼 전엔 평범한 지구, 버튼 후 40초에 완전한 블랙홀', () => {
    const g = new Voyage()
    g.start(null)
    expect(g.morph).toBe(0)
    expect(g.radius).toBeGreaterThan(14)
    expect(g.radius).toBeLessThan(18)
    const ghost = g.active.find((b) => nameOf(b.id)?.name === '지구')
    expect(ghost).toBeUndefined()
    // 버튼을 안 누르면 영원히 지구다 — 시간이 흘러도 morph 0
    for (let s = 0; s < 200; s++) g.update(mockInput(0, 0), 0.05)
    expect(g.morph).toBe(0)
    g.startExperiment()
    for (let s = 0; s < 810; s++) g.update(mockInput(0, 0), 0.05)
    expect(g.morph).toBe(1)
  })
})
