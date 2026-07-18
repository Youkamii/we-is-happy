/**
 * 포식 페이스 실측 하네스 — 몸 크기별 × 대상별 소요 시간 행렬.
 * 수치를 보고 싶으면 out 문자열을 fs 로 덤프하도록 잠시 고쳐 쓴다
 * (vitest 는 통과 테스트의 콘솔을 숨긴다 — 메모리 diag 패턴 참조).
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Voyage, volFor } from './voyage'
import { nameOf } from './starnames'

function eatTime(targetName: string, myR: number): number {
  const g = new Voyage()
  g.start(null)
  g.vol = volFor(myR)
  const t = g.active.find((b) => nameOf(b.id)?.name === targetName)
  if (!t) return -1
  const id = t.id
  const input = { move: { x: 0, y: 0 }, lift: 0 } as unknown as Input
  for (let s = 0; s < 60 * 300; s++) {
    // 표면에 붙어 공성 — 대상이 움직이므로 매 틱 따라붙는다
    g.x = t.x + (g.radius + t.r) * 0.995
    g.y = t.y
    g.z = t.z
    g.vx = 0
    g.vy = 0
    g.vz = 0
    g.update(input, 1 / 60)
    if (!g.active.some((b) => b.id === id)) return (s + 1) / 60
  }
  return 999
}

describe('페이스 행렬 — 포식 시간의 단조성 계약', () => {
  it('큰 것일수록 오래 걸리고, 내가 클수록 빨라진다 (역전 금지)', () => {
    // 실측 (2026-07-18, 파괴 5400·소화 5%/s 분리 후):
    //   R1.8 → 지구 9.1 / 토성 16.2 / 목성 17.6 / 태양 51.7s (티끌에게 태양은 요새)
    //   R7   → 지구 1.2 / 태양 10.6s (행성 몇 개 먹은 몸의 공성전)
    //   R30  → 태양 3.2s · R60 → 1.7s. 역전이 생기면 여기서 잡힌다.
    let out = 'R\\대상   지구      목성      토성      태양\n'
    const sunAt: Record<number, number> = {}
    for (const myR of [1.8, 7, 15, 30]) {
      const earth = eatTime('지구', myR)
      const jup = eatTime('목성', myR)
      const sat = eatTime('토성', myR)
      const sun = eatTime('태양', myR)
      sunAt[myR] = sun
      out += `R${myR}:  ${[earth, jup, sat, sun].map((v) => `${v.toFixed(1)}s`.padStart(8)).join(' ')}\n`
      // 미세 초 단위 비교는 무의미 — 의미 있는 간격의 단조만 잠근다
      expect(earth, `R${myR}: 지구 ≤ 목성권`).toBeLessThan(jup + 0.5)
      expect(jup, `R${myR}: 목성 << 태양`).toBeLessThan(sun)
      expect(sat, `R${myR}: 토성 << 태양`).toBeLessThan(sun)
    }
    // 태양은 작을 땐 요새, 크면 순식간 — 성장의 서사
    expect(sunAt[1.8]!, '티끌에게 태양은 요새(30초+, 실측 51.7s)').toBeGreaterThan(30)
    expect(sunAt[7]!, '행성을 먹은 몸에게도 공성전(실측 10.6s)').toBeGreaterThan(8)
    expect(sunAt[30]!, '커지면 태양이 빨라진다 (실측 3.2s)').toBeLessThan(sunAt[7]! * 0.75)
    expect(out.length).toBeGreaterThan(0)
  })

  it('질량 지배 — 태양 여러 개를 삼킨 몸에게 태양은 찰나다 (현실 크기 반영)', () => {
    // R60 = 부피로 태양 ~8개. 실물리: 대상의 몇 배 질량이면 에딩턴은 방벽이
    // 아니라 별이 통째로 조석 붕괴한다 ("토성만하면 전부 찰나": 실플레이).
    expect(eatTime('태양', 60), 'R60 태양은 수 초 안에 무너진다').toBeLessThan(4)
  })
})
