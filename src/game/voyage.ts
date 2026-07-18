/**
 * 검은 입 v3 — 진짜 우주를 삼키는 탐험.
 *
 * 지키는 문장은 하나다: **나는 블랙홀이다. 삼키면 커지고, 커지면 어제 못 삼키던
 * 것을 삼킨다.** 이 문장 밖의 시스템은 없다 — 적도, 점수도, 타이머도, 죽음도 없다.
 *
 * v3 의 근본 (실플레이 판정: "무근본 게임", "현실 우주같이"):
 * · **맵이 곧 현실이다** — 절차 생성이 아니라 실제 우주 지도(starmap.ts).
 *   태양계에서 시작해 카이퍼 벨트 → 오르트 구름 → 텅 빈 성간 공간(한세월) →
 *   실제 방향·실제 거리 순서의 프록시마·시리우스 → 은하 중심 궁수자리 A*.
 * · **z축이 있다** — 궤도는 기울어 넘실대고(경사), 스페이스/시프트로 떠오르고
 *   가라앉는다. 위에 있는 것은 크고 빠르게, 아래 것은 작고 어둡게 보인다.
 * · **조각이 아니라 구름** — 조석 파괴는 가스 흐름(tidal stream)이다. 찢긴 질량은
 *   연기 리본으로 나선을 그리며 흘러들어와 서서히 내 것이 된다.
 * · 물리는 v2 그대로: 케플러 레일·섭동(Hills)·로슈·강착 점성·틀 끌림·운동량·렌즈.
 */
import type { SfxName } from '../engine/audio'
import { Camera } from '../engine/camera'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Rng, hashSeed } from '../engine/rng'
import { Shape } from '../engine/shapes'
import { KUIPER, LY, PROBES, SHELL, STAR_MAP, pxOf, type MapSystem } from './starmap'
import { nameOf, realName, registerName, starLog, starName, type RealName } from './starnames'

/** 섹터 시드 상수 — 절차 채움(오르트 얼음·떠돌이)의 결정론 유지 */
export const UNIVERSE_SEED = 20260718

const SECTOR = 2400
/** 삼킬 수 있는 크기 비율 — 내 반지름의 이 배수 미만이면 먹이다 */
const EDIBLE = 0.8

// ── 물리 상수 (다이얼 — docs/우주-물리.md 가 이 표의 해설이다)
const GRAV = 192
const PULL_CAP_ON_ME = 340
const PULL_CAP_BY_ME = 640
/** 레일 이탈 문턱 — 내 중력이 궤도 구심 가속의 이 배수를 넘으면 위성이 뜯긴다 */
const DETACH = 1.15
/** 틀 끌림 세기 — 낙하물에 접선 성분을 준다 (내 스핀 평면 = xy) */
const FRAME_DRAG = 0.45
/** 검은 입 흡인 배율 — 같은 반지름의 항성보다 세게 끈다 (밀집천체의 특권) */
const MAW_PULL = 3
/** 로슈 접근 배율 — (R + r) 의 이 배수 안이면 조석 파괴 */
const ROCHE = 1.3
/** 삼킨 부피 중 내 것이 되는 비율 — 나머지는 강착 과정에서 새는 셈 */
const ABSORB_GAIN = 0.85
/** 조석 파괴에서 가스 스트림으로 흘러드는 비율 — 통째(0.85)보다 손해: 조급함의 세금 */
const SHRED_STREAM = 0.5
/** 조석 파괴가 남기는 고체 심(얼음 핵) 반지름 배율 */
const SHRED_CORE = 0.42

export const BodyKind = {
  Dust: 0, // 티끌·얼음 — 오르트의 주민. 파편 심도 이것이 된다
  Comet: 1, // 혜성 — 타원 궤도, 근일점에서 빠르다 (케플러 2법칙)
  Ringed: 2, // 고리 행성 — 토성 같은
  Sun: 3, // 항성 — 행성계의 앵커. 갈색왜성도 여기 속한다
  Garden: 4, // 성운·성단
  Core: 5, // 은하심 — 궁수자리 A*, 그리고 그 너머
  Rock: 6, // 민무늬 행성 — 지구 같은
} as const
export type BodyKindType = (typeof BodyKind)[keyof typeof BodyKind]

export interface Body {
  /** 결정론 시드이자 식별자 — 이름·명부·eaten 이 전부 이걸 쓴다 */
  readonly id: number
  readonly kind: BodyKindType
  readonly r: number
  readonly cr: number
  readonly cg: number
  readonly cb: number
  x: number
  y: number
  /** z — 우주는 평면이 아니다. 위(+)는 화면에서 크고 빠르게, 아래는 작고 어둡게 */
  z: number
  vx: number
  vy: number
  vz: number
  /** 궤도 앵커 — 천체(움직인다) 또는 고정점(ax,ay,az). 없으면 자유체 */
  host: Body | null
  ax: number
  ay: number
  az: number
  orbR: number
  orbA: number
  orbW: number
  /** 이심률 — r(θ)=a(1-e²)/(1+e·cosθ), 각속도는 면적 속도 일정(케플러 2법칙) */
  ecc: number
  /** 궤도 경사 — 0 이면 황도면, 클수록 z 로 크게 넘실댄다 (명왕성 0.3, 에리스 0.77) */
  inc: number
  /** 레일에서 뜯겼거나 원래 자유체 — 중력 적분만 따른다 */
  free: boolean
  /** 조석 파괴의 심 — 뜨겁게 그린다 */
  hot: boolean
}

export interface JournalEntry {
  readonly name: string
  readonly log: string
  readonly kind: BodyKindType
  readonly r: number
  readonly x: number
  readonly y: number
}

const STORE_KEY = 'embertide:maw:v1'

/** 성장 등급 — 이정표. 태양계의 실제 사다리와 맞물린다. */
export const RANKS: readonly { readonly r: number; readonly name: string }[] = [
  { r: 0, name: '티끌' },
  { r: 12, name: '검은 입' }, // 지구(9.2)가 먹이가 되는 무렵
  { r: 30, name: '행성 사냥꾼' }, // 토성·목성이 사정권
  { r: 60, name: '카이퍼의 주인' },
  { r: 115, name: '태양을 삼킨 것' }, // 태양 r90 을 넘긴 뒤
  { r: 210, name: '별을 삼키는 자' },
  { r: 700, name: '거성의 포식자' },
  { r: 1500, name: '은하심의 아귀' },
]

export function rankOf(radius: number): string {
  let name = RANKS[0]!.name
  for (const rk of RANKS) if (radius >= rk.r) name = rk.name
  return name
}

/**
 * 추진 가속 — 카메라가 반지름에 비례해 물러나므로(줌아웃 ∝ R) 가속도 화면
 * 눈금을 따라야 한다. 지수 0.85: 완전 비례보다 살짝 아래 — 묵직함은 남긴다.
 */
function thrustAcc(radius: number): number {
  return 456 * Math.pow(Math.max(950, radius * 26) / 950, 0.85)
}

export interface Rival {
  readonly id: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  vol: number
}

/** 영속 — 게임이 직접 localStorage 를 만지지 않는다 (테스트 가능성). */
export interface Store {
  load(): string | null
  save(s: string): void
}

interface Absorb {
  b: Body
  t: number
  dur: number
}

/** 가스 입자 — 조석 스트림·TDE 분출·합병의 연기. 풀 고정, 프레임 할당 0. */
interface Gas {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  size: number
  cr: number
  cg: number
  cb: number
}

const GAS_MAX = 240
const START_VOL = 340

export class Voyage {
  // ── 나 — 검은 입
  x = 0
  y = 600
  z = 0
  vx = 0
  vy = 0
  vz = 0
  heading = 0
  vol = START_VOL
  thrusting = false

  // ── 세계
  private readonly sectors = new Map<string, Body[]>()
  readonly active: Body[] = []
  private activeKey = ''
  private readonly eaten = new Set<number>()
  private solSun: Body | null = null

  // ── 포식
  readonly absorbs: Absorb[] = []
  /** 가스 스트림으로 흘러드는 중인 부피 — 조석 파괴의 수확은 구름으로 온다 */
  private streamIn = 0

  lastFound: JournalEntry | null = null
  /** 명부 — 평생 목록. 티끌은 이름 없이 지나간다 */
  readonly journal: JournalEntry[] = []
  private eatCount = 0
  farthest = 0
  biggestMeal = 0
  bestR = 0
  voyages = 0
  visualTime = 0
  readonly camera = new Camera()
  readonly sfxQueue: SfxName[] = []
  private store: Store | null = null
  private dirty = false
  private persistCd = 0

  readonly rivals: Rival[] = []
  rankUp: string | null = null
  private lastRank = ''
  private gulp = 0
  feed = 0
  private bittenCd = 0
  private waveX = 0
  private waveY = 0
  private waveT = 1e9
  /** 나침반 대상 — 3D 렌더러(main)가 화면 화살표로 그린다 */
  preyX = 0
  preyY = 0
  preyZ = 0
  preyDist = Infinity

  private readonly gas: Gas[] = []
  private gasIdx = 0

  get radius(): number {
    return Math.cbrt(this.vol)
  }

  get eatenThisRun(): number {
    return this.eatCount
  }

  sfx(name: SfxName): void {
    if (this.sfxQueue.length < 12) this.sfxQueue.push(name)
  }

  constructor() {
    for (let i = 0; i < GAS_MAX; i++) {
      this.gas.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 10, cr: 0, cg: 0, cb: 0 })
    }
  }

  start(store: Store | null): void {
    this.store = store
    this.x = 0
    this.y = 600
    this.z = 0
    this.vx = 0
    this.vy = 0
    this.vz = 0
    this.vol = START_VOL // 반지름 ~7 — 지구 곁의 티끌
    this.journal.length = 0
    this.eaten.clear()
    this.farthest = 0
    this.lastFound = null
    this.absorbs.length = 0
    this.streamIn = 0
    this.sectors.clear()
    this.solSun = null
    this.activeKey = ''
    this.rivals.length = 0
    this.rankUp = null
    this.gulp = 0
    this.feed = 0
    this.bittenCd = 0
    this.biggestMeal = 0
    this.bestR = 0
    this.voyages = 0
    this.waveT = 1e9
    this.dirty = false
    this.persistCd = 0
    for (const g of this.gas) g.life = 0
    if (store) {
      try {
        const raw = store.load()
        if (raw) {
          const d = JSON.parse(raw) as Record<string, unknown>
          // 회차: vol·eaten 은 읽지 않는다. 필드별 독립 검증 — 썩은 엔트리가
          // 렌더에서 터지면 게임이 영구 정지하고, 한 필드 실패가 기록을 지운다.
          if (Array.isArray(d['journal'])) {
            for (const e of (d['journal'] as unknown[]).slice(-400)) {
              const j = e as JournalEntry | null
              if (
                j && typeof j === 'object' &&
                typeof j.name === 'string' && typeof j.log === 'string' &&
                Number.isFinite(j.r) && Number.isFinite(j.x) && Number.isFinite(j.y)
              ) {
                this.journal.push(j)
              }
            }
          }
          const num = (v: unknown): number =>
            typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
          this.farthest = num(d['farthest'])
          this.biggestMeal = num(d['biggestMeal'])
          this.bestR = num(d['bestR'])
          this.voyages = num(d['voyages'])
        }
      } catch {
        // 깨진 저장은 조용히 새 명부로 — 우주는 그대로다
      }
    }
    this.eatCount = 0
    this.voyages += 1
    this.lastRank = rankOf(this.radius)
    this.camera.x = this.x
    this.camera.y = this.y
    this.camera.viewHeight = Math.max(1100, this.radius * 30)
    this.refreshSectors(true)
    this.persist()
  }

  /** 밖(main)에서 페이지를 떠날 때 부른다 — 배치 저장의 마지막 조각을 흘리지 않게 */
  flush(): void {
    if (this.dirty) this.persist()
  }

  private persistSoon(): void {
    this.dirty = true
    if (this.persistCd <= 0) this.persist()
  }

  private persist(): void {
    this.dirty = false
    this.persistCd = 1.2
    if (!this.store) return
    try {
      if (this.radius > this.bestR) this.bestR = Math.round(this.radius)
      this.store.save(JSON.stringify({
        journal: this.journal.slice(-400),
        farthest: Math.round(this.farthest),
        biggestMeal: this.biggestMeal,
        bestR: this.bestR,
        voyages: this.voyages,
      }))
    } catch {
      // 저장 실패는 항해를 막지 않는다
    }
  }

  // ── 우주 — 실제 지도(starmap)가 뼈대, 절차 채움(오르트 얼음·떠돌이)이 살이다.

  private newBody(
    id: number, kind: BodyKindType, x: number, y: number, r: number,
    cr: number, cg: number, cb: number,
  ): Body {
    return {
      id, kind, r, cr, cg, cb, x, y, z: 0,
      vx: 0, vy: 0, vz: 0, host: null, ax: 0, ay: 0, az: 0,
      orbR: 0, orbA: 0, orbW: 0, ecc: 0, inc: 0,
      free: false, hot: false,
    }
  }

  /** 궤도 레일 — 즉시 레일 위에 놓는다. 각속도는 호스트 표면중력에서 유도. */
  private setOrbit(
    b: Body, host: Body, orbR: number, orbA: number, dir: number, ecc = 0, inc = 0,
  ): void {
    b.host = host
    b.orbR = orbR
    b.orbA = orbA
    b.ecc = ecc
    b.inc = inc
    const g = (host.r * host.r * GRAV) / (orbR * orbR)
    b.orbW = (dir * Math.sqrt(g * orbR)) / orbR
    const rr = ecc > 0 ? (orbR * (1 - ecc * ecc)) / (1 + ecc * Math.cos(orbA)) : orbR
    b.x = host.x + Math.cos(orbA) * rr
    b.y = host.y + Math.sin(orbA) * rr * Math.cos(inc)
    b.z = host.z + Math.sin(orbA) * rr * Math.sin(inc)
    const tv = b.orbW * rr
    b.vx = -Math.sin(orbA) * tv
    b.vy = Math.cos(orbA) * tv * Math.cos(inc)
    b.vz = Math.cos(orbA) * tv * Math.sin(inc)
  }

  /** 태양계 — 실제 순서·실제 이름·실제 경사. 명왕성은 행성이 아니라 카이퍼에 있다. */
  private buildSol(list: Body[]): void {
    const sunId = hashSeed('sol:sun')
    const sun = this.newBody(sunId, BodyKind.Sun, 800, 800, 90, 1.9, 1.5, 0.6)
    registerName(sunId, '태양', '아침마다 너를 비추던 것이었다.')
    list.push(sun)
    this.solSun = sun
    const P: readonly [string, number, number, BodyKindType, string, number, number, number, number][] = [
      ['수성', 3.5, 1.7, BodyKind.Rock, '태양에 데인 돌이었다.', 0.6, 0.55, 0.5, 0.12],
      ['금성', 8.7, 2.2, BodyKind.Rock, '샛별이라 불리던 것이었다.', 0.95, 0.85, 0.6, 0.06],
      ['지구', 9.2, 2.75, BodyKind.Rock, '네가 태어난 곳이었다.', 0.35, 0.6, 0.95, 0],
      ['화성', 4.9, 3.4, BodyKind.Rock, '누군가 끝내 가보고 싶어 했다.', 0.9, 0.45, 0.3, 0.03],
      ['목성', 32, 5.2, BodyKind.Ringed, '행성들의 왕이었다.', 0.85, 0.7, 0.5, 0.02],
      ['토성', 27, 6.6, BodyKind.Ringed, '고리마저 삼켰다.', 0.9, 0.8, 0.55, 0.04],
      ['천왕성', 13, 8.1, BodyKind.Rock, '옆으로 누워 돌던 얼음이었다.', 0.6, 0.85, 0.9, 0.01],
      ['해왕성', 12.5, 9.5, BodyKind.Rock, '가장 푸른 바람이 불던 곳.', 0.4, 0.55, 1.0, 0.03],
    ]
    for (const [name, r, orbMul, kind, log, cr, cg, cb, inc] of P) {
      const id = hashSeed(`sol:${name}`)
      const p = this.newBody(id, kind, sun.x, sun.y, r, cr, cg, cb)
      this.setOrbit(p, sun, sun.r * orbMul, (id % 628) * 0.01, 1, 0, inc)
      registerName(id, name, log)
      list.push(p)
      if (name === '지구') {
        const mId = hashSeed('sol:moon')
        const m = this.newBody(mId, BodyKind.Dust, p.x, p.y, 2.5, 0.7, 0.7, 0.72)
        this.setOrbit(m, p, p.r * 2.3, 0, 1, 0, 0.09)
        registerName(mId, '달', '지구의 조석을 만들던 돌이었다.')
        list.push(m)
      }
    }
    // 소행성대 — 화성과 목성 사이, 실제 그 자리. 첫째 알갱이는 세레스다.
    for (let i = 0; i < 13; i++) {
      const id = hashSeed(`sol:belt:${i}`)
      const d = this.newBody(id, BodyKind.Dust, sun.x, sun.y,
        i === 0 ? 3.4 : 2.4 + ((id >>> 4) % 100) * 0.014, 0.55, 0.5, 0.45)
      this.setOrbit(d, sun, sun.r * (4.1 + ((id >>> 6) % 100) * 0.006),
        (i / 13) * Math.PI * 2, 1, 0, ((id >>> 8) % 100) * 0.0016 - 0.08)
      if (i === 0) registerName(id, '세레스', '소행성대에서 가장 큰 돌이었다.')
      list.push(d)
    }
    // 핼리 혜성 — 실제처럼 길쭉하고 기운 타원. 근일점에서 빨라진다.
    const hId = hashSeed('sol:halley')
    const h = this.newBody(hId, BodyKind.Comet, sun.x, sun.y, 5.5, 0.8, 0.9, 1.0)
    this.setOrbit(h, sun, sun.r * 8, 2.2, 1, 0.72, 0.55)
    registerName(hId, '핼리 혜성', '76년마다 지구에 들르던 것이었다.')
    list.push(h)
  }

  private ensureSolSun(): Body {
    if (!this.solSun) this.sectorBodies(0, 0)
    return this.solSun!
  }

  /** 실지도 항성계 — 별 + 동반성 + 알려진 행성들. 전부 실명 등록. */
  private buildSystem(sys: MapSystem, list: Body[]): void {
    const id = hashSeed(`map:${sys.name}`)
    const kind = sys.kind === 'sun' ? BodyKind.Sun : sys.kind === 'garden' ? BodyKind.Garden : BodyKind.Core
    const star = this.newBody(id, kind, sys.x, sys.y, Math.max(60, sys.r), sys.cr, sys.cg, sys.cb)
    star.z = sys.z
    registerName(id, sys.name, sys.log)
    list.push(star)
    const rng = new Rng(id)
    for (const c of sys.companions ?? []) {
      const cId = hashSeed(`map:${sys.name}:${c.name}`)
      const comp = this.newBody(cId, BodyKind.Sun, star.x, star.y, c.r, sys.cr * 0.9, sys.cg * 0.9, sys.cb)
      this.setOrbit(comp, star, star.r * c.orbMul, rng.next() * Math.PI * 2, 1, 0, (rng.next() - 0.5) * 0.3)
      registerName(cId, c.name, c.log ?? `${sys.name}의 동반성이었다.`)
      list.push(comp)
    }
    for (const p of sys.planets ?? []) {
      const pId = hashSeed(`map:${sys.name}:${p.name}`)
      const pb = this.newBody(pId, p.ringed ? BodyKind.Ringed : BodyKind.Rock, star.x, star.y, p.r,
        0.5 + rng.next() * 0.4, 0.5 + rng.next() * 0.3, 0.6 + rng.next() * 0.3)
      this.setOrbit(pb, star, star.r * p.orbMul, rng.next() * Math.PI * 2, 1, 0, (rng.next() - 0.5) * 0.24)
      registerName(pId, p.name, p.log ?? `${sys.name}의 행성이었다.`)
      list.push(pb)
    }
    // 알려진 행성이 없는 별도 벌거숭이는 아니다 — 이름 없는 행성 한둘 (통계적 사실)
    if (kind === BodyKind.Sun && !(sys.planets?.length) && rng.next() < 0.6) {
      const n = 1 + rng.int(2)
      for (let i = 0; i < n; i++) {
        const pId = hashSeed(`map:${sys.name}:p${i}`)
        const pr = Math.max(3, star.r * (0.05 + rng.next() * 0.06))
        const pb = this.newBody(pId, rng.next() < 0.25 ? BodyKind.Ringed : BodyKind.Rock,
          star.x, star.y, pr, 0.55, 0.55, 0.65)
        this.setOrbit(pb, star, star.r * (2.2 + i * 1.3 + rng.next() * 0.6),
          rng.next() * Math.PI * 2, 1, 0, (rng.next() - 0.5) * 0.3)
        list.push(pb)
      }
    }
    // 성단은 별 여럿이 함께 돈다 (플레이아데스 — 일곱 자매)
    if (kind === BodyKind.Garden && sys.r === 0) {
      for (let i = 0; i < 6; i++) {
        const sId = hashSeed(`map:${sys.name}:s${i}`)
        const sr = 90 + rng.next() * 110
        const s = this.newBody(sId, BodyKind.Sun, sys.x, sys.y, sr, 0.8, 0.95, 1.4)
        s.ax = sys.x
        s.ay = sys.y
        s.az = sys.z
        s.orbR = 600 + rng.next() * 1500
        s.orbA = rng.next() * Math.PI * 2
        s.orbW = 0.03 + rng.next() * 0.03
        s.inc = (rng.next() - 0.5) * 0.5
        s.x = sys.x + Math.cos(s.orbA) * s.orbR
        s.y = sys.y + Math.sin(s.orbA) * s.orbR * Math.cos(s.inc)
        s.z = sys.z + Math.sin(s.orbA) * s.orbR * Math.sin(s.inc)
        list.push(s)
      }
    }
  }

  private sectorBodies(sx: number, sy: number): Body[] {
    const key = `${sx},${sy}`
    let list = this.sectors.get(key)
    if (list) return list
    list = []
    this.sectors.set(key, list)
    const seed = hashSeed(`${UNIVERSE_SEED}:${sx}:${sy}`)
    const rng = new Rng(seed)
    const cx = (sx + 0.5) * SECTOR
    const cy = (sy + 0.5) * SECTOR
    const rC = Math.hypot(cx, cy)

    // ── 실지도 — 이 섹터에 중심을 둔 실존 천체계
    if (sx === 0 && sy === 0) this.buildSol(list)
    for (const sys of STAR_MAP) {
      if (Math.floor(sys.x / SECTOR) === sx && Math.floor(sys.y / SECTOR) === sy) {
        this.buildSystem(sys, list)
      }
    }
    for (const pr of PROBES) {
      if (Math.floor(pr.x / SECTOR) === sx && Math.floor(pr.y / SECTOR) === sy) {
        const id = hashSeed(`probe:${pr.name}`)
        const p = this.newBody(id, BodyKind.Dust, pr.x, pr.y, 1.3, 0.9, 0.85, 0.7)
        p.z = ((id % 100) - 50) * 8
        p.free = true
        registerName(id, pr.name, pr.log)
        list.push(p)
      }
    }
    // 카이퍼의 이름 있는 것들 — 초기 궤도 위치가 이 섹터인 것
    for (const k of KUIPER) {
      const id = hashSeed(`kuiper:${k.name}`)
      const phase = (id % 628) * 0.01
      const inc = k.name === '에리스' ? 0.77 : k.name === '마케마케' ? 0.5 : k.name === '하우메아' ? 0.49 : k.name === '세드나' ? 0.21 : 0.3
      const px = 800 + Math.cos(phase) * k.orb
      const py = 800 + Math.sin(phase) * k.orb * Math.cos(inc)
      if (Math.floor(px / SECTOR) === sx && Math.floor(py / SECTOR) === sy) {
        const sun = this.ensureSolSun()
        const b = this.newBody(id, BodyKind.Dust, sun.x, sun.y, k.r, 0.6, 0.62, 0.7)
        this.setOrbit(b, sun, k.orb, phase, 1, 0, inc)
        registerName(id, k.name, k.log)
        list.push(b)
      }
    }

    // ── 절차 채움 — 실제 구조의 껍질을 따른다. 여기가 "현실의 밀도"다:
    // 행성계는 붐비고, 카이퍼·오르트는 얼음이고, 성간은 아득하게 비어 있다.
    if (rC < 6000) {
      // 황도 먼지 — 요람의 군것질
      const cradle = rC < 3600
      const cnt = cradle ? 12 + rng.int(5) : 5 + rng.int(3)
      for (let i = 0; i < cnt; i++) {
        const dSeed = hashSeed(`${seed}:cr:${i}`)
        const d = this.newBody(dSeed, BodyKind.Dust,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          3.2 + rng.next() * 2.2, 0.55, 0.5, 0.6)
        d.z = (rng.next() - 0.5) * 360
        list.push(d)
      }
    }
    if (rC > SHELL.kuiperIn && rC < SHELL.kuiperOut) {
      // 카이퍼 벨트 — 얼음의 고리
      const cnt = 10 + rng.int(6)
      for (let i = 0; i < cnt; i++) {
        const dSeed = hashSeed(`${seed}:kb:${i}`)
        const d = this.newBody(dSeed, BodyKind.Dust,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          1.6 + rng.next() * 2.6, 0.6, 0.64, 0.72)
        d.z = (rng.next() - 0.5) * 1300
        list.push(d)
      }
    } else if (rC >= SHELL.kuiperOut && rC < SHELL.scatterOut) {
      // 산란 원반 — 세드나의 영역. 벌써 성기다
      const cnt = 2 + rng.int(3)
      for (let i = 0; i < cnt; i++) {
        const dSeed = hashSeed(`${seed}:sc:${i}`)
        const d = this.newBody(dSeed, BodyKind.Dust,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          2 + rng.next() * 3, 0.58, 0.6, 0.7)
        d.z = (rng.next() - 0.5) * 1600
        list.push(d)
      }
    } else if (rC >= SHELL.oortIn && rC < SHELL.oortOut) {
      // 오르트 구름 — 태양계의 진짜 끝. 수조 개의 얼음. 훑어먹기의 성찬
      const cnt = 13 + rng.int(7)
      for (let i = 0; i < cnt; i++) {
        const dSeed = hashSeed(`${seed}:oo:${i}`)
        const d = this.newBody(dSeed, BodyKind.Dust,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          1.8 + rng.next() * 4.4, 0.62, 0.68, 0.8)
        d.z = (rng.next() - 0.5) * 4200
        list.push(d)
      }
    } else if (rC >= SHELL.oortOut) {
      // 성간 공간 — 여기부터는 한세월이다. 떠돌이 행성, 갈색왜성, 성간 방문자뿐
      if (rng.next() < 0.05) {
        const id = hashSeed(`${seed}:rg`)
        const b = this.newBody(id, rng.next() < 0.2 ? BodyKind.Ringed : BodyKind.Rock,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          9 + rng.next() * 17, 0.5, 0.5, 0.62)
        b.z = (rng.next() - 0.5) * 4800
        b.free = true
        list.push(b)
      }
      if (rng.next() < 0.02) {
        const id = hashSeed(`${seed}:bd`)
        const b = this.newBody(id, BodyKind.Sun,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          30 + rng.next() * 22, 0.8, 0.4, 0.3)
        b.z = (rng.next() - 0.5) * 4800
        list.push(b)
      }
      if (rng.next() < 0.015) {
        const id = hashSeed(`${seed}:ic`)
        const b = this.newBody(id, BodyKind.Comet,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          6 + rng.next() * 6, 0.8, 0.9, 1.0)
        b.z = (rng.next() - 0.5) * 4800
        b.vx = (rng.next() - 0.5) * 400
        b.vy = (rng.next() - 0.5) * 400
        b.free = true
        list.push(b)
      }
      // 16광년 너머 — 일반 항성 들판 (지도의 명소들 사이를 메우는 실재의 배경)
      if (rC > pxOf(16) && rng.next() < 0.07) {
        const id = hashSeed(`${seed}:fs`)
        const big = rC > pxOf(600)
        const b = this.newBody(id, BodyKind.Sun,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          big ? 200 + rng.next() * 900 : 60 + rng.next() * 240,
          0.9 + rng.next(), 0.7 + rng.next() * 0.8, 0.4 + rng.next() * 0.9)
        b.z = (rng.next() - 0.5) * 6000
        list.push(b)
        if (rng.next() < 0.5) {
          const pId = hashSeed(`${seed}:fsp`)
          const pb = this.newBody(pId, BodyKind.Rock, b.x, b.y,
            Math.max(4, b.r * (0.05 + rng.next() * 0.07)), 0.55, 0.55, 0.65)
          this.setOrbit(pb, b, b.r * (2.3 + rng.next()), rng.next() * Math.PI * 2, 1, 0,
            (rng.next() - 0.5) * 0.3)
          list.push(pb)
        }
      }
    }

    // 캐시 축출 — 시야(N)가 커질수록 더 많이 쥔다
    const N = this.rangeN()
    const keep = (2 * N + 3) * (2 * N + 3) + 32
    if (this.sectors.size > keep) {
      const pcx = Math.floor(this.x / SECTOR)
      const pcy = Math.floor(this.y / SECTOR)
      for (const [k] of this.sectors) {
        const [axx, ayy] = k.split(',').map(Number)
        if (Math.abs(axx! - pcx) > N + 2 || Math.abs(ayy! - pcy) > N + 2) this.sectors.delete(k)
        if (this.sectors.size <= keep - 16) break
      }
    }
    return list
  }

  /** 이 섹터의 결정론 라이벌 — 성간부터 나타난다. 요람은 안전해야 한다. */
  private sectorRival(sx: number, sy: number): Rival | null {
    const rC = Math.hypot((sx + 0.5) * SECTOR, (sy + 0.5) * SECTOR)
    if (rC < SHELL.oortIn) return null
    const seed = hashSeed(`${UNIVERSE_SEED}:rv:${sx}:${sy}`)
    const rng = new Rng(seed)
    if (rng.next() >= 0.16) return null
    const r = Math.min(760, 24 + (rC / LY) * 26 + rng.next() * 20)
    return {
      id: seed,
      x: sx * SECTOR + rng.next() * SECTOR,
      y: sy * SECTOR + rng.next() * SECTOR,
      z: (rng.next() - 0.5) * 4000,
      vx: 0,
      vy: 0,
      vz: 0,
      vol: r * r * r,
    }
  }

  /** 활성 반경(섹터) — 시야가 커지면 세계도 넓게 깬다. 이게 없으면 거대해질수록
   * 화면이 로드 범위 밖 = 빈 배경만 보인다 (실플레이 판정). */
  private rangeN(): number {
    // 3D 원근은 지평선까지 보인다 — 2D 시절(1.15)보다 넓게 깨워야 시야가 안 빈다
    return Math.min(7, Math.max(1, Math.ceil((this.camera.viewHeight * 1.5) / SECTOR)))
  }

  private refreshSectors(force = false): void {
    const sx = Math.floor(this.x / SECTOR)
    const sy = Math.floor(this.y / SECTOR)
    const N = this.rangeN()
    const key = `${sx},${sy},${N}`
    if (!force && key === this.activeKey) return
    this.activeKey = key
    // 이사 — 섹터를 넘은 천체는 현재 위치의 **캐시된** 명단으로만 옮긴다.
    // 여기서 섹터를 생성하면 경계 걸친 위성이 이웃 생성을 연쇄 유발해
    // 우주 끝까지 기는 무한 크롤이 된다 (계측: 행 재현).
    for (const [k, lst] of this.sectors) {
      for (let i = lst.length - 1; i >= 0; i--) {
        const b = lst[i]!
        const bk = `${Math.floor(b.x / SECTOR)},${Math.floor(b.y / SECTOR)}`
        if (bk !== k) {
          const target = this.sectors.get(bk)
          if (target) {
            lst.splice(i, 1)
            target.push(b)
          }
        }
      }
    }
    this.active.length = 0
    const R = this.radius
    const tiny = R * 0.015 // 거대해지면 티끌은 보이지도 않는다 (LOD — 성능의 방벽)
    const rivalIds = new Set<number>()
    for (let dy = -N; dy <= N; dy++) {
      for (let dx = -N; dx <= N; dx++) {
        for (const b of this.sectorBodies(sx + dx, sy + dy)) {
          if (this.eaten.has(b.id)) continue
          if (b.r < tiny) continue
          this.active.push(b)
        }
        const rv = this.sectorRival(sx + dx, sy + dy)
        if (rv && !this.eaten.has(rv.id)) {
          rivalIds.add(rv.id)
          if (!this.rivals.some((r) => r.id === rv.id)) this.rivals.push(rv)
        }
      }
    }
    for (let i = this.rivals.length - 1; i >= 0; i--) {
      if (!rivalIds.has(this.rivals[i]!.id)) this.rivals.splice(i, 1)
    }
  }

  // ── 한 틱

  update(input: Input, dt: number): void {
    const step = Math.min(dt, 0.05)
    this.visualTime += dt
    if (!Number.isFinite(this.vol) || this.vol < 1) this.vol = START_VOL
    const R = this.radius
    // 줌 눈금 — 거대해질수록 R×26 → R×18 로 수렴: 무한 줌아웃이면 주변이 전부
    // 동전이 된다 (실플레이). 내 존재감과 이웃의 크기가 같이 자란다.
    const base = Math.max(950, R * (26 - 8 * Math.min(1, R / 1300)))

    // 추진 — 화면 눈금으로 민첩하게, 놓으면 서서히 선다. 역추진은 브레이크다.
    const mx = input.move.x
    const my = input.move.y
    const lift = input.lift ?? 0
    this.thrusting = mx !== 0 || my !== 0 || lift !== 0
    const acc = thrustAcc(R)
    if (this.thrusting) {
      const ml = Math.hypot(mx, my) || 1
      if (mx !== 0 || my !== 0) {
        const sp = Math.hypot(this.vx, this.vy)
        const dot = sp > 1 ? ((this.vx * mx) / ml + (this.vy * my) / ml) / sp : 0
        const eff = dot < -0.3 ? 1.7 : 1 // 진행 반대로 밀면 더 세게 듣는다
        this.vx += (mx / ml) * acc * eff * step
        this.vy += (my / ml) * acc * eff * step
        this.heading = Math.atan2(my, mx)
      }
      if (lift !== 0) this.vz += lift * acc * 0.85 * step
    }
    // 항력 — 추진 중엔 낮고, 놓으면 강하다 ("브레이크 없는 엑셀" 판정의 수리).
    // z 는 따로: 상승키를 놓으면 수직 흐름이 빨리 죽는다 — 층 이동은 탭으로 끝나야
    // 하고, 진동하면 조작 지옥이다 (계측: 봇 z ±760 발진).
    // 활공 0.3 — "적당히 미끄러져야지": 0.6 은 급정거였고 0.1 은 브레이크가 없었다
    const dragK = this.thrusting ? 0.14 : 0.3
    const drag = Math.exp(-dragK * step)
    this.vx *= drag
    this.vy *= drag
    this.vz *= Math.exp(-(lift !== 0 ? 0.14 : 0.5) * step)

    // ── 천체 물리 한 패스: 레일(3D) → 내 중력(섭동·틀 끌림·원반화 점성) → 자유체.
    for (const b of this.active) {
      if (this.eaten.has(b.id)) continue
      if (b.host && this.eaten.has(b.host.id)) {
        b.free = true // 호스트를 잃으면 구심력을 잃는다 — 마지막 접선 속도로 산개
        b.host = null
      }
      if (!b.free && b.orbR > 0) {
        let rr = b.orbR
        let w = b.orbW
        if (b.ecc > 0) {
          rr = (b.orbR * (1 - b.ecc * b.ecc)) / (1 + b.ecc * Math.cos(b.orbA))
          w = b.orbW * (b.orbR / rr) * (b.orbR / rr)
        }
        b.orbA += w * step
        const hx = b.host ? b.host.x : b.ax
        const hy = b.host ? b.host.y : b.ay
        const hz = b.host ? b.host.z : b.az
        const ci = Math.cos(b.inc)
        const si = Math.sin(b.inc)
        b.x = hx + Math.cos(b.orbA) * rr
        b.y = hy + Math.sin(b.orbA) * rr * ci
        b.z = hz + Math.sin(b.orbA) * rr * si
        const tv = w * rr
        b.vx = -Math.sin(b.orbA) * tv + (b.host ? b.host.vx : 0)
        b.vy = Math.cos(b.orbA) * tv * ci + (b.host ? b.host.vy : 0)
        b.vz = Math.cos(b.orbA) * tv * si + (b.host ? b.host.vz : 0)
      }
      // 내 중력 — 나보다 작은 것만 내가 끈다 (질량 우위).
      // 먹이급은 훨씬 멀리서도 딸려온다 (본디 포획 반경 — 지평선보다 크다):
      // 이게 없으면 3D 에서 입까지 아무것도 안 온다 (계측: 봇 2분 0끼).
      if (b.r < R) {
        const dx = this.x - b.x
        const dy = this.y - b.y
        const dz = this.z - b.z
        const d2 = dx * dx + dy * dy + dz * dz
        const d = Math.sqrt(d2) || 1
        const edibleB = b.r < R * EDIBLE
        const reach = edibleB ? R * 14 + 300 + R * 2 : R * 14
        if (d < reach) {
          let g = Math.min(PULL_CAP_BY_ME, (R * R * GRAV * MAW_PULL) / d2)
          if (edibleB) g = Math.min(PULL_CAP_BY_ME, g + 70 * (1 + R / 150))
          if (!b.free && b.orbR > 0) {
            const bind = Math.abs(b.orbW * b.orbW * b.orbR)
            if (g > bind * DETACH) b.free = true // 섭동 — 레일에서 뜯긴다 (Hills)
          } else if (d > Math.max(2, R * 0.25)) {
            b.free = true
            // 당김 분해 — 가까울수록 접선(틀 끌림, 내 스핀 평면 xy) 비중이 커진다:
            // 다이렉트로 떨어지지 않고 감기며 강착원반을 이루다 흘러든다.
            const prox = R / (d + R)
            // 소용돌이는 우물 안쪽의 것 — 멀리서는 직류로 흘러들어야 낙하가 된다
            // (베이스 0.45 를 원거리에 주면 먹이가 낙하 대신 궤도를 돈다: 계측)
            const swirl = Math.min(0.86, prox * (2.2 + FRAME_DRAG))
            const gr = g * (1 - swirl * prox)
            const gt = g * swirl
            const dxy = Math.hypot(dx, dy) || 1
            b.vx += ((dx / d) * gr + (-dy / dxy) * gt) * step
            b.vy += ((dy / d) * gr + (dx / dxy) * gt) * step
            b.vz += (dz / d) * gr * step
            if (edibleB) {
              // 원반 평면화 — 먹이의 z 는 내 평면으로 스프링-감쇠 수렴한다.
              // z 정밀 정렬을 조작에 맡기면 지옥이 된다 (계측: 봇 z 진동 ±760).
              b.vz += dz * 2.6 * step
              b.vz *= Math.exp(-2.0 * step)
            }
            // 원반화 점성 — 반경 방향 속도만 죽인다. 궤도 회전은 남고,
            // z 는 내 적도면으로 가라앉는다: 원반은 그렇게 생긴다.
            const rvx = b.vx - this.vx
            const rvy = b.vy - this.vy
            const rvz = b.vz - this.vz
            const ux = dx / d
            const uy = dy / d
            const uz = dz / d
            const vr = (rvx * ux + rvy * uy + rvz * uz) * Math.exp(-step * 5 * prox)
            const kt = Math.exp(-step * 0.7 * prox * prox)
            let tx = (rvx - (rvx * ux + rvy * uy + rvz * uz) * ux) * kt
            let ty = (rvy - (rvx * ux + rvy * uy + rvz * uz) * uy) * kt
            let tz = (rvz - (rvx * ux + rvy * uy + rvz * uz) * uz) * Math.exp(-step * 2.2 * prox)
            b.vx = this.vx + ux * vr + tx - ux * (tx * ux + ty * uy + tz * uz)
            b.vy = this.vy + uy * vr + ty - uy * (tx * ux + ty * uy + tz * uz)
            b.vz = this.vz + uz * vr + tz - uz * (tx * ux + ty * uy + tz * uz)
          }
        }
      }
      if (b.free) {
        if (b.host) {
          const hx = b.host.x - b.x
          const hy = b.host.y - b.y
          const hz = b.host.z - b.z
          const hd2 = hx * hx + hy * hy + hz * hz
          const hd = Math.sqrt(hd2) || 1
          const hg = Math.min(PULL_CAP_ON_ME, (b.host.r * b.host.r * GRAV) / hd2)
          b.vx += (hx / hd) * hg * step
          b.vy += (hy / hd) * hg * step
          b.vz += (hz / hd) * hg * step
        }
        b.x += b.vx * step
        b.y += b.vy * step
        b.z += b.vz * step
      }
    }

    // 중력 — 나보다 큰 것만 나를 끈다. 커질수록 세계가 조용해진다.
    for (const b of this.active) {
      if (b.r <= R || this.eaten.has(b.id)) continue
      const dx = b.x - this.x
      const dy = b.y - this.y
      const dz = b.z - this.z
      const d2 = dx * dx + dy * dy + dz * dz
      const d = Math.sqrt(d2) || 1
      if (d > b.r * 9) continue
      const g = Math.min(PULL_CAP_ON_ME, (b.r * b.r * GRAV) / d2)
      this.vx += (dx / d) * g * step
      this.vy += (dy / d) * g * step
      this.vz += (dz / d) * g * step
    }

    // 속도 상한 — 화면 1.6장/초. 없으면 거대 스케일에서 섹터 생성 폭주 (프리즈).
    const vmax = base * 1.6
    const sp0 = Math.hypot(this.vx, this.vy, this.vz)
    if (sp0 > vmax) {
      const k = vmax / sp0
      this.vx *= k
      this.vy *= k
      this.vz *= k
    }
    const prevX = this.x
    const prevY = this.y
    const prevZ = this.z
    this.x += this.vx * step
    this.y += this.vy * step
    this.z += this.vz * step
    // z 슬랩 — 우주는 넓지만 무한히 뜨면 아무도 못 만난다
    const zMax = base * 0.8
    if (this.z > zMax) {
      this.z = zMax
      if (this.vz > 0) this.vz = 0
    } else if (this.z < -zMax) {
      this.z = -zMax
      if (this.vz < 0) this.vz = 0
    }
    this.refreshSectors()

    const dist = Math.hypot(this.x, this.y)
    if (dist > this.farthest) this.farthest = dist

    // ── 가스 스트림 강착 — 찢긴 질량은 구름으로 흘러들어와 서서히 내 것이 된다
    if (this.streamIn > 0.5) {
      const take = this.streamIn * (1 - Math.exp(-2.0 * step))
      this.vol += take
      this.streamIn -= take
      this.feed = Math.max(this.feed, 0.55)
      this.gulp = Math.max(this.gulp, 0.25)
    }

    // ── 로슈 한계 — 삼키기엔 크고 나보다 작은 것: 바짝 붙으면 조석으로 찢긴다.
    let toShred: Body[] | null = null
    for (const b of this.active) {
      if (b.hot || this.eaten.has(b.id)) continue
      if (b.r < R * EDIBLE || b.r >= R) continue
      const d = Math.hypot(b.x - this.x, b.y - this.y, b.z - this.z)
      if (d < (R + b.r) * ROCHE) (toShred ??= []).push(b)
    }
    if (toShred) for (const b of toShred) this.shred(b)

    // ── 포식 — 동시 슬롯 8. 이동 선분 스윕 + 상대속도 팽창 (터널링 방지).
    for (let i = this.absorbs.length - 1; i >= 0; i--) {
      const a = this.absorbs[i]!
      if (this.eaten.has(a.b.id) || !Number.isFinite(a.t)) {
        this.absorbs.splice(i, 1)
        continue
      }
      a.t += step / a.dur
      if (a.t >= 1) {
        this.swallow(a.b)
        this.absorbs.splice(i, 1)
      }
    }
    if (this.absorbs.length < 8) {
      // 입은 구(球)가 아니라 원반이다 — 강착은 적도면에서 일어난다. z 는 0.4 로
      // 눌러서 판정한다: 아니면 z 정렬 지옥이 온다 (계측: 봇이 2분에 1끼).
      const ZK = 0.4
      const sx = this.x - prevX
      const sy = this.y - prevY
      const sz = (this.z - prevZ) * ZK
      const segL2 = sx * sx + sy * sy + sz * sz
      outer: for (const b of this.active) {
        if (this.absorbs.length >= 8) break
        if (b.r >= R * EDIBLE || this.eaten.has(b.id)) continue
        for (let i = 0; i < this.absorbs.length; i++) {
          if (this.absorbs[i]!.b.id === b.id) continue outer
        }
        const wx = b.x - prevX
        const wy = b.y - prevY
        const wz = (b.z - prevZ) * ZK
        const tt = segL2 > 0 ? Math.max(0, Math.min(1, (wx * sx + wy * sy + wz * sz) / segL2)) : 0
        const d = Math.hypot(prevX + sx * tt - b.x, prevY + sy * tt - b.y, (prevZ + sz / ZK * tt - b.z) * ZK)
        const relV = Math.hypot(b.vx - this.vx, b.vy - this.vy, b.vz - this.vz)
        if (d < R * 1.7 + b.r + relV * step) {
          this.absorbs.push({ b, t: 0, dur: 0.42 + Math.min(0.5, (b.r / R) * 0.55) })
        }
      }
    }

    // ── 다른 검은 입들 — 성간의 사냥꾼들. 실제 블랙홀의 이름을 달고 있다.
    this.bittenCd = Math.max(0, this.bittenCd - step)
    for (let i = this.rivals.length - 1; i >= 0; i--) {
      const rv = this.rivals[i]!
      const rr = Math.cbrt(rv.vol)
      const dx = this.x - rv.x
      const dy = this.y - rv.y
      const dz = this.z - rv.z
      const d = Math.hypot(dx, dy, dz) || 1
      const bigger = rr > R
      if (d < 2400 + R * 8) {
        const dir = bigger ? 1 : -1
        const racc = thrustAcc(rr) * (bigger ? 0.44 : 0.55)
        rv.vx += (dx / d) * dir * racc * step
        rv.vy += (dy / d) * dir * racc * step
        rv.vz += (dz / d) * dir * racc * step
      }
      // 중력은 동족도 예외가 아니다 ("중력이 있는데 왜 도망다니냐" — 실플레이).
      // 작은 놈은 내가 끈다: 멀리선 도주 추진이 이기고, 너무 가까우면 발버둥치며
      // 끌려온다. 큰 놈의 중력은 나를 끈다 — 가까이 간 쪽이 잘못한 거다.
      if (!bigger && d < R * 14) {
        const g = Math.min(PULL_CAP_BY_ME, (R * R * GRAV * MAW_PULL) / (d * d))
        rv.vx += (dx / d) * g * step
        rv.vy += (dy / d) * g * step
        rv.vz += (dz / d) * g * step
      } else if (bigger && d < rr * 9) {
        const g = Math.min(PULL_CAP_ON_ME, (rr * rr * GRAV) / (d * d))
        this.vx += (-dx / d) * g * step
        this.vy += (-dy / d) * g * step
        this.vz += (-dz / d) * g * step
      }
      const rdrag = Math.exp(-0.14 * step)
      rv.vx *= rdrag
      rv.vy *= rdrag
      rv.vz *= rdrag
      rv.x += rv.vx * step
      rv.y += rv.vy * step
      rv.z += rv.vz * step
      const msx = this.x - prevX
      const msy = this.y - prevY
      const mL2 = msx * msx + msy * msy
      const mtt = mL2 > 0
        ? Math.max(0, Math.min(1, ((rv.x - prevX) * msx + (rv.y - prevY) * msy) / mL2))
        : 0
      const sd = Math.hypot(prevX + msx * mtt - rv.x, prevY + msy * mtt - rv.y, this.z - rv.z)
      const rrel = Math.hypot(rv.vx - this.vx, rv.vy - this.vy, rv.vz - this.vz)
      if (sd < (rr + R) * 0.9 + rrel * step) {
        if (bigger && this.bittenCd <= 0) {
          const stolen = this.vol * 0.26
          this.vol -= stolen
          rv.vol += stolen
          this.bittenCd = 2.5
          const kb = thrustAcc(R) * 1.4
          this.vx += (dx / d) * kb
          this.vy += (dy / d) * kb
          this.camera.shake(6, 8)
          this.sfx('hurt')
        } else if (!bigger && rr < R * EDIBLE) {
          // 합병 — 중력파가 퍼지고, 가스 고리가 뿜어져 나온다
          this.vol += rv.vol * ABSORB_GAIN
          this.gulp = 1
          this.feed = 1
          if (rr > this.biggestMeal) this.biggestMeal = Math.round(rr)
          this.eaten.add(rv.id)
          const rn = realName('hole', rv.id)
          const entry: JournalEntry = {
            name: `${rn.name} — 다른 검은 입`,
            log: rn.log,
            kind: BodyKind.Core,
            r: Math.round(rr),
            x: Math.round(rv.x),
            y: Math.round(rv.y),
          }
          this.journal.push(entry)
          this.lastFound = entry
          this.waveX = rv.x
          this.waveY = rv.y
          this.waveT = 0
          for (let g = 0; g < 14; g++) {
            const a = (g / 14) * Math.PI * 2
            this.spawnGas(rv.x, rv.y, rv.z,
              Math.cos(a) * rr * 3, Math.sin(a) * rr * 3, (g % 3 - 1) * rr,
              rr * 0.5, 0.5, 0.35, 0.6, 1.4)
          }
          this.rivals.splice(i, 1)
          this.sfx('bigKill')
          this.persist()
        }
      }
    }
    this.gulp = Math.max(0, this.gulp - step * 2.2)
    this.feed = Math.max(0, this.feed - step * 0.8)
    this.waveT += step

    // 가스 — 살아있는 연기. 내 쪽으로 약하게 감긴다
    for (const g of this.gas) {
      if (g.life <= 0) continue
      g.life -= step
      const dx = this.x - g.x
      const dy = this.y - g.y
      const d = Math.hypot(dx, dy) || 1
      if (d < R * 10) {
        const pull = Math.min(300, (R * R * GRAV) / (d * d)) * step
        g.vx += (dx / d) * pull + (-dy / d) * pull * 0.7
        g.vy += (dy / d) * pull + (dx / d) * pull * 0.7
      }
      g.x += g.vx * step
      g.y += g.vy * step
      g.z += g.vz * step
      g.size += step * g.size * 0.4 // 연기는 번진다
    }

    // 나침반 — 티끌이 아니라 "한 입"(내 크기 12% 이상)을 우선으로 가리킨다.
    // 거대해진 몸에게 부스러기 화살표는 모욕이다 (실플레이 "동전 위만 보라는 거냐").
    this.preyDist = Infinity
    let crumbDist = Infinity
    let cX = 0
    let cY = 0
    let cZ = 0
    for (const b of this.active) {
      if (b.r >= R * EDIBLE || this.eaten.has(b.id)) continue
      const d = Math.hypot(b.x - this.x, b.y - this.y, b.z - this.z)
      if (b.r >= R * 0.12) {
        if (d < this.preyDist) {
          this.preyDist = d
          this.preyX = b.x
          this.preyY = b.y
          this.preyZ = b.z
        }
      } else if (d < crumbDist) {
        crumbDist = d
        cX = b.x
        cY = b.y
        cZ = b.z
      }
    }
    if (this.preyDist === Infinity && crumbDist < Infinity) {
      this.preyDist = crumbDist
      this.preyX = cX
      this.preyY = cY
      this.preyZ = cZ
    }

    // 등급
    const rank = rankOf(this.radius)
    if (rank !== this.lastRank) {
      this.lastRank = rank
      this.rankUp = rank
      this.gulp = 1
      this.sfx('evolve')
      this.persist()
    }

    this.persistCd -= step
    if (this.dirty && this.persistCd <= 0) this.persist()

    // 카메라 — 줌아웃이 곧 성장. 속도 확폭도 화면 눈금 비례.
    const speed = Math.hypot(this.vx, this.vy)
    const targetView = base + Math.min(1, speed / (base * 0.74)) * base * 0.95
    this.camera.viewHeight += (targetView - this.camera.viewHeight) * (1 - Math.exp(-1.3 * dt))
    this.camera.follow(this.x + this.vx * 0.3, this.y + this.vy * 0.3, dt, 3.4)
    this.camera.update(dt)
  }

  private spawnGas(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    size: number, cr: number, cg: number, cb: number, life: number,
  ): void {
    const g = this.gas[this.gasIdx]!
    this.gasIdx = (this.gasIdx + 1) % GAS_MAX
    g.x = x
    g.y = y
    g.z = z
    g.vx = vx
    g.vy = vy
    g.vz = vz
    g.size = size
    g.cr = cr
    g.cg = cg
    g.cb = cb
    g.life = life
    g.max = life
  }

  /** 이름 — 등록부(실지도) 먼저, 그다음 실명 풀, 이름 없는 티끌만 절차 이름. */
  private nameBody(b: Body): RealName {
    const reg = nameOf(b.id)
    if (reg) return reg
    const px = Math.hypot(b.x, b.y)
    switch (b.kind) {
      case BodyKind.Sun:
        return b.r < 55 ? realName('brown', b.id)
          : realName(px < pxOf(600) ? 'sunBright' : 'sunHyper', b.id)
      case BodyKind.Garden:
        return realName('nebula', b.id)
      case BodyKind.Core:
        return realName('galaxy', b.id)
      case BodyKind.Comet:
        return realName('interstellar', b.id)
      case BodyKind.Ringed:
      case BodyKind.Rock:
        return realName('planet', b.id)
      default:
        return b.r >= 10
          ? realName('asteroid', b.id)
          : { name: starName(b.id), log: starLog(b.id) }
    }
  }

  /** 삼킴 확정 — 부피·운동량(3D)·명부·TDE 가스 분출. */
  private swallow(b: Body): void {
    const R = this.radius
    this.eaten.add(b.id)
    const bMass = b.r * b.r * b.r
    // 운동량 보존 — 부피 가산 **전에** 비율을 잡는다 (이중 계상 방지)
    const f = bMass / (this.vol + bMass)
    this.vx += (b.vx - this.vx) * f
    this.vy += (b.vy - this.vy) * f
    this.vz += (b.vz - this.vz) * f
    this.vol += bMass * ABSORB_GAIN
    this.gulp = Math.min(1, b.r / R + 0.25)
    this.eatCount += 1
    if (b.r > this.biggestMeal) this.biggestMeal = Math.round(b.r)
    const idx = this.active.indexOf(b)
    if (idx >= 0) this.active.splice(idx, 1)
    // TDE — 큰 식사는 깔끔하지 않다: 일부가 뜨거운 가스로 뿜어져 나간다 (구름이지 조각이 아니다)
    if (b.r > R * 0.5) {
      this.feed = 1
      for (let g = 0; g < 10; g++) {
        const a = (g / 10) * Math.PI * 2 + b.id % 3
        this.spawnGas(this.x, this.y, this.z,
          Math.cos(a) * R * 4, Math.sin(a) * R * 4, ((g % 3) - 1) * R * 1.5,
          b.r * 0.5, Math.min(1.2, b.cr * 1.3), b.cg * 0.8, b.cb * 0.6, 1.6)
      }
      this.sfx('boom')
    }
    this.sfx(b.r > R * 0.45 ? 'evolve' : 'pickup')
    if (b.kind !== BodyKind.Dust || b.r >= 10) {
      const rn = b.hot ? null : this.nameBody(b)
      const entry: JournalEntry = {
        name: rn ? rn.name : `${starName(b.id)}의 잔해`,
        log: rn ? rn.log : '내 조석이 그것을 먼저 찢었다.',
        kind: b.kind,
        r: Math.round(b.r),
        x: Math.round(b.x),
        y: Math.round(b.y),
      }
      this.journal.push(entry)
      this.lastFound = entry
      this.persistSoon()
    } else {
      this.dirty = true
    }
  }

  /**
   * 로슈 조석 파괴 — 조각이 아니라 **가스 스트림**이다 (실제 TDE 처럼).
   * 질량 절반은 연기 리본으로 감기며 서서히 내 것이 되고(streamIn),
   * 단단한 심 두 개만 얼음으로 남아 튕겨 나간다. 통째(0.85)보다 손해 — 조급함의 세금.
   */
  private shred(b: Body): void {
    this.eaten.add(b.id)
    const idx = this.active.indexOf(b)
    if (idx >= 0) this.active.splice(idx, 1)
    const bMass = b.r * b.r * b.r
    this.streamIn += bMass * SHRED_STREAM
    // 가스 리본 — 모체에서 내 쪽으로 감기는 연기 사슬
    const n = 12
    for (let i = 0; i < n; i++) {
      const t = i / n
      const gx = b.x + (this.x - b.x) * t * 0.5
      const gy = b.y + (this.y - b.y) * t * 0.5
      const a = Math.atan2(gy - this.y, gx - this.x) + 1.6
      this.spawnGas(gx, gy, b.z + (this.z - b.z) * t * 0.5,
        Math.cos(a) * (60 + t * 200) + b.vx, Math.sin(a) * (60 + t * 200) + b.vy, b.vz * 0.5,
        b.r * (0.35 + t * 0.3), Math.min(1.3, b.cr * 1.4), b.cg * 0.9, b.cb * 0.7,
        0.9 + t * 0.9)
    }
    // 단단한 심 — 재회수 가능한 얼음 (질량 소수)
    this.spawnCores(b)
    this.gulp = Math.max(this.gulp, 0.6)
    this.feed = Math.max(this.feed, 0.55)
    this.camera.shake(3, 7)
    if (b.kind !== BodyKind.Dust || b.r >= 10) {
      const entry: JournalEntry = {
        name: `${this.nameBody(b).name} — 조석 파괴`,
        log: '삼키기엔 컸다. 그래서 찢었다.',
        kind: b.kind,
        r: Math.round(b.r),
        x: Math.round(b.x),
        y: Math.round(b.y),
      }
      this.journal.push(entry)
      this.lastFound = entry
      this.persistSoon()
    } else {
      this.dirty = true
    }
    this.sfx('kill')
  }

  /** 조석 파괴의 심 — 2개. 최소 크기는 내 몸 상대(≤0.35R): 연쇄 파쇄 방지. */
  private spawnCores(b: Body): void {
    if (this.active.length > 1200) return
    const sx = Math.floor(b.x / SECTOR)
    const sy = Math.floor(b.y / SECTOR)
    const list = this.sectorBodies(sx, sy)
    const minR = Math.min(2.2, this.radius * 0.35)
    for (let i = 0; i < 2; i++) {
      const dSeed = hashSeed(`${b.id}:sh:${i}`)
      if (this.eaten.has(dSeed)) continue
      const a = i * Math.PI + (dSeed % 100) * 0.01
      const pr = Math.max(minR, b.r * (SHRED_CORE + ((dSeed >>> 5) % 30) * 0.003))
      const d = this.newBody(dSeed, BodyKind.Dust,
        b.x + Math.cos(a) * b.r * 0.7, b.y + Math.sin(a) * b.r * 0.7, pr,
        Math.min(1.4, b.cr * 1.5), Math.min(1.2, b.cg * 1.2), b.cb * 0.8)
      d.z = b.z
      d.free = true
      d.hot = true
      const speed = 150 + this.radius * 1.2
      d.vx = Math.cos(a) * speed * 0.3 + -Math.sin(a) * speed * 0.8 + b.vx
      d.vy = Math.sin(a) * speed * 0.3 + Math.cos(a) * speed * 0.8 + b.vy
      d.vz = b.vz
      list.push(d)
      this.active.push(d)
    }
  }

  // ── 렌더 — 위에서 내려다보는 3D: 위에 있으면 크고 빠르게, 아래면 작고 어둡게.

  render(renderer: Renderer): void {
    const cam = this.camera
    const view = cam.toView(renderer.width, renderer.height)
    const t = this.visualTime
    const R = this.radius
    renderer.cosmos.holeX = this.x
    renderer.cosmos.holeY = this.y
    renderer.cosmos.holeR = R
    renderer.cosmos.intensity = 0.42 + this.feed * 0.3
    renderer.cosmos.beat = this.gulp
    renderer.cosmos.feed = this.feed
    renderer.cosmos.diskIn = R * 1.35
    renderer.cosmos.diskOut = R * 3.1
    this.tintByRegion(renderer)
    renderer.begin(view, t)
    const b = renderer.batch
    const cullR = cam.visibleRadius(renderer.width, renderer.height)
    /** 원근 — 카메라는 내 평면 위 F 높이에 떠 있다 */
    const F = cam.viewHeight * 1.35

    let preyOnScreen = false
    for (const body of this.active) {
      const depth = F + (this.z - body.z)
      if (depth < F * 0.18) continue // 카메라 코앞 위 — 스킵
      const persp = Math.min(3, F / depth)
      const px = cam.x + (body.x - cam.x) * persp
      const py = cam.y + (body.y - cam.y) * persp
      const pr = body.r * persp
      const dx = px - cam.x
      const dy = py - cam.y
      const margin = cullR + pr * 4
      if (dx * dx + dy * dy > margin * margin) continue
      let ab: Absorb | null = null
      for (let i = 0; i < this.absorbs.length; i++) {
        if (this.absorbs[i]!.b.id === body.id) {
          ab = this.absorbs[i]!
          break
        }
      }
      if (ab) {
        this.renderAbsorbing(b, body, ab.t)
      } else {
        if (body.r < R * EDIBLE && dx * dx + dy * dy < cullR * cullR * 0.6) preyOnScreen = true
        this.renderBody(b, body, t, R, px, py, persp)
      }
    }

    // 가스 — 구름과 연기
    for (const g of this.gas) {
      if (g.life <= 0) continue
      const depth = F + (this.z - g.z)
      if (depth < F * 0.18) continue
      const persp = Math.min(3, F / depth)
      const gx = cam.x + (g.x - cam.x) * persp
      const gy = cam.y + (g.y - cam.y) * persp
      const k = g.life / g.max
      b.push(gx, gy, g.size * persp, g.x * 0.01 + t * 0.2,
        g.cr * k, g.cg * k, g.cb * k, k * 0.55, Shape.Smoke)
    }

    // 나침반 — 화면에 먹이가 없으면 가장 가까운 먹이 쪽 가장자리에 금색 표식
    if (!preyOnScreen && this.preyDist < Infinity) {
      const a = Math.atan2(this.preyY - this.y, this.preyX - this.x)
      const rr = cam.viewHeight * 0.4
      b.push(
        cam.x + Math.cos(a) * rr, cam.y + Math.sin(a) * rr, 14 + Math.sin(t * 4) * 3,
        a, 0.9, 0.75, 0.3, 0.8, Shape.Husk,
      )
      // 위/아래 표시 — 먹이가 다른 층에 있으면 겹화살
      const zd = this.preyZ - this.z
      if (Math.abs(zd) > cam.viewHeight * 0.12) {
        b.push(
          cam.x + Math.cos(a) * rr, cam.y + Math.sin(a) * rr + (zd > 0 ? 26 : -26), 9,
          zd > 0 ? Math.PI / 2 : -Math.PI / 2, 0.7, 0.6, 0.25, 0.7, Shape.Husk,
        )
      }
    }

    // 합병 중력파
    if (this.waveT < 1.6) {
      const k = this.waveT / 1.6
      b.push(this.waveX, this.waveY, 60 + k * 900, 0, 0.5 * (1 - k), 0.45 * (1 - k), 0.6 * (1 - k), (1 - k) * 0.8, Shape.Ring)
      b.push(this.waveX, this.waveY, 30 + k * 620, 0, 0.4 * (1 - k), 0.3 * (1 - k), 0.5 * (1 - k), (1 - k) * 0.7, Shape.Ring)
    }

    // 다른 검은 입들
    for (const rv of this.rivals) {
      const rr = Math.cbrt(rv.vol)
      const depth = F + (this.z - rv.z)
      if (depth < F * 0.18) continue
      const persp = Math.min(3, F / depth)
      const px = cam.x + (rv.x - cam.x) * persp
      const py = cam.y + (rv.y - cam.y) * persp
      const dx = px - cam.x
      const dy = py - cam.y
      const margin = cullR + rr * persp * 3
      if (dx * dx + dy * dy > margin * margin) continue
      const threat = rr > R
      renderer.shadows.push(px, py, rr * persp * 1.06, 0, 0, 0, 0, 0.96, Shape.Orb)
      b.push(px, py, rr * persp * 1.16, t * 0.5,
        threat ? 1.7 : 0.8, threat ? 0.3 : 0.7, threat ? 0.25 : 0.6, 1, Shape.Ring)
      b.push(px, py, rr * persp * 1.6, -t * 0.3, 0.3, 0.1, 0.3, 0.7, Shape.Vortex)
    }

    // 나 — 지평선·렌즈는 cosmos 셰이더가. 배치는 그 위의 살아있는 것만.
    const gp = 1 + this.gulp * 0.22
    renderer.shadows.push(this.x, this.y, R * 1.04, 0, 0, 0, 0, 0.96, Shape.Orb)
    b.push(this.x, this.y, R * 1.15 * gp, t * 0.4, 1.5, 1.18, 0.75, 0.9, Shape.Ring)
    b.push(this.x, this.y, R * 1.75 * gp, -t * 0.22, 0.35, 0.14, 0.4, 0.8, Shape.Vortex)
    if (this.thrusting) {
      b.push(
        this.x - Math.cos(this.heading) * R * 1.5, this.y - Math.sin(this.heading) * R * 1.5,
        R * 0.5, this.heading, 0.9, 0.5, 0.25, 0.7, Shape.Spark,
      )
    }

    renderer.end(t, 0, 0, 1)
  }

  private static readonly PALETTES: readonly (readonly [number, number, number])[] = [
    [0.32, 0.14, 0.62], [0.06, 0.34, 0.5],
    [0.5, 0.16, 0.3], [0.12, 0.2, 0.55],
    [0.1, 0.4, 0.34], [0.3, 0.3, 0.14],
    [0.45, 0.28, 0.1], [0.1, 0.16, 0.5],
    [0.2, 0.1, 0.5], [0.4, 0.12, 0.42],
    [0.08, 0.3, 0.55], [0.35, 0.35, 0.5],
  ]

  private tintRx = 1e9
  private tintRy = 1e9
  private tintH = 0

  private tintByRegion(renderer: Renderer): void {
    const rx = Math.floor(this.x / (SECTOR * 3))
    const ry = Math.floor(this.y / (SECTOR * 3))
    if (rx !== this.tintRx || ry !== this.tintRy) {
      this.tintRx = rx
      this.tintRy = ry
      this.tintH = hashSeed(`${UNIVERSE_SEED}:rg:${rx}:${ry}`)
    }
    const P = Voyage.PALETTES
    const a = P[this.tintH % P.length]!
    const bb = P[(this.tintH >>> 4) % P.length]!
    renderer.cosmos.lerpTint(a, bb, 0.015)
  }

  /** 삼켜지는 중 — 가스 리본이 나선을 그리며 늘어난다 (스파게티화 + 적색편이). */
  private renderAbsorbing(b: Renderer['batch'], body: Body, k: number): void {
    const ease = 1 - Math.pow(1 - k, 1.7)
    const baseAng = Math.atan2(body.y - this.y, body.x - this.x)
    const d0 = Math.hypot(body.x - this.x, body.y - this.y)
    // 연기 리본 4매듭 — 조각이 아니라 흐름으로 읽힌다
    for (let i = 0; i < 4; i++) {
      const kk = Math.max(0, ease - i * 0.12)
      const ang = baseAng + kk * 3.1
      const d = d0 * (1 - kk)
      const bx = this.x + Math.cos(ang) * d
      const by = this.y + Math.sin(ang) * d
      const red = 1 + kk * 0.9
      const dim = 1 - kk * 0.55
      b.push(bx, by, body.r * (1 - kk * 0.5) * (1 - i * 0.16), ang,
        body.cr * red * (1 - i * 0.15), body.cg * dim * 0.8, body.cb * dim * 0.6,
        (1 - kk * 0.3) * (1 - i * 0.18), i === 0 ? Shape.Orb : Shape.Smoke)
    }
  }

  private renderBody(
    b: Renderer['batch'], body: Body, t: number, myR: number,
    x: number, y: number, persp: number,
  ): void {
    const r = body.r * persp
    const { cr, cg, cb } = body
    const s = body.id % 6.283
    /** 깊이 밝기 — 아래(작게 보임)는 어둡다: z 를 눈이 읽는 두 번째 단서 */
    const dimZ = 0.55 + 0.45 * Math.min(1, persp)
    const lod = r / this.camera.viewHeight
    const edible = body.r < myR * EDIBLE
    // 아주 먼 것(작은 것)은 점 하나 — 거대 스케일 성능의 방벽.
    // 단 "한 입"이 되는 것은 화면 최소 크기를 보장하고 금테를 두른다 —
    // 동전이 아니라 표적으로 읽혀야 한다 (실플레이).
    if (lod < 0.011) {
      const meaty = edible && body.r >= myR * 0.12
      const vis = meaty ? Math.max(r, this.camera.viewHeight * 0.0055) : Math.max(2.5, r)
      b.push(x, y, vis, s, cr * 0.6 * dimZ, cg * 0.6 * dimZ, cb * 0.65 * dimZ, 0.9, Shape.Mote)
      if (meaty) {
        b.push(x, y, vis * 2 + 8, t * 0.8, 0.42, 0.36, 0.16, 0.55, Shape.Ring)
      } else if (edible && lod > 0.005) {
        b.push(x, y, r * 1.6 + 10, t * 0.8, 0.35, 0.3, 0.14, 0.4, Shape.Ring)
      }
      return
    }
    // 조석 융기 — 내 곁의 작은 것은 내 쪽으로 쓸려 보인다
    const ddx = this.x - body.x
    const ddy = this.y - body.y
    const dd = Math.hypot(ddx, ddy) || 1
    if (body.r < myR && dd < myR * 7 && !edible) {
      const pull = Math.min(10, (myR * 26) / dd)
      x += (ddx / dd) * pull
      y += (ddy / dd) * pull
      b.push(x + (ddx / dd) * r * 0.8, y + (ddy / dd) * r * 0.8, r * 0.5,
        Math.atan2(ddy, ddx), cr * 0.5, cg * 0.4, cb * 0.4, 0.5, Shape.Spark)
    }
    if (edible) b.push(x, y, r * 1.5 + 12, t * 0.8, 0.4, 0.34, 0.16, 0.5, Shape.Ring)
    switch (body.kind) {
      case BodyKind.Dust:
        if (body.hot) {
          b.push(x, y, r * 1.1, s + t * 2, 1.3 * dimZ, 0.7 * dimZ, 0.3, 1, Shape.Mote)
          b.push(x - body.vx * 0.04, y - body.vy * 0.04, r * 0.8, Math.atan2(body.vy, body.vx), 0.8, 0.4, 0.15, 0.6, Shape.Spark)
        } else {
          b.push(x, y, r, s + t * 0.3, cr * 0.5 * dimZ, cg * 0.5 * dimZ, cb * 0.55 * dimZ, 1, Shape.Mote)
        }
        break
      case BodyKind.Comet: {
        let ta = Math.atan2(-body.vy, -body.vx)
        if (body.host && body.host.kind === BodyKind.Sun) {
          ta = Math.atan2(body.y - body.host.y, body.x - body.host.x)
        }
        b.push(x, y, r, ta + Math.PI, 1.1 * dimZ, 1.0 * dimZ, 0.95 * dimZ, 1, Shape.Comet)
        for (let k = 1; k <= 7; k++) {
          // 가스 꼬리 — 연기가 반태양으로 흩날린다
          b.push(
            x + Math.cos(ta) * k * r * 0.6, y + Math.sin(ta) * k * r * 0.6,
            r * (1 - k / 10) * 1.2, ta,
            (0.3 / k + 0.08) * dimZ, (0.35 / k + 0.1) * dimZ, (0.5 / k + 0.14) * dimZ, 0.55,
            Shape.Smoke,
          )
        }
        break
      }
      case BodyKind.Rock: {
        b.push(x, y, r, t * 0.03 + s, cr * 0.8 * dimZ, cg * 0.8 * dimZ, cb * 0.9 * dimZ, 1, Shape.Orb)
        b.push(x - r * 0.26, y - r * 0.22, r * 0.55, 0, cr * 0.35, cg * 0.35, cb * 0.4, 0.6, Shape.Orb)
        break
      }
      case BodyKind.Ringed: {
        b.push(x, y, r, t * 0.04 + s, cr * 0.75 * dimZ, cg * 0.75 * dimZ, cb * 0.85 * dimZ, 1, Shape.Orb)
        b.push(x + r * 0.28, y + r * 0.22, r * 0.72, 0, cr * 0.2, cg * 0.2, cb * 0.28, 0.5, Shape.Orb)
        const motes = lod > 0.05 ? 22 : 10
        for (let k = 0; k < motes; k++) {
          const a = (k / motes) * Math.PI * 2 + t * 0.1
          const rr = r * (1.6 + ((k * 0.618) % 1) * 0.5)
          let mxx = x + Math.cos(a) * rr
          let myy = y + Math.sin(a) * rr * 0.4
          if (dd < myR * 6 && body.r < myR) {
            const mk = Math.min(14, (myR * 30) / dd)
            mxx += (ddx / dd) * mk
            myy += (ddy / dd) * mk
          }
          b.push(mxx, myy, Math.max(2.5, r * 0.06), a, cr * 0.45, cg * 0.45, cb * 0.55, 1, Shape.Mote)
        }
        break
      }
      case BodyKind.Sun: {
        const pulse = 1 + Math.sin(t * 0.7 + s) * 0.04
        const flick = 1 + Math.sin(t * 5.3 + s * 3) * 0.05
        b.push(x, y, r * 2.4 * pulse, 0, cr * 0.45 * dimZ, cg * 0.35 * dimZ, 0.08, 0.6, Shape.Orb)
        b.push(x, y, r * pulse, t * 0.08, 1.8 * flick * dimZ, 1.35 * flick * dimZ, 0.55, 1, Shape.Orb)
        if (lod > 0.03) b.push(x, y, r * 1.9, t * 0.11 + s, cr * 0.3, cg * 0.22, 0.05, 0.35, Shape.Nova)
        break
      }
      case BodyKind.Garden: {
        // 성운은 구름이다 — 연기 밑그림 위에 별 모트
        b.push(x, y, r * 1.3, s + t * 0.02, cr * 0.28 * dimZ, cg * 0.3 * dimZ, cb * 0.4 * dimZ, 0.5, Shape.Smoke)
        b.push(x + r * 0.3, y - r * 0.2, r * 0.9, s * 2 - t * 0.015, cr * 0.22, cg * 0.26, cb * 0.34, 0.45, Shape.Smoke)
        const motes = lod > 0.05 ? 40 : 16
        for (let k = 0; k < motes; k++) {
          const a = k * 2.39996 + t * 0.03
          const rr = r * Math.sqrt(((k * 0.618) % 1))
          b.push(
            x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, Math.max(3, r * 0.05),
            a, cr * 0.4, cg * 0.55, cb * 0.5, 0.9, Shape.Mote,
          )
        }
        break
      }
      case BodyKind.Core: {
        b.push(x, y, r * 1.5, t * 0.06 + s, cr * 0.5 * dimZ, cg * 0.4 * dimZ, cb * 0.7 * dimZ, 1, Shape.Vortex)
        b.push(x, y, r * 0.5, -t * 0.15, 1.7, 1.5, 1.2, 1, Shape.Orb)
        const motes = lod > 0.05 ? 50 : 20
        for (let k = 0; k < motes; k++) {
          const arm = k % 2
          const tt = k / motes
          const a = tt * 9 + arm * Math.PI + t * 0.06
          const rr = r * (0.3 + tt * 1.1)
          b.push(
            x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, Math.max(3, r * 0.045),
            a, cr * 0.6 * (1 - tt * 0.5), cg * 0.5, cb * 0.7, 0.9, Shape.Mote,
          )
        }
        break
      }
    }
  }
}

export { STORE_KEY }
