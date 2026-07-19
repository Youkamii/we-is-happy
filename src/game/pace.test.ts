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
  // 실험 완료 시점에서 잰다 — 실플레이의 공성은 전부 붕괴 완료 후(×1000 기저)다
  g.expOn = true
  g.expT = 43
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
    // 지구는 지도에 없다(내가 지구다) — 소형 표적은 금성이 잇는다.
    // R1.8 행은 유물 — 시작이 지구 질량(R≈15.6)이라 티끌 체급은 실존하지 않는다.
    let out = 'R\\대상   금성      목성      토성      태양\n'
    const sunAt: Record<number, number> = {}
    for (const myR of [7, 15, 30]) {
      const ven = eatTime('금성', myR)
      const jup = eatTime('목성', myR)
      const sat = eatTime('토성', myR)
      const sun = eatTime('태양', myR)
      sunAt[myR] = sun
      out += `R${myR}:  ${[ven, jup, sat, sun].map((v) => `${v.toFixed(1)}s`.padStart(8)).join(' ')}\n`
      // 미세 초 단위 비교는 무의미 — 의미 있는 간격의 단조만 잠근다.
      // 소형 표적(금성·목성)은 ×1000 기저에서 전부 1~2초로 압축 — 절대차가
      // 아니라 "터무니없는 역전"만 막는다 (조석 박리가 자기 질량 % 라 생기는 눌림)
      expect(ven, `R${myR}: 금성이 목성보다 터무니없이 오래 걸리면 안 된다`)
        .toBeLessThan(jup * 2 + 1)
      expect(jup, `R${myR}: 목성 << 태양`).toBeLessThan(sun)
      expect(sat, `R${myR}: 토성 << 태양`).toBeLessThan(sun)
    }
    // 태양은 작을 땐 공성전, 크면 순식간 — 성장의 서사.
    // ×1000 기저 실측 (2026-07-19): R7 태양 4.4s / R15 4.0s / R30 3.4s.
    // 즉시 증발(1초 미만)만 막고, 몸이 클수록 빨라지는 단조를 잠근다.
    expect(sunAt[7]!, '작은 몸에게 태양은 공성전(실측 4.4s)').toBeGreaterThan(2.5)
    expect(sunAt[30]!, '커지면 태양이 빨라진다').toBeLessThan(sunAt[7]! * 0.85)
    expect(out.length).toBeGreaterThan(0)
  }, 30000) // 행렬 16셀 × 최대 300초 시뮬 — 기본 5초로는 빠듯하다

  it('질량 지배 — 태양 여러 개를 삼킨 몸에게 태양은 찰나다 (현실 크기 반영)', () => {
    // R60 = 부피로 태양 ~8개. 실물리: 대상의 몇 배 질량이면 에딩턴은 방벽이
    // 아니라 별이 통째로 조석 붕괴한다 ("토성만하면 전부 찰나": 실플레이).
    expect(eatTime('태양', 60), 'R60 태양은 수 초 안에 무너진다').toBeLessThan(4)
  })
})
