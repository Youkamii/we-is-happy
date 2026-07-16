/**
 * 막 구조 회귀 테스트.
 *
 * 15분 런의 뼈대라 여기가 어긋나면 게임이 통째로 늘어지거나 뭉개진다.
 */
import { describe, expect, it } from 'vitest'
import { ACTS, ACT_SECONDS, BOSS_AT, RUN_SECONDS, actIndexAt, actProgressAt } from './acts'
import { FOE_STATS } from './foes'

describe('막 구조', () => {
  it('15분이다', () => {
    expect(RUN_SECONDS).toBe(900)
    expect(ACTS.length).toBe(5)
    expect(ACT_SECONDS).toBe(180)
  })

  it('막 인덱스가 시간에 맞게 나온다', () => {
    expect(actIndexAt(0)).toBe(0)
    expect(actIndexAt(179)).toBe(0)
    expect(actIndexAt(180)).toBe(1)
    expect(actIndexAt(899)).toBe(4)
    // 끝을 넘어도 마지막 막에 머문다 (배열 밖 인덱스는 즉시 크래시다)
    expect(actIndexAt(RUN_SECONDS)).toBe(4)
    expect(actIndexAt(99999)).toBe(4)
  })

  it('막 진행도가 0..1 을 벗어나지 않는다', () => {
    for (let t = 0; t < RUN_SECONDS + 60; t += 7) {
      const p = actProgressAt(t)
      expect(p, `t=${t}`).toBeGreaterThanOrEqual(0)
      expect(p, `t=${t}`).toBeLessThan(1)
    }
  })

  it('보스 시점이 막 안에 있고 정리할 여유가 남는다', () => {
    expect(BOSS_AT).toBeGreaterThan(0)
    expect(BOSS_AT).toBeLessThan(ACT_SECONDS)
    // 보스 잡고 숨 돌릴 시간
    expect(ACT_SECONDS - BOSS_AT).toBeGreaterThanOrEqual(15)
  })

  it('난이도가 막마다 단조 증가한다 (뒤로 갈수록 쉬워지면 곡선이 아니다)', () => {
    for (let i = 1; i < ACTS.length; i++) {
      expect(ACTS[i]!.rate, `${i}막 rate`).toBeGreaterThan(ACTS[i - 1]!.rate)
      expect(ACTS[i]!.hp, `${i}막 hp`).toBeGreaterThan(ACTS[i - 1]!.hp)
    }
  })

  it('막마다 등장 종족이 다르다 (같은 그림이 15분이면 실패다)', () => {
    const sigs = ACTS.map((a) => a.weights.map((w) => w.type).sort().join(','))
    expect(new Set(sigs).size).toBe(ACTS.length)
  })

  it('가중치가 유효하다', () => {
    for (const a of ACTS) {
      expect(a.weights.length, a.name).toBeGreaterThan(0)
      let total = 0
      for (const w of a.weights) {
        expect(w.w, `${a.name}/${w.type}`).toBeGreaterThan(0)
        expect(FOE_STATS[w.type], `${a.name}/${w.type}`).toBeDefined()
        total += w.w
      }
      expect(total, a.name).toBeGreaterThan(0)
      // 같은 종족이 두 번 들어가면 가중치 의도가 흐려진다
      const types = a.weights.map((w) => w.type)
      expect(new Set(types).size, a.name).toBe(types.length)
    }
  })

  it('보스 종족이 실재한다', () => {
    for (const a of ACTS) expect(FOE_STATS[a.boss], a.name).toBeDefined()
  })

  it('막 이름·부제가 비어 있지 않다 (배너가 빈 화면이 된다)', () => {
    for (const a of ACTS) {
      expect(a.name.length, 'name').toBeGreaterThan(0)
      expect(a.sub.length, 'sub').toBeGreaterThan(0)
    }
    const names = ACTS.map((a) => a.name)
    expect(new Set(names).size).toBe(ACTS.length)
  })

  it('성운 색이 막마다 다르다 (배경이 안 변하면 15분이 한 장면이다)', () => {
    const tints = ACTS.map((a) => a.tintA.join(',') + '|' + a.tintB.join(','))
    expect(new Set(tints).size).toBe(ACTS.length)
  })
})
