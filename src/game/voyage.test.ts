/**
 * 검은 입 v3 코어 계약 — "삼키면 커지고, 커지면 어제 못 삼키던 것을 삼킨다".
 *
 * ① 우주는 결정론이다 (실지도 + 시드 채움 — 같은 자리엔 같은 천체)
 * ② 작은 것은 삼켜지고, 나는 커지고, 명부에 남는다
 * ③ 나보다 큰 것은 못 삼킨다
 * ④ 항해는 판마다 새로, 명부만 평생 (회차)
 * ⑤ 문턱을 넘으면 칭호가 온다
 * ⑥ 요람은 굶기지 않는다
 * ⑦ 위성은 궤도를 돈다 (케플러 레일, 3D 경사)
 * ⑧ 내가 지나가면 위성이 레일에서 뜯긴다 (섭동·Hills)
 * ⑨ 로슈 조석 파괴 — 가스 스트림으로 흘러들고, 심이 남는다
 * ⑩ 먹은 것의 운동량이 내 것이 된다
 * ⑪ 탐욕 봇도 굶지 않는다 (성장 페이스)
 * ⑫ 작은 몸의 조석 파괴는 연쇄 폭발하지 않는다
 * ⑬ 우주는 실재다 — 태양계에서 시작, 프록시마는 프록시마 자리에, 남쪽엔 궁수자리 A*
 * ⑭ 커져도 세계는 보인다 (시야 비례 로드)
 * ⑮ z축은 실재한다 — 떠오르고, 가라앉고, 다른 층의 먹이는 안 잡힌다
 * ⑯ 오르트 구름은 실재한다 — 태양계의 끝은 얼음의 껍질이다
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { SHELL, STAR_MAP } from './starmap'
import { nameOf } from './starnames'
import { BodyKind, Voyage, rankOf, volFor, type Body, type Store } from './voyage'

function mockInput(x: number, y: number, lift = 0): Input {
  return { move: { x, y }, lift } as unknown as Input
}

function memStore(): Store & { raw: string | null } {
  const s = { raw: null as string | null }
  return {
    get raw() {
      return s.raw
    },
    load: () => s.raw,
    save: (v: string) => {
      s.raw = v
    },
  }
}

/** 먹이 위에 올라타서 삼킨다 — 레일 위 천체는 움직이므로 매 틱 붙는다 (z 포함) */
function chase(g: Voyage, prey: Body, frames: number): void {
  const input = mockInput(0, 0)
  for (let s = 0; s < frames; s++) {
    g.x = prey.x
    g.y = prey.y
    g.z = prey.z
    g.vx = 0
    g.vy = 0
    g.vz = 0
    g.update(input, 1 / 60)
  }
}

describe('검은 입', () => {
  it('① 우주는 결정론이다 — 같은 자리엔 같은 천체', () => {
    const a = new Voyage()
    const b = new Voyage()
    a.start(null)
    b.start(null)
    const sig = (v: Voyage): string =>
      v.active.map((x) => `${x.id}:${x.kind}:${Math.round(x.x)}:${Math.round(x.r)}`).join('|')
    expect(sig(a)).toBe(sig(b))
    expect(a.active.length).toBeGreaterThan(10)
  })

  it('② 작은 것은 삼켜지고, 나는 커지고, 명부에 남는다', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = volFor(21) // R = 21 — 천왕성·해왕성이 먹이가 되는 크기
    const R = g.radius
    const prey = g.active.find(
      (b) => b.r < R * 0.7 && b.r > 2 && (b.kind !== BodyKind.Dust || b.r >= 10),
    )
    expect(prey, '태양계에 이름 있는 먹이가 있다').toBeTruthy()
    const vol0 = g.vol
    chase(g, prey!, 90)
    expect(g.vol, '부피가 붙었다').toBeGreaterThan(vol0)
    expect(g.eatenThisRun, '삼킨 수가 센다').toBeGreaterThan(0)
    expect(g.journal.length, '명부에 남았다').toBeGreaterThan(0)
  })

  it('③ 나보다 큰 것은 한입에 못 삼킨다 — 대신 곁에서 뜯는다', () => {
    const g = new Voyage()
    g.start(null)
    const big = g.active.find((b) => b.r > g.radius * 2)
    expect(big, '큰 천체가 있다 (태양)').toBeTruthy()
    const input = mockInput(0, 0)
    g.x = big!.x + big!.r * 1.05
    g.y = big!.y
    g.z = big!.z
    g.update(input, 1 / 60)
    // 한입 삼킴은 없다 — 첫 틱에 통째로 사라지지 않는다
    expect(g.active.some((b) => b.id === big!.id), '첫 틱에 통째로는 안 삼켜진다').toBe(true)
    const r0 = big!.r
    for (let s = 0; s < 20; s++) {
      g.x = big!.x + big!.r * 1.05
      g.y = big!.y
      g.z = big!.z
      g.update(input, 1 / 60)
    }
    // 대신 곁에 있으면 뜯긴다 (원거리 조석 박리 — 시그너스 X-1)
    expect(big!.r, '곁에 있으면 뜯긴다').toBeLessThan(r0)
  })

  it('④ 항해는 판마다 새로 시작하고, 명부만 평생 남는다', () => {
    const store = memStore()
    const g = new Voyage()
    g.start(store)
    g.vol = volFor(21)
    const prey = g.active.find(
      (b) => b.r < g.radius * 0.7 && b.r > 2 && (b.kind !== BodyKind.Dust || b.r >= 10),
    )!
    chase(g, prey, 120)
    expect(g.journal.length).toBeGreaterThan(0)
    const eatenName = g.journal[0]!.name

    const g2 = new Voyage()
    g2.start(store)
    expect(Math.round(g2.radius), '크기는 리셋된다 — 항해는 언제나 티끌에서').toBe(7)
    expect(g2.journal.some((e) => e.name === eatenName), '명부는 이어진다').toBe(true)
    expect(g2.voyages, '항해 횟수가 센다').toBe(2)
    expect(g2.active.some((b) => b.id === prey.id), '우주는 아문다').toBe(true)
  })

  it('⑤ 문턱을 넘으면 칭호가 온다', () => {
    const g = new Voyage()
    g.start(null)
    expect(rankOf(g.radius)).toBe('티끌')
    g.vol = volFor(13) // R = 13 — '검은 입' 문턱(12) 위
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.rankUp, '등급 이벤트가 발행됐다').toBe('검은 입')
  })

  it('⑥ 요람은 굶기지 않는다 — 시작 반경 안에 첫 끼니가 있다', () => {
    const g = new Voyage()
    g.start(null)
    const R = g.radius
    const near = g.active.filter(
      (b) => b.r < R * 0.8 && Math.hypot(b.x - g.x, b.y - g.y) < 1600,
    )
    expect(near.length, '1600px 안 먹이 수').toBeGreaterThanOrEqual(4)
  })

  it('⑦ 위성은 궤도를 돈다 — 케플러 레일 (3D)', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = 1 // 관찰자 — 아무도 못 끌고 아무것도 못 삼킨다
    // 빠른 위성을 고른다 — 명왕성은 한 바퀴에 248년이라 3초 관측으론 억울하다
    const moon = g.active.find(
      (b) => b.host !== null && b.orbR > 0 && b.ecc === 0 && Math.abs(b.orbW) > 0.1,
    )
    expect(moon, '궤도 위성이 있다').toBeTruthy()
    const host = moon!.host!
    const a0 = moon!.orbA
    const input = mockInput(0, 0)
    for (let s = 0; s < 180; s++) g.update(input, 1 / 60)
    const d = Math.hypot(moon!.x - host.x, moon!.y - host.y, moon!.z - host.z)
    expect(Math.abs(d - moon!.orbR), '3D 궤도 반지름 유지').toBeLessThan(moon!.orbR * 0.03)
    expect(Math.abs(moon!.orbA - a0), '공전했다').toBeGreaterThan(0.15)
  })

  it('⑧ 내가 지나가면 위성이 레일에서 뜯긴다 — 섭동과 방출', () => {
    const g = new Voyage()
    g.start(null)
    const moon = g.active.find(
      (b) => b.host !== null && b.orbR > 0 && b.ecc === 0 && b.kind === BodyKind.Dust,
    )
    expect(moon, '달이 있다').toBeTruthy()
    const host = moon!.host!
    g.vol = volFor(host.r * 2)
    const input = mockInput(0, 0)
    for (let s = 0; s < 30; s++) {
      g.x = moon!.x + g.radius * 1.9
      g.y = moon!.y
      g.z = moon!.z
      g.vx = 0
      g.vy = 0
      g.vz = 0
      g.update(input, 1 / 60)
      if (moon!.free) break
    }
    expect(moon!.free, '레일에서 뜯겼다').toBe(true)
  })

  it('⑨ 로슈 조석 파괴 — 가스로 흘러들고, 심이 남는다', () => {
    const g = new Voyage()
    g.start(null)
    const target = g.active.find((b) => b.r > 10 && b.r < 60)
    expect(target, '대상 천체가 있다 (천왕성쯤)').toBeTruthy()
    const R = target!.r / 0.9
    g.vol = volFor(R)
    g.x = target!.x + (R + target!.r) * 1.1
    g.y = target!.y
    g.z = target!.z
    g.vx = 0
    g.vy = 0
    g.vz = 0
    const id = target!.id
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.active.some((b) => b.id === id), '원본은 사라졌다').toBe(false)
    const cores = g.active.filter((b) => b.hot)
    expect(cores.length, '심이 남았다').toBeGreaterThanOrEqual(1)
    for (const c of cores) {
      expect(c.r, '심은 전부 먹이 크기다').toBeLessThan(g.radius * 0.8)
    }
    // 가스 스트림 — 가만히 있어도 찢은 질량이 흘러들어와 부피가 붙는다 (구름의 수확)
    const vol0 = g.vol
    const input = mockInput(0, 0)
    for (let s = 0; s < 120; s++) g.update(input, 1 / 60)
    expect(g.vol, '스트림이 흘러들었다').toBeGreaterThan(vol0)
  })

  it('⑩ 먹은 것의 운동량이 내 것이 된다', () => {
    const run = (pvx: number): number => {
      const g = new Voyage()
      g.start(null)
      g.vol = volFor(21)
      const prey = g.active.find((b) => b.r < g.radius * 0.7 && b.r > 3)!
      prey.free = true
      prey.host = null
      prey.orbR = 0
      prey.vx = pvx
      prey.vy = 0
      prey.vz = 0
      const input = mockInput(0, 0)
      for (let s = 0; s < 70; s++) {
        g.x = prey.x
        g.y = prey.y
        g.z = prey.z
        g.update(input, 1 / 60)
      }
      return g.vx
    }
    const fwd = run(900)
    const back = run(-900)
    // 질량비가 압축으로 무거워져 전달량은 작다 — 방향만 확실하면 보존은 증명된다
    expect(fwd - back, '먹이 속도 방향으로 밀렸다').toBeGreaterThan(0.25)
  })

  it('⑫ 작은 몸의 조석 파괴는 연쇄 폭발하지 않는다', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = volFor(2.47)
    const R = g.radius
    const victim = g.active[0]!
    const planted = {
      ...victim,
      id: 987654321,
      r: 2.2,
      x: g.x + (R + 2.2) * 1.1,
      y: g.y,
      z: g.z,
      host: null,
      orbR: 0,
      free: true,
      hot: false,
    }
    g.active.push(planted)
    const n0 = g.active.length
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.active.length, '심 수가 유한하다').toBeLessThan(n0 + 10)
    for (const b of g.active) {
      if (b.hot) expect(b.r, '심은 먹이 크기').toBeLessThan(g.radius * 0.8)
    }
  })

  it('⑬ 우주는 실재다 — 태양계·프록시마·궁수자리 A*', () => {
    const g = new Voyage()
    g.start(null)
    const earth = g.active.find((b) => nameOf(b.id)?.name === '지구')
    expect(earth, '지구가 있다').toBeTruthy()
    expect(earth!.r, '지구는 첫날부터 못 삼킨다').toBeGreaterThan(g.radius * 0.8)
    expect(g.active.some((b) => nameOf(b.id)?.name === '태양'), '태양이 있다').toBe(true)

    // 프록시마 — 실제 가장 가까운 별. 지도의 그 자리에.
    const prox = STAR_MAP.find((s) => s.name === '프록시마 센타우리')!
    g.x = prox.x
    g.y = prox.y
    g.z = 0
    g.update(mockInput(0, 0), 1 / 60)
    expect(
      g.active.some((b) => nameOf(b.id)?.name === '프록시마 센타우리'),
      '프록시마가 그 자리에 있다',
    ).toBe(true)

    // 궁수자리 A* — 남쪽 (게임 y-), 은하 중심
    const sgr = STAR_MAP.find((s) => s.name === '궁수자리 A*')!
    expect(sgr.y).toBeLessThan(0)
    g.x = sgr.x
    g.y = sgr.y
    g.update(mockInput(0, 0), 1 / 60)
    const core = g.active.find((b) => nameOf(b.id)?.name === '궁수자리 A*')
    expect(core, '은하의 심장이 그 자리에 있다').toBeTruthy()
    expect(core!.r).toBeGreaterThan(4000)
  })

  it('⑭ 커져도 세계는 보인다 — 시야 비례 로드', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = volFor(500)
    const prox = STAR_MAP.find((s) => s.name === '프록시마 센타우리')!
    g.x = prox.x
    g.y = prox.y
    g.z = 0
    g.camera.viewHeight = 500 * 26
    g.update(mockInput(0, 0), 1 / 60)
    // 프록시마와 알파 센타우리(0.12광년 = 한 화면)가 함께 보인다 — 실제 삼중성의 재현
    const names = g.active.map((b) => nameOf(b.id)?.name).filter(Boolean)
    expect(names, '프록시마').toContain('프록시마 센타우리')
    expect(names, '알파 센타우리').toContain('알파 센타우리')
    expect(g.active.length, '거대해도 화면에 세계가 있다').toBeGreaterThanOrEqual(4)
    expect(g.active.length, '천체 수는 폭주하지 않는다').toBeLessThan(2600)
  })

  it('⑮ z축은 실재한다 — 다른 층의 먹이는 잡히지 않는다', () => {
    const g = new Voyage()
    g.start(null)
    // 상승 입력은 z 를 올린다
    for (let s = 0; s < 60; s++) g.update(mockInput(0, 0, 1), 1 / 60)
    expect(g.z, '떠올랐다').toBeGreaterThan(40)

    const g2 = new Voyage()
    g2.start(null)
    g2.vol = 9000
    const prey = g2.active.find((b) => b.r < g2.radius * 0.7 && b.r > 2)!
    prey.free = true
    prey.host = null
    prey.orbR = 0
    const id = prey.id
    const input = mockInput(0, 0)
    for (let s = 0; s < 60; s++) {
      // 같은 xy, 다른 층 — z 로 500 아래
      g2.x = prey.x
      g2.y = prey.y
      g2.z = prey.z + 500
      g2.vx = 0
      g2.vy = 0
      g2.vz = 0
      g2.update(input, 1 / 60)
    }
    expect(g2.active.some((b) => b.id === id), 'z 가 다르면 못 삼킨다').toBe(true)
    for (let s = 0; s < 60; s++) {
      g2.x = prey.x
      g2.y = prey.y
      g2.z = prey.z
      g2.update(input, 1 / 60)
    }
    expect(g2.active.some((b) => b.id === id), '같은 층에 오면 삼킨다').toBe(false)
  })

  it('⑯ 오르트 구름은 실재한다 — 태양계의 끝은 얼음의 껍질', () => {
    const g = new Voyage()
    g.start(null)
    g.x = (SHELL.oortIn + SHELL.oortOut) / 2
    g.y = 1200
    g.update(mockInput(0, 0), 1 / 60)
    const ice = g.active.filter((b) => b.kind === BodyKind.Dust && b.r < 8)
    expect(ice.length, '얼음이 지천이다').toBeGreaterThanOrEqual(5)
  })

  it('⑰ 땅콩만 해도 갉는다 — 접촉 잠식 (블랙홀은 크기가 아니라 밀도다)', () => {
    const g = new Voyage()
    g.start(null)
    const earth = g.active.find((b) => nameOf(b.id)?.name === '지구')!
    const r0 = earth.r
    const vol0 = g.vol
    const input = mockInput(0, 0)
    for (let s = 0; s < 120; s++) {
      g.x = earth.x + (g.radius + earth.r) * 0.99
      g.y = earth.y
      g.z = earth.z
      g.vx = 0
      g.vy = 0
      g.vz = 0
      g.update(input, 1 / 60)
    }
    expect(earth.r, '지구가 스멀스멀 깎인다').toBeLessThan(r0 - 0.03)
    for (let s = 0; s < 120; s++) g.update(input, 1 / 60)
    expect(g.vol, '깎인 것은 스트림으로 내 것이 된다').toBeGreaterThan(vol0 + 10)
  })

  it('⑱ 은하화 — 거대해지면 잔챙이는 삼켜지지 않고 나를 영원히 돈다', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = volFor(70) // R 70 — 은하화 문턱(60) 위
    const victim = g.active[0]!
    const tiny = {
      ...victim,
      id: 123456789,
      r: 2.5,
      x: g.x + g.radius * 2,
      y: g.y,
      z: g.z,
      host: null,
      orbR: 0,
      free: true,
      hot: false,
    }
    g.active.push(tiny)
    const input = mockInput(0, 0)
    for (let s = 0; s < 30; s++) g.update(input, 1 / 60)
    expect(g.halo.length, '은하가 생겼다').toBeGreaterThanOrEqual(1)
    expect(g.active.some((b) => b.id === tiny.id), '세계에서는 사라졌다').toBe(false)
  })

  it('⑲ 블랙홀 합병 — 나선낙하로 감아 돌다 하나가 되고, 중력파가 퍼진다', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = volFor(80)
    const R = g.radius
    g.rivals.push({
      id: 55555, x: g.x + R * 1.2, y: g.y, z: g.z, vx: 0, vy: 0, vz: 0,
      vol: volFor(R * 0.5),
    })
    const vol0 = g.vol
    const input = mockInput(0, 0)
    g.update(input, 1 / 60)
    expect(g.merging, '나선낙하가 시작됐다').toBeTruthy()
    expect(g.rivals.length, '상대는 궤도에 물렸다').toBe(0)
    for (let s = 0; s < 300; s++) g.update(input, 1 / 60)
    expect(g.merging, '합병이 끝났다').toBeNull()
    expect(g.waveT, '중력파가 퍼졌다').toBeLessThan(6)
    expect(g.vol, '질량이 내 것이 됐다').toBeGreaterThan(vol0 * 1.05)
  })

  it('⑪ 탐욕스럽게 쫓기만 해도 굶지 않는다 — 성장 페이스', () => {
    const g = new Voyage()
    g.start(null)
    const input = { move: { x: 0, y: 0 }, lift: 0 } as unknown as Input & { lift: number }
    let lastEat = 0
    let starve = 0
    let worstStarve = 0
    for (let s = 0; s < 7200; s++) {
      if (s % 30 === 0) {
        // 게임이 설계된 대로 노는 봇: 한 입(나침반 규칙) 우선, 도착 전 브레이크
        const R = g.radius
        const meaty = Math.max(2.5, R * 0.12)
        let best: Body | null = null
        let bd = Infinity
        let anyB: Body | null = null
        let anyD = Infinity
        for (const b of g.active) {
          if (b.r >= R * 0.8) continue
          const d = Math.hypot(b.x - g.x, b.y - g.y, b.z - g.z)
          if (b.r >= meaty && d < bd) {
            bd = d
            best = b
          }
          if (d < anyD) {
            anyD = d
            anyB = b
          }
        }
        if (!best) best = anyB
        if (best) {
          const d = Math.hypot(best.x - g.x, best.y - g.y) || 1
          const speed = Math.hypot(g.vx, g.vy)
          if (d < speed * 0.7) {
            input.move.x = -g.vx / (speed || 1)
            input.move.y = -g.vy / (speed || 1)
          } else {
            input.move.x = (best.x - g.x) / d
            input.move.y = (best.y - g.y) / d
          }
          const dz = best.z - g.z
          input.lift = dz > 400 ? 1 : dz < -400 ? -1 : 0
        }
      }
      g.update(input, 1 / 60)
      if (g.eatenThisRun > lastEat) {
        lastEat = g.eatenThisRun
        starve = 0
      } else {
        starve += 1 / 60
        if (starve > worstStarve) worstStarve = starve
      }
    }
    // 압축비 도입 후 성장은 느긋해야 정상 — 2분에 반지름이 "의미 있게"만 자라면 된다
    expect(g.radius, '2분 뒤 반지름').toBeGreaterThan(8.2)
    // 압도감 계약 — 2분 만에 행성 사냥꾼급이면 우주가 작아진다 (과속 금지)
    expect(g.radius, `과속 금지 (r=${g.radius.toFixed(1)})`).toBeLessThan(22)
    expect(worstStarve, '최장 기아 구간(초)').toBeLessThan(30)
  })
})
