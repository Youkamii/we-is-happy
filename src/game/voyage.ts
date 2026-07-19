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
import { HOLES, KUIPER, PROBES, SHELL, STAR_MAP, pxOf, type MapSystem } from './starmap'
import { nameOf, registerName } from './starnames'

/** 섹터 시드 상수 — 절차 채움(오르트 얼음·떠돌이)의 결정론 유지 */
export const UNIVERSE_SEED = 20260718

/** 실지도 항성계의 몸체 id — 다음 항로 나침반이 "이미 삼킨 계"를 거르는 데 쓴다 */
const MAP_IDS: readonly number[] = STAR_MAP.map((s) => hashSeed(`map:${s.name}`))

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
/**
 * 파괴 상수 — 접촉 잠식(bite)의 속도 눈금. **파괴와 성장은 분리다**: 세계는
 * R^1.6 눈금으로 순식간에 무너지고(지구 2초·태양은 R7 공성 20초), 내 성장은
 * 질량 비례 소화(5%/s)가 따로 늦춘다. 5400 은 "성장 가속 없이 R7 정지 상태로
 * 태양 공성 20초"가 나오는 값 (구 560 은 공성 중 성장 폭주가 시간을 채우던
 * 시절의 눈금 — 소화 분리 후 192초가 되어 재보정).
 */
const EDDINGTON = 5400
/** 로슈 접근 배율 — (R + r) 의 이 배수 안이면 조석 파괴 */
const ROCHE = 1.3
/** 밀도 의존 조석 반경 — R_T ∝ (M/ρ)^⅓: 바위는 툭 삼켜지고 별·성운은 멀리서
 * 국수처럼 풀린다 (조사 ②-2, Rees/로슈) */
function rocheOf(kind: BodyKindType): number {
  switch (kind) {
    case BodyKind.Rock:
    case BodyKind.Ringed: return 1.05
    case BodyKind.Sun: return 1.55
    case BodyKind.Garden:
    case BodyKind.Core: return 1.7
    default: return 1.15
  }
}
/** 삼킨 부피의 성장 환산 배율 */
const ABSORB_GAIN = 1.15
/**
 * 블랙홀 점진 압축 — 같은 질량이면 별보다 훨씬 작다 (실제: 태양 질량 블랙홀 = 3km).
 * 밀도가 크기에 비례해 커져(D = 3 + 0.9R) 성장 지수가 ⅓ → ¼ 로 자연 감속한다:
 * 초반 한 입은 경쾌하고, 후반의 우주는 오래도록 압도적으로 거대하다 (실플레이
 * "존나 빨리 커져서 압도감이 죽는다"의 수리). 태양 하나 ≈ R30, 베텔게우스 ≈ R250.
 */
function bhDensity(r: number): number {
  return 3 + 0.9 * r
}

/** 반지름 → 부피 (테스트·콘솔용): 이 부피를 넣으면 그 반지름이 된다 */
export function volFor(radius: number): number {
  return radius * radius * radius * bhDensity(radius)
}

/** 부피 → 블랙홀 반지름 (고정점 4회 — 결정론·저비용). 라이벌도 같은 눈금. */
export function bhRadius(vol: number): number {
  let r = Math.cbrt(vol / 9)
  for (let i = 0; i < 4; i++) r = Math.cbrt(vol / bhDensity(r))
  return r
}

/**
 * 시각 몸 반지름 — R(영향권·조석 사거리)과 분리된 "화면에 그리는 검은 몸".
 * 실물리: 지구를 통째로 먹어도 지평선은 +9mm, 조석 반경은 +2,556km — 몸은
 * 거의 안 크고 사거리만 폭증한다 (손톱 블랙홀 조사, 2026-07-18). 판정·물리는
 * 전부 R 그대로고 이건 렌더 전용이다. R1.8(시작)에선 몸=R, 태양을 삼킨
 * R90에서 몸 12.6(영향권의 1/7), R1500에서 41(1/36).
 */
export function bodyRof(radius: number): number {
  // **진짜 슈바르츠실트 눈금** — r_s ∝ 질량(선형). 태양 84개(R90)를 먹어도
  // 0.35px 점이지만, ~140 태양질량부터 눈에 보이기 시작해 ~12만 태양질량
  // (R≈554)에서 영향권을 따라잡는다 — 그때부터 몸이 곧 영향권: 초대질량의
  // 위용이다 (궁수자리 A* = 태양 반지름 18배 — 실물리).
  // "안 커진다가 아니라 커지는 방식이 틀렸다"(실플레이)의 정답 곡선.
  // 계수 5.8e-9 = (2.95km/태양질량 729,000vol) ÷ (700km/px).
  return Math.min(radius, Math.max(0.5, volFor(radius) * 5.8e-9))
}
/** 조석 파괴에서 가스 스트림으로 흘러드는 비율 — 통째보다 손해: 조급함의 세금 */
/** 잔해 반반 법칙 — 조석 파괴 질량의 절반만 강착, 절반은 탈속박 사출 (Rees 1988) */
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
  /** 반지름 — 접촉 잠식으로 깎일 수 있다 (블랙홀은 크기가 아니라 밀도다) */
  r: number
  /** 태어날 때의 반지름 — 항성이 이것의 55% 밑으로 깎이면 별의 죽음이 온다 */
  r0: number
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
  /** 파편의 출신 — 원본의 실명. 파편을 먹으면 이 이름이 뜬다 (절차 이름 금지) */
  origin?: string
  /** 각운동량 사형선고 — L < L_crit 로 탈출이 물리적으로 불가능해진 것 (조사 ②-10) */
  doomed?: boolean
  /** 스파게티 예열 0..1 — 찢김 직전의 신장 (조사 ②-15, 렌더가 늘린다) */
  stretch?: number
  /** 증발 시한 (초) — 원시 블랙홀 불씨: 제때 못 삼키면 최후 폭발 (조사 ②-20) */
  decay?: number
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
 * 앵커는 카메라 바닥(130px 화면)에서 62.4 = 예전 950px 화면의 456 과 같은
 * 화면 체감(0.48화면/s²)이다.
 */
function thrustAcc(radius: number): number {
  return 62.4 * Math.pow(Math.max(40, radius * 26) / 130, 0.85)
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

/** 은하화 — 포획된 잔챙이. 내 주위를 영원히 돈다 (반지름 배수 k 로 저장: 은하가 나와 함께 자란다) */
export interface HaloStar {
  k: number
  ang: number
  w: number
  inc: number
  size: number
  cr: number
  cg: number
  cb: number
  /** 나선팔 소속 (0/1) — 밀도파: 팔은 물질이 아니라 정체 구간이다 */
  arm: number
  /** 별 나이 (초) — 갓 태어난 별은 청백색, 늙으면 붉게 식는다 */
  age: number
  /** 0 팽대부(붉고 둥근 궤도) / 1 원반(얇고 젊다) / 2 헤일로(성긴 외곽) */
  tier: number
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
/**
 * 시작 부피 — R≈1.8: **진짜 티끌**. 지구(9.2)의 1/5, 목성(32)의 1/18, 태양(90)의
 * 1/50. 예전 R7 은 시작부터 토성의 1/4 이라 "왜 시작부터 토성만 해?"가 됐다
 * (실플레이). 코딱지의 눈높이(카메라 바닥 130px)에서 행성은 거대해야 한다.
 */
const START_VOL = 27

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
  /** 캐시 밖으로 끌려간 천체들 — 항상 활성, 섹터가 돌아오면 재편입 */
  private readonly wanderers: Body[] = []
  readonly active: Body[] = []
  private activeKey = ''
  private readonly eaten = new Set<number>()
  private solSun: Body | null = null

  // ── 포식
  readonly absorbs: Absorb[] = []
  /** 은하화 — 내가 거느린 별들. 커질수록 은하가 된다 */
  readonly halo: HaloStar[] = []
  /** 가스 스트림으로 흘러드는 중인 부피 — 조석 파괴의 수확은 구름으로 온다 */
  private streamIn = 0
  /** t^(−5/3) 재강착 저장고 — 대어의 잔해가 궤도를 돌다 되돌아온다 (TDE) */
  private readonly fallbacks: { amt: number; t: number }[] = []
  /** 스핀 a* 0..0.998 — 순행으로 먹으면 오르고, 소화 효율·제트가 따라온다 */
  spin = 0.3

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
  private gulp = 0
  feed = 0
  private bittenCd = 0
  /** 중력파 — 합병 지점에서 시공의 고리가 퍼진다 (렌더가 읽는다) */
  waveX = 0
  waveY = 0
  waveZ = 0
  waveT = 1e9
  /** 나선낙하 — 합병 직전, 서로를 미친 속도로 감아 도는 단계 (LIGO) */
  merging: { ang: number; rad: number; w: number; t: number; vol: number; z: number; name: string } | null = null
  private nibbleCd = 0
  private driftCd = 3
  private driftN = 0
  /** 퀘이사 게이지 0..1 — 폭식이 이어지면 AGN 점화: 원반·블룸·제트가 타오른다 */
  quasar = 0
  private jetCd = 0
  private cometCd = 0
  /** 나침반 대상 — 3D 렌더러(main)가 화면 화살표로 그린다 */
  preyX = 0
  preyY = 0
  preyZ = 0
  preyDist = Infinity
  /** 성간 순항 배율 — 먹이도 천체도 없는 공허에서만 붙는다 (HUD 가 읽는다) */
  cruise = 1
  /** 궤도 관성 권위 0..1 — 지배 재진입 시 스냅 대신 서서히 (교차 검증 수리) */
  private domS = 0
  /** 자동 항법 중인가 — z 수렴 같은 보조는 이때만 (main 이 매 프레임 세팅) */
  navAssist = false
  /** 클릭 지정 목적지 — 속도·제동·z 수렴이 전부 이 좌표 기준 (main 세팅) */
  navOn = false
  navX = 0
  navY = 0
  navZ = 0
  /** 질량 과부하 (H 홀드) — 유효 질량 ×1000 (main 이 매 프레임 세팅) */
  surge = false
  private runT = 0
  private refreshCd = 0
  private nearAny = Infinity
  /** 다음 항로 — 근처에 먹을 게 없으면 나침반이 별 지도의 목적지를 가리킨다 */
  routeName: string | null = null
  routeDist = 0
  routeX = 0
  routeY = 0
  routeZ = 0
  /** 현재 지역 이름 — 바뀔 때만 화면에 뜬다 (태양계/카이퍼 벨트/오르트 구름/항성계명) */
  region = ''
  private regionCd = 0
  private mapNearS = 1e9
  private preyLockId = 0

  private readonly gas: Gas[] = []
  private gasIdx = 0

  get radius(): number {
    return bhRadius(this.vol)
  }

  /** 소화 중인 질량 — 이미 내 것이지만 아직 몸에 반영 안 된 것 (HUD 합산용) */
  get digesting(): number {
    return this.streamIn
  }

  /** 베켄슈타인-호킹 엔트로피 — S ∝ M² (지평선 면적). 절대 줄지 않는 성장 눈금 */
  get entropy(): number {
    return this.vol * this.vol
  }

  get eatenThisRun(): number {
    return this.eatCount
  }

  /** 지구→블랙홀 붕괴 진행 0..1 — 시작 30초(중력 유예와 같은 시계).
   *  렌더가 이 값으로 지구 껍질을 조여 그린다 ("붕괴 과정 보여주고": 사용자) */
  get morph(): number {
    return Math.min(1, this.runT / 30)
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
    // 씨앗 3채널 — 회차마다 다른 기원 (조사 ②-18): 원시 블랙홀(티끌) →
    // Pop III 항성 잔해(자갈) → 직접 붕괴(무거운 씨앗). 우주의 실제 씨앗 문제.
    const seedCh = this.voyages % 3
    this.vol = seedCh === 1 ? 422 : seedCh === 2 ? 5200 : START_VOL
    this.spin = 0.3
    this.journal.length = 0
    this.eaten.clear()
    this.farthest = 0
    this.lastFound = null
    this.absorbs.length = 0
    this.halo.length = 0
    this.streamIn = 0
    this.sectors.clear()
    this.wanderers.length = 0
    this.solSun = null
    this.activeKey = ''
    this.rivals.length = 0
    this.rankUp = null
    this.gulp = 0
    this.feed = 0
    this.bittenCd = 0
    this.merging = null
    this.biggestMeal = 0
    this.bestR = 0
    this.voyages = 0
    this.waveT = 1e9
    this.dirty = false
    this.persistCd = 0
    this.nibbleCd = 0
    this.driftCd = 3
    this.driftN = 0
    this.quasar = 0
    this.jetCd = 0
    this.cometCd = 0
    this.cruise = 1
    this.domS = 0
    this.runT = 0
    this.nearAny = Infinity
    this.mapNearS = 1e9
    this.routeName = null
    this.routeDist = 0
    this.preyDist = Infinity
    this.preyX = 0
    this.preyY = 0
    this.preyZ = 0
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
    this.refreshSectors(true)
    // 나는 지구다 — 지구 자리·지구 속도·지구 질량에서 30초에 걸쳐 블랙홀로
    // 붕괴한다 ("컨셉을 지구로 시작하자. 30초에 걸쳐서": 사용자). 30초 중력
    // 유예가 곧 붕괴 연출 시간이다 — 규칙과 서사가 같은 시계를 쓴다 (morph).
    const earth = this.active.find((b) => b.id === hashSeed('sol:지구'))
    if (earth) {
      this.x = earth.x
      this.y = earth.y
      this.z = earth.z
      // 궤도 그대로 — 지구의 공전 속도로 눈뜬다. 정지 스폰이면 태양으로
      // 자유낙하해 첫 화면이 "빨려들어가서 못 움직임"이 된다 (실플레이).
      this.vx = earth.vx
      this.vy = earth.vy
      this.vz = earth.vz
      this.vol = volFor(earth.r)
      // 지도의 지구는 퇴장 — 내가 곧 지구다. 남겨두면 유령 쌍둥이가 된다.
      this.eaten.add(earth.id)
      const ei = this.active.indexOf(earth)
      if (ei >= 0) this.active.splice(ei, 1)
      this.refreshSectors(true)
    }
    this.camera.x = this.x
    this.camera.y = this.y
    this.camera.viewHeight = Math.max(48, this.radius * 30)
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
      id, kind, r, r0: r, cr, cg, cb, x, y, z: 0,
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
    registerName(sunId, '태양', '')
    list.push(sun)
    this.solSun = sun
    // 크기 ×1.7·궤도 ×1.35 — "공백은 줄이고 핵심 구조는 키운다". 설명 문구 없음.
    const P: readonly [string, number, number, BodyKindType, number, number, number, number][] = [
      ['수성', 6, 2.3, BodyKind.Rock, 0.6, 0.55, 0.5, 0.12],
      ['금성', 14.8, 3.0, BodyKind.Rock, 0.95, 0.85, 0.6, 0.06],
      ['지구', 15.6, 3.7, BodyKind.Rock, 0.35, 0.6, 0.95, 0],
      ['화성', 8.3, 4.6, BodyKind.Rock, 0.9, 0.45, 0.3, 0.03],
      ['목성', 54, 7.0, BodyKind.Ringed, 0.85, 0.7, 0.5, 0.02],
      ['토성', 46, 8.9, BodyKind.Ringed, 0.9, 0.8, 0.55, 0.04],
      ['천왕성', 22, 10.9, BodyKind.Rock, 0.6, 0.85, 0.9, 0.01],
      ['해왕성', 21, 12.8, BodyKind.Rock, 0.4, 0.55, 1.0, 0.03],
    ]
    for (const [name, r, orbMul, kind, cr, cg, cb, inc] of P) {
      const id = hashSeed(`sol:${name}`)
      const p = this.newBody(id, kind, sun.x, sun.y, r, cr, cg, cb)
      this.setOrbit(p, sun, sun.r * orbMul, (id % 628) * 0.01, 1, 0, inc)
      registerName(id, name, '')
      list.push(p)
      if (name === '지구') {
        const mId = hashSeed('sol:moon')
        const m = this.newBody(mId, BodyKind.Dust, p.x, p.y, 4.2, 0.7, 0.7, 0.72)
        this.setOrbit(m, p, p.r * 2.3, 0, 1, 0, 0.09)
        registerName(mId, '달', '')
        list.push(m)
      }
      if (name === '목성') {
        // 갈릴레이 위성 — 라플라스 공명 1:2:4 의 네 형제
        const GAL: readonly [string, number, number][] = [
          ['이오', 2.9, 1.9],
          ['유로파', 2.6, 2.4],
          ['가니메데', 3.9, 3.0],
          ['칼리스토', 3.6, 3.7],
        ]
        for (const [gn, gr, gm] of GAL) {
          const gid = hashSeed(`sol:${gn}`)
          const gb = this.newBody(gid, BodyKind.Dust, p.x, p.y, gr, 0.72, 0.68, 0.6)
          this.setOrbit(gb, p, p.r * gm, (gid % 628) * 0.01, 1, 0, 0.02)
          registerName(gid, gn, '')
          list.push(gb)
        }
        // 트로이 소행성 — 태양-목성 L4/L5, 목성과 영원히 60° 간격 동행
        for (const side of [1, -1]) {
          for (let ti = 0; ti < 6; ti++) {
            const tid = hashSeed(`sol:trojan:${side}:${ti}`)
            const tb = this.newBody(tid, BodyKind.Dust, sun.x, sun.y,
              1.8 + ((tid >>> 4) % 100) * 0.012, 0.5, 0.47, 0.42)
            this.setOrbit(tb, sun, sun.r * orbMul,
              p.orbA + side * (Math.PI / 3) + (((tid >>> 6) % 40) - 20) * 0.006, 1, 0, 0.03)
            list.push(tb)
          }
        }
      }
    }
    // 소행성대 — 화성과 목성 사이, 실제 그 자리. 첫째 알갱이는 세레스다.
    for (let i = 0; i < 26; i++) {
      const id = hashSeed(`sol:belt:${i}`)
      const d = this.newBody(id, BodyKind.Dust, sun.x, sun.y,
        i === 0 ? 3.4 : 2.4 + ((id >>> 4) % 100) * 0.014, 0.55, 0.5, 0.45)
      this.setOrbit(d, sun, sun.r * (4.1 + ((id >>> 6) % 100) * 0.006),
        (i / 13) * Math.PI * 2, 1, 0, ((id >>> 8) % 100) * 0.0016 - 0.08)
      if (i === 0) registerName(id, '세레스', '')
      list.push(d)
    }
    // 핼리 혜성 — 실제처럼 길쭉하고 기운 타원. 근일점에서 빨라진다.
    const hId = hashSeed('sol:halley')
    const h = this.newBody(hId, BodyKind.Comet, sun.x, sun.y, 5.5, 0.8, 0.9, 1.0)
    this.setOrbit(h, sun, sun.r * 8, 2.2, 1, 0.72, 0.55)
    registerName(hId, '핼리 혜성', '')
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
    registerName(id, sys.name, '')
    list.push(star)
    const rng = new Rng(id)
    for (const c of sys.companions ?? []) {
      const cId = hashSeed(`map:${sys.name}:${c.name}`)
      const comp = this.newBody(cId, BodyKind.Sun, star.x, star.y, c.r, sys.cr * 0.9, sys.cg * 0.9, sys.cb)
      this.setOrbit(comp, star, star.r * c.orbMul, rng.next() * Math.PI * 2, 1, 0, (rng.next() - 0.5) * 0.3)
      registerName(cId, c.name, '')
      list.push(comp)
    }
    for (const p of sys.planets ?? []) {
      const pId = hashSeed(`map:${sys.name}:${p.name}`)
      const pb = this.newBody(pId, p.ringed ? BodyKind.Ringed : BodyKind.Rock, star.x, star.y, p.r * 1.7,
        0.5 + rng.next() * 0.4, 0.5 + rng.next() * 0.3, 0.6 + rng.next() * 0.3)
      this.setOrbit(pb, star, star.r * p.orbMul, rng.next() * Math.PI * 2, 1, 0, (rng.next() - 0.5) * 0.24)
      registerName(pId, p.name, '')
      list.push(pb)
    }
    // 알려진 행성이 없는 별도 벌거숭이는 아니다 — 이름 없는 행성 한둘 (통계적 사실)
    if (kind === BodyKind.Sun && !(sys.planets?.length) && rng.next() < 0.6) {
      const n = 1 + rng.int(2)
      for (let i = 0; i < n; i++) {
        const pId = hashSeed(`map:${sys.name}:p${i}`)
        const pr = Math.max(5, star.r * (0.09 + rng.next() * 0.09))
        const pb = this.newBody(pId, rng.next() < 0.25 ? BodyKind.Ringed : BodyKind.Rock,
          star.x, star.y, pr, 0.55, 0.55, 0.65)
        this.setOrbit(pb, star, star.r * (2.2 + i * 1.3 + rng.next() * 0.6),
          rng.next() * Math.PI * 2, 1, 0, (rng.next() - 0.5) * 0.3)
        list.push(pb)
      }
    }
    // 도착의 성찬 — 항성계는 행성 몇 개가 아니라 벨트·혜성·먼지의 잔칫상이다.
    // 이게 없으면 몇 광년을 날아가서 만나는 게 "점 하나"다 (실플레이).
    if (kind === BodyKind.Sun) {
      const beltN = Math.min(24, 8 + Math.floor(star.r * 0.1))
      for (let i = 0; i < beltN; i++) {
        const dId = hashSeed(`map:${sys.name}:belt:${i}`)
        const d = this.newBody(dId, BodyKind.Dust, star.x, star.y,
          2.2 + rng.next() * 3.6, 0.55, 0.52, 0.5)
        this.setOrbit(d, star, star.r * (3.4 + rng.next() * 2.6),
          rng.next() * Math.PI * 2, 1, 0, (rng.next() - 0.5) * 0.2)
        list.push(d)
      }
      const cometN = 2 + rng.int(2)
      for (let i = 0; i < cometN; i++) {
        const cId2 = hashSeed(`map:${sys.name}:comet:${i}`)
        const cb2 = this.newBody(cId2, BodyKind.Comet, star.x, star.y,
          3.5 + rng.next() * 3, 0.8, 0.9, 1.0)
        this.setOrbit(cb2, star, star.r * (5 + rng.next() * 3),
          rng.next() * Math.PI * 2, 1, 0.5 + rng.next() * 0.25, (rng.next() - 0.5) * 0.5)
        list.push(cb2)
      }
    }
    // 성운은 별의 요람이다 — 어린 별들이 가스 속에서 태어나고 있다 (실물리)
    if (kind === BodyKind.Garden && sys.r > 0) {
      const n = 12
      for (let i = 0; i < n; i++) {
        const sId = hashSeed(`map:${sys.name}:yso:${i}`)
        const sr = 12 + rng.next() * 30
        const s = this.newBody(sId, BodyKind.Sun,
          sys.x + (rng.next() - 0.5) * sys.r * 1.7,
          sys.y + (rng.next() - 0.5) * sys.r * 1.7, sr, 0.85, 0.8, 1.35)
        s.z = sys.z + (rng.next() - 0.5) * sys.r * 0.5
        list.push(s)
      }
      // 게 성운의 심장 — 펄서. 1초에 30번 도는 등대 (렌더러가 빔을 돌린다)
      if (sys.name === '게 성운') {
        const pid = hashSeed('map:게 성운:펄서')
        const p = this.newBody(pid, BodyKind.Sun, sys.x, sys.y, 16, 1.2, 1.3, 1.6)
        p.z = sys.z
        registerName(pid, '게 펄서', '')
        list.push(p)
      }
    }
    // 성단은 별 여럿이 함께 돈다 (플레이아데스 — 일곱 자매. 구상성단은 훨씬 많다)
    if (kind === BodyKind.Garden && sys.r === 0) {
      const clusterN = sys.ly > 1000 ? 18 : 6
      for (let i = 0; i < clusterN; i++) {
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
        registerName(id, pr.name, '')
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
        const b = this.newBody(id, BodyKind.Dust, sun.x, sun.y, k.r * 1.8, 0.6, 0.62, 0.7)
        this.setOrbit(b, sun, k.orb, phase, 1, 0, inc)
        registerName(id, k.name, '')
        list.push(b)
      }
    }

    // ── 절차 채움 — 실제 구조의 껍질을 따른다. 여기가 "현실의 밀도"다:
    // 행성계는 붐비고, 카이퍼·오르트는 얼음이고, 성간은 아득하게 비어 있다.
    if (rC < 6000) {
      // 황도 먼지 — 요람의 군것질
      const cradle = rC < 3600
      const cnt = cradle ? 22 + rng.int(8) : 9 + rng.int(4)
      for (let i = 0; i < cnt; i++) {
        const dSeed = hashSeed(`${seed}:cr:${i}`)
        // 크기 스펙트럼은 바닥이 두껍다(rng²) — 티끌(R1.8)의 첫 끼니는 조약돌이다
        const d = this.newBody(dSeed, BodyKind.Dust,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          1.0 + rng.next() * rng.next() * 4.6, 0.55, 0.5, 0.6)
        d.z = (rng.next() - 0.5) * 360
        list.push(d)
      }
    }
    if (rC > SHELL.kuiperIn && rC < SHELL.kuiperOut) {
      // 카이퍼 벨트 — 얼음의 고리
      const cnt = 14 + rng.int(8)
      for (let i = 0; i < cnt; i++) {
        const dSeed = hashSeed(`${seed}:kb:${i}`)
        const d = this.newBody(dSeed, BodyKind.Dust,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          2.2 + rng.next() * 3.4, 0.6, 0.64, 0.72)
        d.z = (rng.next() - 0.5) * rC * 0.25 // 벨트 — 도톰한 원반
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
        d.z = (rng.next() - 0.5) * rC * 0.45 // 산란 원반 — 부풀어 오른다
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
        d.z = (rng.next() - 0.5) * rC * 0.9 // 오르트는 원반이 아니라 **구껍질**이다
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
      if (rng.next() < 0.012) {
        // 꺼져가는 불씨 — 증발 임계의 원시 블랙홀: 제때 못 삼키면 최후 폭발로
        // 소멸한다 (조사 ②-20, 호킹 증발 dM/dt=−B/M²). 시한부 별미.
        const id = hashSeed(`${seed}:pbh`)
        const b = this.newBody(id, BodyKind.Dust,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          2.6, 1.5, 1.25, 0.9)
        b.z = (rng.next() - 0.5) * rC * 0.5
        b.free = true
        b.hot = true
        b.decay = 45 + rng.next() * 60
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
      // 16광년 너머 — 일반 항성 들판. 분광형은 실제 빈도를 따른다: 우주의
      // 다수는 적색왜성(M)이고, 청색 초거성은 귀하다 ("적색왜성 청색왜성
      // 이런 건 왜 없어": 실플레이).
      if (rC > pxOf(16) && rng.next() < 0.07) {
        const id = hashSeed(`${seed}:fs`)
        const far = rC > pxOf(600)
        // 우주 노화 (조사 ㉗, 경량판): 회차가 쌓일수록 같은 하늘이 늙는다 —
        // 푸른 별이 줄고 백색왜성·적색왜성이 는다 (항성 최종질량함수)
        const ep = Math.min(2, Math.floor((this.voyages - 1) / 4)) * 0.05
        const roll = rng.next() - ep
        let sr: number
        let scr: number
        let scg: number
        let scb: number
        if (roll < 0.55) {
          sr = 40 + rng.next() * 55 // M 적색왜성 — 우주의 다수
          scr = 1.2; scg = 0.5; scb = 0.32
        } else if (roll < 0.72) {
          sr = 65 + rng.next() * 60 // K 주황왜성
          scr = 1.5; scg = 0.9; scb = 0.5
        } else if (roll < 0.84) {
          sr = 85 + rng.next() * 70 // G 노란별 — 태양형
          scr = 1.8; scg = 1.5; scb = 0.75
        } else if (roll < 0.93) {
          sr = 115 + rng.next() * 130 // A·B 청백색
          scr = 1.6; scg = 1.7; scb = 2.0
        } else if (roll < 0.985) {
          sr = far ? 420 + rng.next() * 700 : 260 + rng.next() * 340 // 적색거성
          scr = 1.9; scg = 0.85; scb = 0.4
        } else {
          sr = far ? 600 + rng.next() * 900 : 400 + rng.next() * 500 // 청색 초거성
          scr = 1.0; scg = 1.2; scb = 2.2
        }
        const b = this.newBody(id, BodyKind.Sun,
          sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
          sr, scr, scg, scb)
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

    // 캐시 축출 — 시야(N)가 커질수록 더 많이 쥔다. keep 은 보존 박스(N+2)²보다
    // 커야 한다 — 작으면 포화 상태에서 삭제 대상 0인 풀스캔이 반복된다 (적대 리뷰)
    const N = this.rangeN()
    const keep = (2 * N + 5) * (2 * N + 5) + 40
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

  /** 이 섹터의 블랙홀 — **실존 카탈로그만** (starmap.HOLES). 우주 시뮬처럼
   * 블랙홀은 희귀 랜드마크다: 절차 생성으로 깔면 "무슨 다른 천체 있듯 블랙홀이
   * 있는" 우주가 된다 (실플레이 판정 — 전면 폐지). */
  private sectorRival(sx: number, sy: number): Rival | null {
    for (const h of HOLES) {
      if (Math.floor(h.x / SECTOR) === sx && Math.floor(h.y / SECTOR) === sy) {
        const id = hashSeed(`hole:${h.name}`)
        registerName(id, h.name, '')
        return { id, x: h.x, y: h.y, z: h.z, vx: 0, vy: 0, vz: 0, vol: volFor(h.r) }
      }
    }
    return null
  }

  /** 활성 반경(섹터) — 시야가 커지면 세계도 넓게 깬다. 이게 없으면 거대해질수록
   * 화면이 로드 범위 밖 = 빈 배경만 보인다 (실플레이 판정). */
  private rangeN(): number {
    // 3D 원근은 지평선까지 보인다 — 캡 12(약 29k px): 7(17k)은 "좀만 멀어지면
    // 아무것도 안 보이는" 시야 절벽이었다 (실플레이). 성간 섹터 생성은 저렴함이
    // 계측돼 있다 (적대 리뷰).
    return Math.min(12, Math.max(1, Math.ceil((this.camera.viewHeight * 1.5) / SECTOR)))
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
    // 이 패스는 전 섹터×전 천체 문자열 생성이라 비싸다 — 순항 중 매 섹터
    // 크로싱마다 돌리면 툭툭 끊긴다 (실플레이): 0.5초에 한 번만.
    if (this.refreshCd <= 0) {
      this.refreshCd = 0.5
    for (const [k, lst] of this.sectors) {
      for (let i = lst.length - 1; i >= 0; i--) {
        const b = lst[i]!
        const bk = `${Math.floor(b.x / SECTOR)},${Math.floor(b.y / SECTOR)}`
        if (bk !== k) {
          const target = this.sectors.get(bk)
          if (target) {
            lst.splice(i, 1)
            target.push(b)
          } else {
            // 캐시 밖으로 끌려간 천체는 **떠돌이 명단**으로 — 옛 명단에 남기면
            // 존재하는데 렌더에서 사라진다 (실플레이: 끌려오던 태양 증발)
            lst.splice(i, 1)
            this.wanderers.push(b)
          }
        }
      }
    }
    }
    // 떠돌이 재편입 — 섹터가 캐시되면 돌아가고, 아니면 그대로 활성에 남는다
    for (let i = this.wanderers.length - 1; i >= 0; i--) {
      const b = this.wanderers[i]!
      if (this.eaten.has(b.id)) {
        this.wanderers.splice(i, 1)
        continue
      }
      const home = this.sectors.get(`${Math.floor(b.x / SECTOR)},${Math.floor(b.y / SECTOR)}`)
      if (home) {
        home.push(b)
        this.wanderers.splice(i, 1)
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
    // 떠돌이는 언제나 활성 — 끌고 다니는 태양이 사라지면 안 된다
    for (const b of this.wanderers) {
      if (this.eaten.has(b.id) || b.r < tiny) continue
      this.active.push(b)
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
    // 중력 해방 (사용자 사양 2026-07-19): 시작 30초는 현행 중력(요람의 유예),
    // 30초부터 유효 질량 ×1000 이 기본이 된다 (3초 램프). H 홀드는 그 위에
    // 다시 ×1000 (합산 백만 배). 몸(vol)·기록은 불변.
    this.runT += step
    const ramp = this.runT < 30 ? 0 : Math.min(1, (this.runT - 30) / 3)
    const baseMul = 1 + 999 * ramp
    const volE = this.vol * baseMul * (this.surge ? 1000 : 1)
    const surgeK = (1 + 25 * ramp) * (this.surge ? 26 : 1)
    // 줌 눈금 — 거대해질수록 R×26 → R×18 로 수렴: 무한 줌아웃이면 주변이 전부
    // 동전이 된다 (실플레이). 내 존재감과 이웃의 크기가 같이 자란다.
    // 바닥 40: 티끌의 눈높이. 130에서도 시작 카메라가 몸의 56배 거리라 지구가
    // 7.8°(동전)였다 — 40이면 지구 각지름 ~28° = 화면 세로 절반 (계측 근거:
    // 스케일 조사 에이전트 기하 계산). 바닥은 R<5 에서만 효력이라 그 뒤 페이스
    // 는 무변경이다.
    const base = Math.max(40, R * (26 - 8 * Math.min(1, R / 1300)))

    // 추진 — 화면 눈금으로 민첩하게, 놓으면 서서히 선다. 역추진은 브레이크다.
    const mx = input.move.x
    const my = input.move.y
    const lift = input.lift ?? 0
    this.thrusting = mx !== 0 || my !== 0 || lift !== 0
    // 성간 순항 — 먹이도 천체도 없는 공허(오르트 밖의 한세월)에서는 추진이
    // 몇 배로 열린다: "다음 별이 너무 멀어"의 수리. 태양계 안 오르트까지의
    // 한세월 감각은 그대로 두고, 진짜 빈 성간만 접는다. 뭔가 가까워지면
    // 빠르게 풀린다 — 도착 브레이크가 순항보다 세야 지나치지 않는다.
    // 지도 감속 — 감지(nearAny)는 로드 반경(≤~17k px)에 묶이는데 제동거리는
    // R·속도 비례라 거대한 몸은 목적지를 관통한다 (적대 리뷰: R700 관통 확정).
    // 지도 항성계·태양계 거리는 로드와 무관하니 이걸로 미리 브레이크를 밟는다.
    // mapNear 는 **진행 방향 앞의 것만** 센다 — 뒤의 태양계가 상한을 잡으면
    // 이웃 별 몇 광년 여행이 출발부터 기어간다 ("몇 광년 가는 게 너무 오래
    // 걸려": 실플레이). 저속(순항 전)일 땐 전방위.
    const spNow = Math.hypot(this.vx, this.vy, this.vz)
    const dirX = spNow > 1 ? this.vx / spNow : 0
    const dirY = spNow > 1 ? this.vy / spNow : 0
    const ahead = (bx: number, by: number): boolean =>
      spNow < base * 2 || (bx - this.x) * dirX + (by - this.y) * dirY > 0
    let mapNear = ahead(800, 800)
      ? Math.hypot(800 - this.x, 800 - this.y, this.z) - SHELL.oortIn
      : Infinity
    // 전방향 최근접(도착 판정용) — 전방 필터를 쓰면 도착한 계가 "뒤"로 빠져
    // 항로가 다음 계를 미리 가리킨다 (실플레이: 카리나에서 오메가 표시)
    let mapNearAll = Math.hypot(800 - this.x, 800 - this.y) - SHELL.oortIn
    for (const s of STAR_MAP) {
      const dxy = Math.hypot(s.x - this.x, s.y - this.y) - s.r
      if (dxy < mapNearAll) mapNearAll = dxy
      if (!ahead(s.x, s.y)) continue
      const dm = Math.hypot(s.x - this.x, s.y - this.y, s.z - this.z) - s.r
      if (dm < mapNear) mapNear = dm
    }
    if (mapNear === Infinity) mapNear = 1e9
    // 평활 — 전방 집합이 바뀔 때마다 mapNear 가 계단식으로 튀면 순항 속도가
    // "훅훅" 요동친다 (실플레이). 1.5/s 로 미끄러뜨린다.
    this.mapNearS += (mapNear - this.mapNearS) * (1 - Math.exp(-1.5 * step))
    mapNear = Math.min(mapNear, this.mapNearS)
    // 클릭 목적지 — 지정 항로는 명령이다: 제동은 **목적지 거리로만** 잡는다.
    // 도중 별을 mapNear 로 보면 전방에 별 하나만 걸려도 순항이 꺼지고, 내가
    // 끌고 다니는 수행단(포획 천체)이 nearAny 게이트를 영구히 눌러 배율이
    // 1에 고정된다 (실플레이 "1광년에 몇십 초": 계측 ~1,250px/s = 광년당 40초).
    const navDist = this.navOn ? Math.hypot(this.navX - this.x, this.navY - this.y) : Infinity
    const brakeD = this.navOn ? navDist : mapNear
    // 게이트: 지정 항로는 제동 거리만 본다. 수동 순항은 둘 — 의미 있는 천체
    // (내 30%+)가 2.5화면 안에 있는가 + 지도 제동. preyDist(잔부스러기 폴백)를
    // 게이트에 넣으면 성간의 상수 밀도 잔챙이가 순항을 죽인다 (계측 0~5%).
    const empty = (this.navOn || this.nearAny > base * 2.5) && brakeD > spNow * 1.4 + base * 8
    const ck = empty && this.thrusting ? (this.navOn ? 1.8 : 0.7) : 4.5
    this.cruise += ((empty && this.thrusting ? 6 : 1) - this.cruise) * (1 - Math.exp(-ck * step))
    // 순항 z 수렴 — 별들이 구형으로 흩어진 우주에서 수동 xy 비행만으로도
    // 목적지 층에 닿아야 한다: 순항 중엔 나침반 표적의 z 로 미끄러져 간다
    // (실플레이: "성운 도착했는데 아무것도 안 보여" — 목적지가 발밑 수백만 px)
    // z 수렴은 **자동 항법 중에만** — 손 비행의 고도는 손의 것이다
    // (실플레이: "앞으로만 가는데 왜 z 가 움직이냐")
    if (this.navAssist && this.cruise > 2 && lift === 0) {
      const tzN = this.navOn ? this.navZ : this.preyDist < 1e8 ? this.preyZ : this.z
      this.vz += (tzN - this.z) * Math.min(0.6, this.cruise * 0.09) * step
    }
    // 심공 가속 보강 — 거리 비례 상한(vmax)에 실제로 도달할 추력.
    // 지정 항로는 **무상한 로그 항행**: 목표 속도 ∝ 남은 거리(0.6/s) — 어느
    // 거리든 e-감쇠 십수 번이면 도착한다(수백 광년 ≈ 15초). 광속 제한은 없다 —
    // 상대성은 연출(조석·렌즈)의 것이지 이동의 족쇄가 아니다 ("빛의 속도를
    // 못 넘으면 할 이유가 없다": 사용자). 나침반 자동 항법(먹이 사냥)만 종전
    // 상한 유지 — 사냥은 근거리 정밀 기동이다.
    const targetD = this.navOn ? navDist : this.preyDist
    // 지나침 가드 — 목적지 **반대 방향**으로 달리는 중엔 심공 보너스를 끊는다.
    // 보너스가 남은 거리에 비례하므로, 지나친 뒤엔 멀어질수록 더 빨라지는
    // 폭주 피드백이 된다 (계측: 조향 없는 하네스에서 1.5e18 px/s 발산).
    const navAway = this.navOn &&
      this.vx * (this.navX - this.x) + this.vy * (this.navY - this.y) < 0
    const farNav = this.navOn
      ? navAway
        ? 0
        : Math.max(0, (navDist - base * 8) * 0.6)
      : this.navAssist && targetD > 2500000
        ? Math.min(3000000, targetD * 0.2)
        : 0
    const acc = thrustAcc(R) * this.cruise +
      (this.cruise > 3 ? Math.min(400000, mapNear * 0.06) + farNav * 0.5 : 0)
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
      // 수직 추력은 순항 부스터와 분리 — acc 에 물리면 순항 중 스페이스 한 번에
      // z 가 로켓처럼 폭발한다 (실플레이 "z축 좆버그"의 범인)
      if (lift !== 0) this.vz += lift * thrustAcc(R) * Math.min(this.cruise, 2.5) * 1.15 * step
      // 순항 조향 — 속도가 아무리 높아도 방향은 든다: 입력 방향으로 속도
      // 벡터를 회전(1.6rad/s, 어떤 속도든 ~2초 U턴). 가속만으론 순항 속도에서
      // 선회 반경이 행성계만 해진다 ("속도만 높으면 컨트롤을 어떻게 해").
      // 거의 정반대 입력(140°+)은 회전 대신 역추진 브레이크가 맡는다.
      if (this.cruise > 2 && (mx !== 0 || my !== 0)) {
        const sp = Math.hypot(this.vx, this.vy)
        if (sp > base * 2) {
          const cur = Math.atan2(this.vy, this.vx)
          let dAng = Math.atan2(my, mx) - cur
          while (dAng > Math.PI) dAng -= 2 * Math.PI
          while (dAng < -Math.PI) dAng += 2 * Math.PI
          if (Math.abs(dAng) < 2.4) {
            const turn = Math.max(-1.6 * step, Math.min(1.6 * step, dAng))
            const na = cur + turn
            this.vx = Math.cos(na) * sp
            this.vy = Math.sin(na) * sp
          }
        }
      }
    }
    // 항력 — 추진 중엔 낮고, 먹이 곁에서 놓으면 강하다 ("브레이크 없는 엑셀"의
    // 수리). 단 **빈 우주에선 거의 없다** — 활공 항력이 공전 속도까지 죽이면
    // 궤도 스폰이 무력화되어 정지→태양 자유낙하가 된다 (계약 ㉑ 실측: 30초 방치
    // 에 태양 심부 도달). 우주에 마찰은 원래 없다 — 정지 손맛은 사냥 중에만.
    // z 는 따로: 상승키를 놓으면 수직 흐름이 빨리 죽는다 (계측: 봇 z ±760 발진).
    const dragK = this.thrusting ? 0.14 : this.preyDist < base * 2 ? 0.3 : 0.05
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
      // 내 중력 — **질량이 내 밑이면 전부** 내가 끈다. 반지름 서열은 물리가
      // 거꾸로다: 태양 84개 질량이 지름 큰 별한테 무시당했다 ("큰 것들은
      // 오지도 않아": 실플레이). 내가 무거워지는 순간 태양도 나에게 떨어진다.
      // **사거리 컷 없음**: 중력은 모든 공간에 미친다. 1/r² 이 자연 감쇠다.
      if (b.r * b.r * b.r < volE) {
        const dx = this.x - b.x
        const dy = this.y - b.y
        const dz = this.z - b.z
        const d2 = dx * dx + dy * dy + dz * dz
        const d = Math.sqrt(d2) || 1
        const edibleB = b.r < R * EDIBLE
        {
          // 질량 비례 강화 — 블랙홀 질량은 R³·밀도(R)로 붇는다. 커질수록 같은
          // 거리의 행성이 더 세게 뜯겨 오고, 태양을 삼킨 몸 곁에선 온 행성계가
          // 레일을 이탈해 낙하한다. 상한도 크게 열려야 "빨아들이는 위력"이
          // 질량과 함께 어마어마해진다 (실플레이 — R300 에서 고작 2배였다).
          // 기본 당김을 과부하의 1/3 질감으로 상향 (실플레이 "과부하가 일반적인
          // 움직임 같다" — 끌려오는 맛은 상시, 신 모드는 H). 페이스(소화)는 불변.
          // 강화는 R12(검은 입 문턱)부터 차오른다 — 티끌 초반 페이스 보존 (계측).
          const grip = 1 + 2 * Math.min(1, R / 12)
          const heavy = (1 + R / 60) * grip * surgeK
          const capMe = PULL_CAP_BY_ME * (1 + R / 80) * (0.8 + 0.6 * grip) * surgeK
          let g = Math.min(capMe, (R * R * GRAV * MAW_PULL * heavy) / d2)
          // 동역학 마찰 항적 (조사 ㉒, Chandrasekhar): 내가 지나간 뒤편의 것들이
          // 항적 밀도에 끌려 뒤늦게 따라 떨어진다 — 후방 보정 (경량판)
          if ((b.x - this.x) * this.vx + (b.y - this.y) * this.vy < 0) g *= 1.18
          // 먹이급 견인 보너스 — 두어 화면 밖에서도 다가오는 게 보여야 한다
          // ("내가 쟤 위치까지 가야만 따라와": 실플레이 — 사거리 R·20→R·34)
          if (edibleB) {
            const near = (R * 34) / (d + R * 34)
            g = Math.min(capMe, g + 320 * heavy * near * near) // 흡입 상향 (실플레이)
          }
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
            // 에르고스피어 강제 동조 — 몸(bodyR)의 2.2배 안에서는 역행이 물리적
            // 으로 불가능하다: 상대 접선 속도를 내 스핀 방향(반시계)으로 강제
            // 정렬 (조사 ②-4, 커 시공 틀 끌림 ω∝r⁻³)
            if (d < bodyRof(R) * 2.2 + b.r) {
              const txE = -dy / d
              const tyE = dx / d
              const rvxE = b.vx - this.vx
              const rvyE = b.vy - this.vy
              const tv = rvxE * txE + rvyE * tyE
              const kE = 1 - Math.exp(-8 * step)
              const want = Math.abs(tv)
              b.vx += (txE * want - (rvxE * txE) * txE) * kE * (tv < 0 ? 2 : 0)
              b.vy += (tyE * want - (rvyE * tyE) * tyE) * kE * (tv < 0 ? 2 : 0)
            }
            const gr = g * (1 - swirl * prox)
            const gt = g * swirl
            const dxy = Math.hypot(dx, dy) || 1
            b.vx += ((dx / d) * gr + (-dy / dxy) * gt) * step
            b.vy += ((dy / d) * gr + (dx / dxy) * gt) * step
            b.vz += (dz / d) * gr * step
            if (edibleB) {
              // 원반 평면화 — 먹이의 z 는 내 평면으로 스프링-감쇠 수렴한다.
              // **근접 전용**: 전역으로 걸면 화면 끝 천체들까지 내 평면으로 우수수
              // 떨어져 보인다 ("멀리 있는 것들 위에서 떨어지는 효과": 실플레이).
              const zn = (R * 20) / (d + R * 20)
              b.vz += dz * 5 * zn * zn * step
              b.vz *= Math.exp(-3 * zn * step)
            }
            // 원반화 점성 — 반경 방향 속도만 죽인다. 궤도 회전은 남고,
            // z 는 내 적도면으로 가라앉는다: 원반은 그렇게 생긴다.
            const rvx = b.vx - this.vx
            const rvy = b.vy - this.vy
            const rvz = b.vz - this.vz
            const ux = dx / d
            const uy = dy / d
            const uz = dz / d
            // 점성은 **탈출만** 죽인다 — 접근 속도까지 죽이면 내가 다가갈 때
            // 먹이가 뱃머리 파도처럼 밀려간다 ("가까이 가면 멀어져": 실플레이)
            const vr0 = rvx * ux + rvy * uy + rvz * uz
            // 탈출 감쇠 — 사거리는 넓게(proxV), 세기는 질량 지배 비례(domV).
            // prox 만 쓰면 태양급(중심거리 큼)은 감쇠가 사실상 0이라 근일점에서
            // 슬링샷 사출된다 ("궤도에 들어온 태양이 튕겨나가": 실플레이).
            // 과부하(H)는 추가 ×30.
            const proxV = (R * 40) / (d + R * 40)
            const domV = Math.min(6, volE / (b.r * b.r * b.r + 1))
            const vr = vr0 > 0
              ? vr0
              : vr0 * Math.exp(-step * 5 * proxV * (1 + domV) * (this.surge ? 30 : 1))
            // 각운동량 사형선고 — 슈바르츠실트 포획은 거리가 아니라 각운동량
            // 조건이다 (L < 4GM/c 이면 반드시 낙하: 조사 A). 게임 눈금 근사.
            if (!b.doomed && d < R * 24 && vr0 < 0) {
              const Lz = Math.abs(dx * rvy - dy * rvx)
              if (Lz < R * Math.sqrt(GRAV * MAW_PULL * R) * 0.5) b.doomed = true
            }
            // 강착 나선 — 접선 마찰이 각운동량을 갉아 "돌다가 점점 안으로"
            // 감겨 들어온다 (실플레이 "언제까지 돌 건데"). 질량 지배·근접 비례.
            const kt = Math.exp(-step * (0.35 + 0.45 * domV) * proxV * proxV)
            let tx = (rvx - (rvx * ux + rvy * uy + rvz * uz) * ux) * kt
            let ty = (rvy - (rvx * ux + rvy * uy + rvz * uz) * uy) * kt
            let tz = (rvz - (rvx * ux + rvy * uy + rvz * uz) * uz) * Math.exp(-step * 2.2 * prox)
            b.vx = this.vx + ux * vr + tx - ux * (tx * ux + ty * uy + tz * uz)
            b.vy = this.vy + uy * vr + ty - uy * (tx * ux + ty * uy + tz * uz)
            b.vz = this.vz + uz * vr + tz - uz * (tx * ux + ty * uy + tz * uz)
            // 원형화 — 타원 포획은 "줄었다 늘었다" 숨을 쉰다 (실플레이). 깊이
            // 잡힌 것은 속도를 국소 원궤도의 96%로 다듬어 매끈한 나선로 만든다.
            if ((b.doomed || domV > 1.5) && proxV > 0.3) {
              const rvx2 = b.vx - this.vx
              const rvy2 = b.vy - this.vy
              const rad2 = rvx2 * ux + rvy2 * uy
              const ttx = rvx2 - ux * rad2
              const tty = rvy2 - uy * rad2
              const tmag = Math.hypot(ttx, tty)
              if (tmag > 1) {
                // **감속 전용** — 목표를 √(g·d)로 두면 과부하 시 g 폭등 →
                // 접선 가속 → 원심 이탈 ("과부하 걸면 멀어져": 실플레이 확정).
                // 원형화는 빠른 놈을 늦출 뿐, 절대 밀어 올리지 않는다.
                const want = Math.min(tmag, Math.sqrt(Math.max(1, g * d)) * 0.96)
                const kC = 1 - Math.exp(-(1.2 + domV) * proxV * step)
                const scl = 1 + (want / tmag - 1) * kC
                b.vx = this.vx + ux * rad2 + ttx * scl
                b.vy = this.vy + uy * rad2 + tty * scl
              }
            }
            // 관통 방지 — 명시적 오일러에서 안쪽 반경 속도가 한 프레임에 d 를
            // 넘으면 천체가 내 중심 **반대편으로 순간이동**한다 (교차 검증
            // CONFIRMED: 과부하 시 d=100 → 반대편 ~3,450 사출. "줄었다 늘었다"
            // 의 반경 쪽 형제 버그). 한 프레임 낙하량을 d 의 85% 로 묶는다 —
            // 다음 프레임 접촉 삼킴으로 끝난다. 접선은 손대지 않는다.
            {
              const rvx3 = b.vx - this.vx
              const rvy3 = b.vy - this.vy
              const rvz3 = b.vz - this.vz
              const vin = rvx3 * ux + rvy3 * uy + rvz3 * uz
              const vinMax = (d * 0.85) / Math.max(step, 1e-4)
              if (vin > vinMax) {
                const cut = vin - vinMax
                b.vx -= ux * cut
                b.vy -= uy * cut
                b.vz -= uz * cut
              }
            }
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
    // 사거리 컷 없음 — 1/r² 이 알아서 줄인다.
    // 탈출 불변식: 당김 상한 ≤ 내 추진의 80% (역추진 1.7배가 언제나 이긴다).
    // 티끌 눈금(추진 62)에서 상수 상한(340)은 태양에 붙잡히면 감옥이었다 (실플레이).
    const pullCapMe = Math.min(PULL_CAP_ON_ME, acc * 0.8)
    let domG = 0
    let domB: Body | null = null
    for (const b of this.active) {
      // 나를 끄는 것도 질량 기준 — 내가 더 무거우면 저쪽이 내 밥이다
      if (b.r * b.r * b.r <= volE || this.eaten.has(b.id)) continue
      const dx = b.x - this.x
      const dy = b.y - this.y
      const dz = b.z - this.z
      const d2 = dx * dx + dy * dy + dz * dz
      const d = Math.sqrt(d2) || 1
      const g = Math.min(pullCapMe, (b.r * b.r * GRAV) / d2)
      if (g > domG) {
        domG = g
        domB = b
      }
      this.vx += (dx / d) * g * step
      this.vy += (dy / d) * g * step
      this.vz += (dz / d) * g * step
    }
    // 궤도 관성 — 입력이 없으면 지배 천체의 케플러 흐름에 실린다. 우주의 기본
    // 상태는 정지가 아니라 궤도다: 정지+상시 중력=낙하는 필연이라, 이게 없으면
    // 방치가 곧 태양 추락이 된다 (계약 ㉑ 실측). 추진하는 순간 자유다.
    // 재진입 평활(domS) — 과부하 토글로 지배가 사라졌다 돌아오는 순간 즉시
    // 45%/프레임 스냅을 걸면, 줄어든 d 로 재계산된 원궤도 속도 + 바깥 바이어스가
    // 속도 스파이크로 꽂힌다 (교차 검증 CONFIRMED: "토글하면 멀어져"의 잔여
    // 경로). 권위는 ~0.7초에 걸쳐 0→1 로 차오른다.
    const domOn = !this.thrusting && domB !== null && domG > 0.5
    this.domS += ((domOn ? 1 : 0) - this.domS) * (1 - Math.exp(-3 * step))
    if (domOn && domB) {
      const dx = domB.x - this.x
      const dy = domB.y - this.y
      const d = Math.hypot(dx, dy) || 1
      const tx = -dy / d
      const ty = dx / d
      const rel0x = this.vx - domB.vx
      const rel0y = this.vy - domB.vy
      const sign = rel0x * tx + rel0y * ty >= 0 ? 1 : -1
      const vCirc = Math.sqrt(domG * d)
      // 보정 12/s + 정상상태 내향 오차(g/12)만큼의 바깥 바이어스 — 느슨한 보정은
      // 중력 래칫으로 나선낙하가 된다 (계측: 0.5/s 에서 내향 42px/s)
      const k = (1 - Math.exp(-12 * step)) * this.domS
      const bias = domG / 12
      this.vx += (domB.vx + tx * sign * vCirc - (dx / d) * bias - this.vx) * k
      this.vy += (domB.vy + ty * sign * vCirc - (dy / d) * bias - this.vy) * k
    }

    // 속도 상한 — 화면 1.6장/초 (순항 중엔 순항 배율만큼 열린다).
    // 성간 심공에선 **남은 지도 거리에 비례**해 더 열린다 (SpaceEngine 방식):
    // ×6 고정으론 게 성운(11M px)이 32분이다 ("한번 가는데 30분": 실플레이).
    // 접근하면 mapNear 가 줄며 자동 감속 — 도착 브레이크가 공짜로 따라온다.
    const vmax = base * 1.6 * Math.max(1, this.cruise) +
      (this.cruise > 1.5 ? Math.max(Math.min(900000, brakeD * 0.14), farNav) : 0)
    // 상한은 수평/수직 분리 — 합산 클램프는 순항이 수평을 다 채우면 상승
    // 성분을 깎아 "스페이스를 눌러도 도로 내려오는" 증상을 만든다 (실플레이)
    const spH = Math.hypot(this.vx, this.vy)
    if (spH > vmax) {
      const k = vmax / spH
      this.vx *= k
      this.vy *= k
    }
    // 수직 상한도 기본 눈금 — 순항 부스터 무제한이면 폭주 vz 가 안 죽는다.
    // 자동 항법의 원거리 z 이동만 예외 (farNav)
    const vzCap = base * 1.6 * Math.max(1, this.cruise) + (this.navAssist ? farNav * 0.5 : 0)
    if (this.vz > vzCap) this.vz = vzCap
    else if (this.vz < -vzCap) this.vz = -vzCap
    const sp0 = Math.hypot(this.vx, this.vy, this.vz)
    const prevX = this.x
    const prevY = this.y
    const prevZ = this.z
    this.x += this.vx * step
    this.y += this.vy * step
    this.z += this.vz * step
    // z 상한 없음 — 상한을 두면서 천체를 그 너머에 뿌리는 건 말이 안 된다
    // (실플레이: "오브젝트는 그 너머에 있는 것도 말이 되냐"). 미아 방지는
    // 강한 무입력 z 감쇠 + 먹이 평면 수렴 + 나침반 z 화살표가 맡는다.
    this.refreshSectors()

    const dist = Math.hypot(this.x, this.y)
    if (dist > this.farthest) this.farthest = dist

    // ── 가스 스트림 강착 — 찢긴 질량은 구름으로 흘러들어와 서서히 내 것이 된다
    // 재강착 저장고 방출 — 상승 3초(t²) → t^(−5/3) 멱감쇠 (조사 ②-11)
    for (let i = this.fallbacks.length - 1; i >= 0; i--) {
      const fb = this.fallbacks[i]!
      fb.t += step
      const shape = fb.t < 3 ? (fb.t / 3) * (fb.t / 3) : Math.pow(fb.t / 3, -5 / 3)
      const out = Math.min(fb.amt, fb.amt * 0.12 * shape * step * 3)
      fb.amt -= out
      this.streamIn += out
      if (out > this.vol * 0.001) this.feed = Math.max(this.feed, 0.4)
      if (fb.amt < 1) this.fallbacks.splice(i, 1)
    }
    // Bondi 성간 흡입 — 성간 매질은 어디에나 있다: 천천히 날수록 더 먹는다
    // (Ṁ∝ρM²/v³ 를 게임 눈금으로 누름 — 조사 ②-17, 완행=폭식·급행=굶주림)
    {
      const spB = Math.hypot(this.vx, this.vy, this.vz)
      this.streamIn += (R * R * 0.012) / (1 + Math.pow(spB / 900, 3)) * step
    }
    if (this.streamIn > 0.5) {
      // 소화(흡수) = 내 부피의 5%/s — 진짜 에딩턴 한계는 질량 비례다(Ṁ∝M).
      // 절대 캡(R^1.6)이면 티끌이 초당 제 몸의 50배를 삼켜 성장이 폭주하고
      // (봇 실측 2분 R30 — 태양계 1막이 1분에 끝난다), 합병 대어는 소화가
      // 수 시간이라 퀘이사가 영구 점화된다 — 질량 비례 하나가 양끝을 고친다.
      // 파괴 속도(bite)는 별개라 "지구 순삭" 스펙터클은 그대로다: 세계는
      // 순식간에 무너지고, 나는 그 잔해 구름 속에서 천천히 붇는다.
      // 6%/s — 5%는 현실(수천만 년)을 너무 따라가 "먹는 맛"이 죽고 (실플레이
      // "게이미피케이션한 부분은 있어야"), 7~10%는 복리 폭주로 봇이 2분 R25~30
      // (계측: 5%→11.8 / 6%→20.7 / 7%→25.1 / 10%→29.7 — 먹이 사다리 연쇄로
      // 초민감한 다이얼이다. 만질 땐 반드시 봇 재실측).
      // 소화 = 7.5%/s × 스핀 효율 (5.7→42% 의 게임 눈금: 0.85+0.5a — 조사 ②-23).
      // 과부하 중엔 유효 질량 기준 — 흡수도 1000배 위력 (실플레이 H 키)
      const take = Math.min(
        this.streamIn * (1 - Math.exp(-2.2 * step)),
        volE * 0.075 * (0.85 + 0.5 * this.spin) * step,
      )
      this.vol += take
      this.streamIn -= take
      this.feed = Math.max(this.feed, 0.55)
      this.gulp = Math.max(this.gulp, 0.25)
    }

    // ── 접촉 잠식 — 땅콩만 한 블랙홀도 지구를 갉는다 (크기가 아니라 밀도다).
    // 나보다 큰 것도 몸이 닿으면 표면이 깎여 스트림으로 흘러들어온다.
    // 속도는 내 단면적(R²) 비례 — 작을 땐 스멀스멀, 클수록 험악하게.
    this.nibbleCd -= step
    for (const b of this.active) {
      if (b.r < R || this.eaten.has(b.id)) continue
      const d = Math.hypot(b.x - this.x, b.y - this.y, b.z - this.z)
      const contact = (R + b.r) * 1.03
      if (d < contact * 3.2) {
        // 원거리 조석 박리 — 시그너스 X-1 처럼, 곁에 있는 것만으로 별이 가스를
        // 흘리기 시작한다. 가까울수록 격렬해지고 접촉이면 초당 35~70% 붕괴.
        // 가스체(항성·성운)는 단단한 돌보다 잘 뜯긴다.
        const gassy = b.kind === BodyKind.Sun || b.kind === BodyKind.Garden || b.kind === BodyKind.Core
        const strength = d <= contact ? 1 : Math.pow(Math.max(0, 1 - (d - contact) / (contact * 2.2)), 2)
        if (strength < 0.03) continue
        const frac = (0.35 + 0.35 * Math.min(1, R / b.r)) * (gassy ? 1.1 : 1)
        // 에딩턴 캡 — 지수 1.6(R² 이면 공성 중 성장→캡 복리 폭주: 계측 7.5s) +
        // 대상 크기 항(30/(30+r)): 목성(5초권)은 관대하고 태양은 공성전이 된다.
        // 질량 지배(dom) — 대상의 두 배를 넘는 질량이면 에딩턴은 더 이상 방벽이
        // 아니다: 별이 통째로 조석 붕괴해 낙하한다. "토성만한 블랙홀(≈태양 수천
        // 배 질량)이면 태양이고 카이퍼고 찰나"(실플레이)가 이 항이다. 첫 태양
        // 공성전(내가 가벼울 때 dom=1)은 그대로 남는다 — 성장의 서사는 불변.
        let dom = Math.max(1, volE / (2 * b.r * b.r * b.r))
        // 최종 파섹 (조사 ㉕, 경량판): 은하심급(Core 거인)은 내 은하가 탄약이다 —
        // 거느린 별들이 손실원뿔로 각운동량을 빼앗아 병합을 하드닝한다
        if (b.kind === BodyKind.Core && b.r > 2000) {
          dom *= 1 + this.halo.length / 90
          if (this.halo.length > 0 && this.nibbleCd <= 0 && this.halo.length % 7 === 0) {
            this.halo.pop()
          }
        }
        // 대상 크기 항 지수 1.4 — 목성이 ×4.8 무거워지자 태양보다 오래 걸리는
        // 역전이 생겼다 (계측): 큰 별일수록 가파르게 단단해야 질량 격차가 산다
        const bite = Math.min(
          b.r * b.r * b.r * frac * strength,
          EDDINGTON * Math.pow(R, 1.6) * Math.pow(30 / (30 + b.r), 1.4) * (1 + this.quasar * 0.5) * dom,
        ) * step
        b.r = Math.cbrt(Math.max(1, b.r * b.r * b.r - bite))
        this.streamIn += bite * ABSORB_GAIN
        this.feed = Math.max(this.feed, 0.25 + strength * 0.5)
        // 별의 죽음 — 항성을 임계까지 뜯으면 조용히 안 죽는다 (초신성/행성상성운)
        if (b.kind === BodyKind.Sun && b.r < b.r0 * 0.55 && b.r0 > 40) {
          this.stellarDeath(b)
          continue
        }
        // 행성 붕괴 — 절반을 뜯긴 행성은 조석 불안정으로 무너진다. 이게 없으면
        // 목성을 100% 갈아야 해서 태양(55% 초신성)보다 오래 걸리는 역전 (계측)
        if (b.kind !== BodyKind.Sun && b.kind !== BodyKind.Core && b.r < b.r0 * 0.55 && b.r0 > 24) {
          this.eaten.add(b.id)
          const bi = this.active.indexOf(b)
          if (bi >= 0) this.active.splice(bi, 1)
          this.streamIn += b.r * b.r * b.r * 0.55 * ABSORB_GAIN
          this.spawnCores(b)
          this.feed = 1
          this.gulp = Math.max(this.gulp, 0.7)
          this.camera.shake(4, 7)
          const cnm = nameOf(b.id)?.name ?? b.origin
          if (cnm) {
            const entry: JournalEntry = {
              name: cnm, log: '', kind: b.kind,
              r: Math.round(b.r0), x: Math.round(b.x), y: Math.round(b.y),
            }
            this.journal.push(entry)
            this.lastFound = entry
            this.persistSoon()
          }
          this.sfx('kill')
          continue
        }
        if (this.nibbleCd <= 0) {
          this.nibbleCd = 0.11
          // 가스는 내 쪽으로 뜯겨 나와 접선으로 감긴다 — 빙빙 도는 강착류
          const a = Math.atan2(this.y - b.y, this.x - b.x)
          const ex = b.x + Math.cos(a) * b.r
          const ey = b.y + Math.sin(a) * b.r
          this.spawnGas(
            ex, ey, b.z + (this.z - b.z) * 0.3,
            Math.cos(a + 1.35) * R * 5 + (this.x - ex) * 0.6,
            Math.sin(a + 1.35) * R * 5 + (this.y - ey) * 0.6,
            (this.z - b.z) * 0.4,
            Math.max(4, gassy ? b.r * 0.16 : R * 0.8),
            Math.min(1.3, b.cr * 1.3), b.cg * 0.85, b.cb * 0.6, 1.4 + strength * 0.8,
          )
        }
      }
    }

    // ── 로슈 한계 — 삼키기엔 크고 나보다 작은 것: 바짝 붙으면 조석으로 찢긴다.
    let toShred: Body[] | null = null
    for (const b of this.active) {
      if (b.hot || this.eaten.has(b.id)) continue
      if (b.r < R * EDIBLE || b.r >= R) continue
      const d = Math.hypot(b.x - this.x, b.y - this.y, b.z - this.z)
      // 힐스 침묵 — 초대질량이 되면 조석 반경이 지평선 안으로 들어가 별이
      // 찢기지 않고 **소리 없이 통째로** 사라진다 (조사 ②-12, ~10⁸M☉ 상전이).
      // 파괴의 미학이 화려함에서 소름끼치는 정적으로 반전되는 순간.
      const rT = (R + b.r) * ROCHE * rocheOf(b.kind)
      if (d < rT) {
        if (rT < bodyRof(R) * 2.6) {
          this.eaten.add(b.id)
          const qi = this.active.indexOf(b)
          if (qi >= 0) this.active.splice(qi, 1)
          this.vol += b.r * b.r * b.r * ABSORB_GAIN
          this.gulp = Math.max(this.gulp, 0.3)
          continue
        }
        // 스파게티 예열 — 즉발 파쇄 대신 찢김 직전의 신장 한 박 (조사 ②-15)
        b.stretch = (b.stretch ?? 0) + step * 1.9
        if (b.stretch >= 1) (toShred ??= []).push(b)
      } else if (b.stretch) {
        b.stretch = Math.max(0, b.stretch - step * 2.5)
      }
    }
    // 불씨 시한 — 증발 PBH 는 기다려주지 않는다
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i]!
      if (b.decay === undefined) continue
      b.decay -= step
      if (b.decay <= 0) {
        this.eaten.add(b.id)
        this.active.splice(i, 1)
        for (let g2 = 0; g2 < 8; g2++) {
          const a2 = (g2 / 8) * Math.PI * 2
          this.spawnGas(b.x, b.y, b.z, Math.cos(a2) * 500, Math.sin(a2) * 500,
            ((g2 % 3) - 1) * 180, 6, 1.6, 1.4, 1.0, 1.1)
        }
      }
    }
    if (toShred) for (const b of toShred) this.shred(b)

    // ── 천체끼리의 충돌 — 서로에게도 물리가 있다 ("왜 부딪혀도 아무 일도
    // 안 일어나": 실플레이). 내가 끌어모은 무대 위에서만 검사한다.
    this.collideBodies(base)

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
      // 입은 구(球)가 아니라 두툼한 원반이다 — 수직은 내 지름(2R)까지 공짜,
      // 그 밖은 절반 무게. 입 반경 R×3.2: 순항하며 스쳐도 먹혀야 게임이다
      // (호버링 봇만 먹고 사람은 못 먹던 원인).
      const sx = this.x - prevX
      const sy = this.y - prevY
      const segL2 = sx * sx + sy * sy
      outer: for (const b of this.active) {
        if (this.absorbs.length >= 8) break
        if (b.r >= R * EDIBLE || this.eaten.has(b.id)) continue
        for (let i = 0; i < this.absorbs.length; i++) {
          if (this.absorbs[i]!.b.id === b.id) continue outer
        }
        const wx = b.x - prevX
        const wy = b.y - prevY
        const tt = segL2 > 0 ? Math.max(0, Math.min(1, (wx * sx + wy * sy) / segL2)) : 0
        const dxy = Math.hypot(prevX + sx * tt - b.x, prevY + sy * tt - b.y)
        const zc = prevZ + (this.z - prevZ) * tt - b.z
        const dzEff = Math.max(0, Math.abs(zc) - R * 2) * 0.5
        const d = Math.hypot(dxy, dzEff)
        // 팽창은 먹이 **자신의** 이동분만 — 상대속도면 내 속도가 이중 계상돼
        // 순항(×6)에서 수천 px 드라이브바이 통로가 열린다 (적대 리뷰).
        // 내 이동은 위의 선분 스윕이 이미 담당한다.
        // 중력 집속 — 고속 순항 중엔 회랑이 속도에 비례해 넓어진다 (실물리:
        // 중력 집속 단면적. 실플레이 "성간에서 평범한 걸 못 먹어" — 지나가기만
        // 하면 경로 주변이 항적으로 쓸려 들어온다. 정지 불필요).
        const bV = Math.hypot(b.vx, b.vy, b.vz)
        const focus = this.cruise > 2 ? Math.min(base * 2.5, sp0 * 0.05) : 0
        // 중력 집속 입 — σ = πR²(1+v_esc²/v_rel²): 느리게 나란히 날수록 보이지
        // 않는 입이 커진다 (조사 ②-1). 상한 √6 — 발산 방지.
        const relV2 = (b.vx - this.vx) ** 2 + (b.vy - this.vy) ** 2 + (b.vz - this.vz) ** 2
        const gfoc = Math.min(2.4, Math.sqrt(1 + (560 * R * (1 + R / 60)) / (relV2 + 900)))
        if (d < R * 3.2 * gfoc + b.r + bV * step + focus) {
          // 은하화 — 내가 크고 상대가 티끌이면 삼키지 않고 궤도에 가둔다.
          // 초대질량 블랙홀이 은하를 거느리는 방식 그대로: 영원히 돈다.
          if (R > 60 && b.r < R * 0.045 && this.halo.length < 380) {
            this.eaten.add(b.id)
            const idx2 = this.active.indexOf(b)
            if (idx2 >= 0) this.active.splice(idx2, 1)
            this.captureStar(b.id >>> 0, b.r, b.cr, b.cg, b.cb, 0)
            continue
          }
          // 프로즌 스타 — 큰 것일수록 지평선 앞에서 오래 얼어붙는다 (조사 ②-7)
          this.absorbs.push({ b, t: 0, dur: 0.16 + Math.min(0.9, (b.r / R) * 0.55) })
        }
      }
    }

    // ── 다른 검은 입들 — 성간의 사냥꾼들. 실제 블랙홀의 이름을 달고 있다.
    this.bittenCd = Math.max(0, this.bittenCd - step)
    for (let i = this.rivals.length - 1; i >= 0; i--) {
      const rv = this.rivals[i]!
      const rr = bhRadius(rv.vol)
      const dx = this.x - rv.x
      const dy = this.y - rv.y
      const dz = this.z - rv.z
      const d = Math.hypot(dx, dy, dz) || 1
      const bigger = rr > R
      // 라이벌은 적이 아니라 천체다 — 사냥 AI 없음 (사용자가 요청한 건 합병
      // 스펙터클뿐, 쫓아다니는 적은 설계 선언 "적 없음" 위반이었다: 실플레이).
      // 작은 놈은 중력대로 끌려와 나선낙하하고, 큰 놈은 그 자리의 위험 지형이다.
      // 중력은 동족도 예외가 아니다 ("중력이 있는데 왜 도망다니냐" — 실플레이).
      // 작은 놈은 내가 끈다: 멀리선 도주 추진이 이기고, 너무 가까우면 발버둥치며
      // 끌려온다. 큰 놈의 중력은 나를 끈다 — 단, 탈출은 언제나 가능해야 게임이다:
      // 당김 상한 = 내 추진의 75% (역추진 1.7배면 여유 있게 이긴다).
      if (!bigger && d < R * 14) {
        const g = Math.min(PULL_CAP_BY_ME, (R * R * GRAV * MAW_PULL) / (d * d))
        rv.vx += (dx / d) * g * step
        rv.vy += (dy / d) * g * step
        rv.vz += (dz / d) * g * step
      } else if (bigger && d < rr * 9) {
        const g = Math.min(thrustAcc(R) * 0.75, (rr * rr * GRAV) / (d * d))
        this.vx += (-dx / d) * g * step
        this.vy += (-dy / d) * g * step
        this.vz += (-dz / d) * g * step
      }
      // 조석 강탈 — 큰 검은 입 곁에 있으면 그것만으로 내 가스가 그쪽으로 흘러
      // 나간다 (시그너스 X-1 을 내가 당하는 쪽). 물기·밀치기·넉백은 없다 —
      // 블랙홀은 밀 수 없다 ("왜 나를 밀어내고 도망치냐": 실플레이 확정 결함).
      if (bigger) {
        const reach = (rr + R) * 2.6
        if (d < reach) {
          const prox = 1 - d / reach
          const drain = Math.min(this.vol - START_VOL, this.vol * (0.05 + 0.5 * prox * prox) * step)
          if (drain > 0) {
            this.vol -= drain
            rv.vol += drain
            this.feed = Math.max(this.feed, 0.3 + prox * 0.4)
            if (this.bittenCd <= 0) {
              this.bittenCd = 1.2
              this.camera.shake(2 + prox * 4, 6)
              this.sfx('hurt')
            }
            // 내 살이 리본으로 뜯겨 그쪽으로 감겨 간다 — 강탈이 눈에 보여야 한다
            const ga = Math.atan2(dy, dx) + 0.5
            this.spawnGas(
              this.x - (dx / d) * R * 0.8, this.y - (dy / d) * R * 0.8, this.z - (dz / d) * R * 0.5,
              -(dx / d) * (120 + prox * 260) - Math.sin(ga) * 60,
              -(dy / d) * (120 + prox * 260) + Math.cos(ga) * 60,
              -(dz / d) * (80 + prox * 160),
              Math.max(4, R * 0.4), 1.1, 0.55, 0.4, 1.1,
            )
          }
        }
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
      // 라이벌 자신의 이동분만 팽창 — 상대속도면 순항 스침이 화면 밖 합병이 된다
      const rvSp = Math.hypot(rv.vx, rv.vy, rv.vz)
      if (sd < (rr + R) * 0.9 + rvSp * step) {
        if (!bigger && !this.merging) {
          // 나선낙하 시작 — 즉석 흡수가 아니라 미친 회전으로 감아 돈다 (LIGO).
          // 나보다 크지만 않으면 전부: 예전엔 0.8R~1.0R 가 물지도 합병하지도
          // 못하는 사각지대라 그냥 부딪히기만 했다 ("병신같은거": 실플레이).
          // 실제로도 동급 질량 쌍성 합병이 LIGO 가 처음 들은 소리다 (GW150914).
          this.eaten.add(rv.id)
          this.merging = {
            ang: Math.atan2(rv.y - this.y, rv.x - this.x),
            rad: Math.max(d, R * 1.2),
            w: 2.2,
            t: 0,
            vol: rv.vol,
            z: rv.z - this.z,
            name: nameOf(rv.id)?.name ?? '블랙홀',
          }
          this.rivals.splice(i, 1)
          this.sfx('boom')
        }
      }
    }
    this.gulp = Math.max(0, this.gulp - step * 2.2)
    this.feed = Math.max(0, this.feed - step * 0.8)
    this.waveT += step

    // 은하 공전 — 포획된 별들은 나를 영원히 돌고, 세월에 따라 식는다
    for (const h of this.halo) {
      h.ang += h.w * step
      h.age += step
    }

    // QPE 심장박동 (조사 ㉔, 경량판) — 사형선고 받은 것이 곁을 도는 동안
    // 원반이 "두-둥" 장단으로 맥동한다 (궤도 관통 X선 섬광의 근사)
    for (const b of this.active) {
      if (!b.doomed) continue
      const dq = Math.hypot(b.x - this.x, b.y - this.y)
      if (dq < R * 9) {
        this.feed = Math.max(this.feed, 0.28 + 0.22 * Math.max(0, Math.sin(this.visualTime * 5.5 + b.id)))
        break
      }
    }

    // ── 퀘이사 게이지 — 에딩턴급 폭식이 이어지면 AGN 이 점화된다
    if (this.streamIn > this.vol * 0.04 || this.feed > 0.85) {
      this.quasar = Math.min(1, this.quasar + step * 0.55)
    } else {
      this.quasar = Math.max(0, this.quasar - step * 0.28)
    }
    // 상대론적 쌍제트 — 스핀축(z)으로 플라즈마를 뿜는다 (M87)
    this.jetCd -= step
    if (this.quasar > 0.3 && this.jetCd <= 0) {
      this.jetCd = 0.09
      const jv = 400 + R * 8
      for (const s of [1, -1]) {
        this.spawnGas(
          this.x + (Math.sin(this.visualTime * 7) * R) * 0.3, this.y, this.z + s * R * 1.2,
          this.vx * 0.5, this.vy * 0.5, s * jv,
          Math.max(5, R * 0.3), 0.75, 0.9, 1.4, 1.3,
        )
      }
    }

    // 혜성 이중 꼬리 — 이온(반태양 청색)·먼지(궤도 뒤 황백). 가까운 것만
    this.cometCd -= step
    if (this.cometCd <= 0) {
      this.cometCd = 0.22
      const near = base * 2.5
      for (const b of this.active) {
        if (b.kind !== BodyKind.Comet) continue
        const d = Math.hypot(b.x - this.x, b.y - this.y)
        if (d > near) continue
        let ax = -b.vx
        let ay = -b.vy
        if (b.host && b.host.kind === BodyKind.Sun) {
          ax = b.x - b.host.x
          ay = b.y - b.host.y
        }
        const al = Math.hypot(ax, ay) || 1
        this.spawnGas(b.x, b.y, b.z, (ax / al) * 160 + b.vx * 0.3, (ay / al) * 160 + b.vy * 0.3,
          0, b.r * 0.9, 0.45, 0.6, 1.1, 1.1) // 이온 꼬리 — 정확히 반태양
        this.spawnGas(b.x, b.y, b.z, -b.vx * 0.35, -b.vy * 0.35, 0,
          b.r * 1.1, 0.8, 0.72, 0.5, 1.5) // 먼지 꼬리 — 궤도 뒤로 처진다
      }
    }

    // ── 나선낙하 → 합병 — 각속도가 폭주하며 감아 돌다 하나가 된다 (LIGO 처프)
    if (this.merging) {
      const mg = this.merging
      mg.t += step
      mg.w += step * 11 // 처프 — 미친듯이 빨라진다
      // 이체 상호낙하 — 나도 질량중심으로 끌려간다: 동급일수록 내 몸이 크게
      // 흔들리며 상대에게 다가간다 (조사 ②-5, "서로 가까워져야"의 문자적 구현)
      {
        const mf = mg.vol / (mg.vol + this.vol)
        this.vx += Math.cos(mg.ang) * mg.rad * mf * 3.2 * step
        this.vy += Math.sin(mg.ang) * mg.rad * mf * 3.2 * step
      }
      mg.ang += mg.w * step
      mg.rad *= Math.exp(-1.5 * step)
      mg.z *= Math.exp(-2 * step)
      this.feed = Math.max(this.feed, 0.7)
      const rr = bhRadius(mg.vol)
      if (mg.rad < Math.max(2, R * 0.55) || mg.t > 2.6) {
        // 합병 완성 — 중력파가 퍼지고, 질량은 영상처럼 부풀어 들어온다
        this.streamIn += mg.vol * ABSORB_GAIN
        // 반동 킥 — 비대칭 중력파 방출의 반작용: 동급 합병일수록 세게 걷어차인다
        // (조사 ②-6, GW200129 실측 ~1542km/s). 잔해가 튕겨 나가는 손맛.
        {
          const mf = mg.vol / (mg.vol + this.vol)
          const kick = 620 * Math.pow(4 * mf * (1 - mf), 2)
          this.vx -= Math.cos(mg.ang) * kick
          this.vy -= Math.sin(mg.ang) * kick
          this.camera.shake(4 + kick * 0.01, 8)
        }
        this.gulp = 1
        this.feed = 1
        if (rr > this.biggestMeal) this.biggestMeal = Math.round(rr)
        const entry: JournalEntry = {
          name: mg.name,
          log: '',
          kind: BodyKind.Core,
          r: Math.round(rr),
          x: Math.round(this.x),
          y: Math.round(this.y),
        }
        this.journal.push(entry)
        this.lastFound = entry
        this.waveX = this.x
        this.waveY = this.y
        this.waveZ = this.z
        this.waveT = 0
        for (let g = 0; g < 14; g++) {
          const a = (g / 14) * Math.PI * 2
          this.spawnGas(this.x, this.y, this.z,
            Math.cos(a) * rr * 3, Math.sin(a) * rr * 3, ((g % 3) - 1) * rr,
            rr * 0.5, 0.5, 0.35, 0.6, 1.4)
        }
        // 합병 후 스타버스트 — 충돌 압축이 젊은 별들을 낳는다 (안테나 은하)
        this.quasar = 1
        for (let sb = 0; sb < 7; sb++) {
          this.captureStar(hashSeed(`sb:${this.eatCount}:${sb}`), 2 + (sb % 3), 0.75, 0.9, 1.35, 0)
        }
        this.spin = 0.67 // 합병 잔해 스핀 (GW150914 실측)
        this.merging = null
        this.sfx('bigKill')
        this.persist()
      }
    }

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
    let anyDist = Infinity
    let siegeDist = Infinity
    let sgX = 0
    let sgY = 0
    let sgZ = 0
    let sgId = 0
    let cX = 0
    let cY = 0
    let cZ = 0
    let meatyId = 0
    let lockB: Body | null = null
    let lockD = Infinity
    for (const b of this.active) {
      if (this.eaten.has(b.id)) continue
      const d = Math.hypot(b.x - this.x, b.y - this.y, b.z - this.z)
      // 순항 게이트용 표면 거리 — **삼킬 수 없는 큰 것만**(내 80% 이상, 공성 대상).
      // 간식까지 세면 성간의 상수 밀도 잔챙이가 거대 R 문턱 안에 늘 있어 순항이
      // 영영 안 붙는다 (계측 0~5%). 간식에 서고 싶으면 키를 놓으면 된다 —
      // 순항 해제(4.5/s)가 도착 브레이크보다 빠르다.
      if (b.r >= R * 0.8 && d - b.r < anyDist) anyDist = d - b.r
      if (b.id === this.preyLockId && b.r * b.r * b.r < this.vol) {
        lockB = b
        lockD = d
      }
      if (b.r >= R * EDIBLE) {
        // 공성 대상 — 통째론 못 삼켜도 질량이 내 밑이면 내 먹이다: 나침반이
        // 잡아야 한다 ("보이지도 않아서 먹지도 못하네": 실플레이)
        if (b.r * b.r * b.r < volE * 0.8 && d - b.r < siegeDist) {
          siegeDist = d - b.r
          sgX = b.x
          sgY = b.y
          sgZ = b.z
          sgId = b.id
        }
        continue
      }
      // 표적의 기준은 내 60% — 그 미만은 표적이 아니라 지나가며 흡입 회랑이
      // 쓸어담는 부산물이다 ("핵심 버리고 좆만한 것들 먹으러 염병": 실플레이).
      // 항법·화살은 실속(대형 한입·공성 대상·항로)만 쫓는다.
      if (b.r >= R * 0.6) {
        if (d < this.preyDist) {
          this.preyDist = d
          this.preyX = b.x
          this.preyY = b.y
          this.preyZ = b.z
          meatyId = b.id
        }
      } else if (d < crumbDist) {
        crumbDist = d
        cX = b.x
        cY = b.y
        cZ = b.z
      }
    }
    // 화살 우선순위: 한 입감 > 공성 대상 > 항로 > 잔부스러기
    if (this.preyDist === Infinity && siegeDist < Infinity) {
      this.preyDist = siegeDist
      this.preyX = sgX
      this.preyY = sgY
      this.preyZ = sgZ
      meatyId = sgId
    }
    // 표적 락온 — 문 표적은 먹거나 사라지거나 새 후보가 확실히(1.5배) 가까워질
    // 때까지 유지한다. 매 프레임 최근접 재계산은 자동 항법을 떠돌게 만든다
    // ("혼자 여기저기 떠돌아 뭔 알고리즘인지도 모르겠어": 실플레이).
    if (lockB && lockD < this.preyDist * 1.5) {
      this.preyDist = lockD
      this.preyX = lockB.x
      this.preyY = lockB.y
      this.preyZ = lockB.z
    } else {
      this.preyLockId = meatyId
    }
    this.nearAny = anyDist
    // 다음 항로 — 지도 항성계 곁("도착")이 아니라면 **언제나** 계산해 HUD 에
    // 내건다. 곁의 간식 유무로 껐다 켜면 분당 수 회 깜빡인다 (적대 리뷰 실측).
    // "태양 한번 먹고 더 할 게 없어"의 수리: 우주는 안 끝났다고 화면이 말해야 한다.
    this.routeName = null
    if (mapNearAll > base * 4) {
      let best = Infinity
      let bi = -1
      for (let i = 0; i < STAR_MAP.length; i++) {
        // 삼킨 계는 항로에서 제외 — ×4 후순위로는 "그 계 곁에 있으면 여전히
        // 최단"이라 먹은 별을 계속 가리켰다 (실플레이: 바너드 별). 곁에 남은
        // 성찬은 한입감 나침반이 따로 가리킨다.
        if (this.eaten.has(MAP_IDS[i]!)) continue
        const s = STAR_MAP[i]!
        // 체급 인식 — 내 질량의 8배가 넘는 앵커는 아직 내 항로가 아니다:
        // 어쩌지도 못할 별에 데려다 처박는 항법은 항법이 아니다 (실플레이).
        // 커질수록 베텔게우스·궁수자리 A* 가 차례로 항로에 열린다.
        if (s.r * s.r * s.r > volE * 8) continue
        const d = Math.hypot(s.x - this.x, s.y - this.y, s.z - this.z)
        if (d < best) {
          best = d
          bi = i
        }
      }
      if (bi >= 0) {
        const s = STAR_MAP[bi]!
        this.routeName = s.name
        this.routeDist = best
        this.routeX = s.x
        this.routeY = s.y
        this.routeZ = s.z
        // 화살 우선순위: 진짜 한 입감 > 항로 — 잔몹은 화살을 받을 자격이 없다
        if (this.preyDist === Infinity) {
          this.preyDist = best
          this.preyX = s.x
          this.preyY = s.y
          this.preyZ = s.z
        }
      }
    }
    // 잔부스러기 폴백은 항로조차 없을 때(지도 계 곁 청소 국면)만
    if (this.preyDist === Infinity && crumbDist < Infinity) {
      this.preyDist = crumbDist
      this.preyX = cX
      this.preyY = cY
      this.preyZ = cZ
    }

    // ── 성간 먼지 유입 — 우주는 다시 채워진다. 이게 없으면 먹은 자리가 판 내내
    // 사막이라 "먹을 게 없다"가 재발한다 (실플레이). 몇 초마다 근처에 새 티끌.
    this.driftCd -= step
    // 진짜 공허에는 뿌리지 않는다 — 절대거리 500~2100px 스폰이 6초마다 순항
    // 게이트·항로 나침반을 격추하던 원흉 (적대 리뷰 실측: 순항 가동률 0~3.6%).
    // 공허는 비어 있어야 순항이 살고, 재보급은 천체 곁에서만 이뤄진다.
    if (this.driftCd <= 0 && this.active.length < 900 && this.nearAny <= base * 3) {
      this.driftCd = 6
      this.driftN += 1
      const rng = new Rng(hashSeed(`drift:${this.driftN}`))
      const n = 2 + rng.int(2)
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2
        // 거리도 화면 눈금 비례 — 절대거리면 거대한 입(R·3.2)이 스폰을 그 자리에서 삼킨다
        const dd = base * (0.55 + rng.next() * 1.7)
        const id = hashSeed(`drift:${this.driftN}:${i}`)
        if (this.eaten.has(id)) continue
        const d = this.newBody(id, BodyKind.Dust,
          this.x + Math.cos(a) * dd, this.y + Math.sin(a) * dd,
          Math.max(2.6, Math.min(R * 0.5, 3 + rng.next() * 3 + R * 0.06)),
          0.55, 0.52, 0.62)
        d.z = this.z + (rng.next() - 0.5) * 500
        d.free = true
        const sx = Math.floor(d.x / SECTOR)
        const sy = Math.floor(d.y / SECTOR)
        this.sectors.get(`${sx},${sy}`)?.push(d)
        this.active.push(d)
      }
    }

    // 지역 — 도달한 곳의 이름만 띄운다 (등급 배너 폐지: 실플레이)
    this.regionCd -= step
    if (this.regionCd <= 0) {
      this.regionCd = 0.5
      const dSol = Math.hypot(this.x - 800, this.y - 800)
      let rg: string
      if (dSol < SHELL.kuiperIn) rg = '태양계'
      else if (dSol < SHELL.kuiperOut) rg = '카이퍼 벨트'
      else if (dSol < SHELL.oortIn) rg = '산란 원반'
      else if (dSol < SHELL.oortOut) rg = '오르트 구름'
      else {
        rg = '성간 공간'
        let bd = Infinity
        for (const s of STAR_MAP) {
          const d = Math.hypot(s.x - this.x, s.y - this.y) - s.r
          if (d < Math.max(s.r * 5, 15000) && d < bd) {
            bd = d
            rg = s.name
          }
        }
        for (const h of HOLES) {
          const d = Math.hypot(h.x - this.x, h.y - this.y) - h.r
          if (d < Math.max(h.r * 5, 15000) && d < bd) {
            bd = d
            rg = h.name
          }
        }
      }
      this.region = rg
    }

    this.refreshCd -= step
    this.persistCd -= step
    if (this.dirty && this.persistCd <= 0) this.persist()

    // 카메라 — 줌아웃이 곧 성장. 속도 확폭도 화면 눈금 비례.
    // 커지는 방향은 4초에 걸쳐 천천히(성장이 화면 사건이 되도록 — 재미 합성 1위
    // "꿀꺽 펀치"), 줄어드는 방향(브레이크 줌인)은 즉답.
    const speed = Math.hypot(this.vx, this.vy)
    const targetView = base + Math.min(1, speed / (base * 0.74)) * base * 0.95
    const easeK = targetView > this.camera.viewHeight ? 0.35 : 1.3
    this.camera.viewHeight += (targetView - this.camera.viewHeight) * (1 - Math.exp(-easeK * dt))
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
    // 성장은 영상처럼 — 수확은 한 틱 점프가 아니라 소화(질량 비례 에딩턴)를
    // 거쳐 부풀어 오른다 ("사람 크기부터 개큰 블랙홀까지 가는 영상": 사용자).
    // 즉시 반영은 티끌(3% 미만)만 — 즉시 문턱이 크면 요람 폭식으로 폭주한다
    // (봇 실측 30초 R22).
    // 스핀 — 순행으로 먹으면 오르고 역행이면 내린다 (Bardeen, 손 한계 0.998).
    // 스핀이 곧 소화 효율·제트 세기다 (조사 ②-23)
    const lzSpin = (b.x - this.x) * (b.vy - this.vy) - (b.y - this.y) * (b.vx - this.vx)
    this.spin = Math.max(0, Math.min(0.998,
      this.spin + Math.sign(lzSpin) * Math.min(0.03, (bMass / this.vol) * 0.15)))
    const gain = bMass * ABSORB_GAIN
    if (gain > this.vol * 0.5) {
      // t^(−5/3) 재강착 플레어 — 대어는 저장고에 들어가 상승(t²)→피크→멱감쇠
      // 곡선으로 흘러든다 (조사 ②-11, TDE 광도곡선). 총질량 보존.
      if (this.fallbacks.length < 4) this.fallbacks.push({ amt: gain, t: 0 })
      else this.streamIn += gain
    } else if (gain > this.vol * 0.08) this.streamIn += gain
    else this.vol += gain
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
    // 이름은 실명뿐 — 등록부(실지도)에 있거나 파편의 출신(origin)이 실명일 때만
    // 명부·화면에 남는다. 절차 이름("…의 잔해"·카탈로그 번호)은 표시 금지 (실플레이).
    const nm = nameOf(b.id)?.name ?? b.origin
    if (nm) {
      const entry: JournalEntry = {
        name: nm,
        log: '',
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
   * 천체 충돌 — 겹치면 큰 쪽이 작은 쪽을 삼킨다 (질량·운동량 보존, 15%는
   * 섬광 가스로 이탈). 검사는 내 주변 무대(base·40)의 후보 120개만 — 전 우주
   * n² 은 비용이 안 나오고, 충돌은 어차피 내가 끌어모은 곳에서 난다.
   * 파편(origin)·불씨(decay)가 작은 쪽이면 통과 — 파편 성찬과 불씨 보상은
   * 플레이어의 몫이다 (이전 판정 "파편 증발" 재발 방지).
   */
  private collideBodies(base: number): void {
    const lim = base * 40
    const cand: Body[] = []
    for (const b of this.active) {
      if (this.eaten.has(b.id) || b.r < 0.6) continue
      const dx = b.x - this.x
      const dy = b.y - this.y
      if (dx * dx + dy * dy > lim * lim) continue
      cand.push(b)
      if (cand.length >= 120) break
    }
    for (let i = 0; i < cand.length; i++) {
      const a = cand[i]!
      if (this.eaten.has(a.id)) continue
      for (let j = i + 1; j < cand.length; j++) {
        const c = cand[j]!
        if (this.eaten.has(c.id)) continue
        const dx = c.x - a.x
        const dy = c.y - a.y
        const rr = (a.r + c.r) * 0.72
        if (dx * dx + dy * dy > rr * rr) continue
        if (Math.abs(c.z - a.z) > rr * 1.5) continue
        const big = a.r >= c.r ? a : c
        const small = big === a ? c : a
        if (big.r < 1.2 || small.origin !== undefined || small.decay !== undefined) continue
        const m1 = big.r * big.r * big.r
        const m2 = small.r * small.r * small.r
        const f = m2 / (m1 + m2)
        big.vx += (small.vx - big.vx) * f
        big.vy += (small.vy - big.vy) * f
        big.vz += (small.vz - big.vz) * f
        big.r = Math.cbrt(m1 + m2 * 0.85)
        big.r0 = Math.max(big.r0, big.r)
        this.eaten.add(small.id)
        const si = this.active.indexOf(small)
        if (si >= 0) this.active.splice(si, 1)
        // 충돌 섬광 — 접점에서 작은 쪽의 색으로 터진다
        const cx = (a.x + c.x) * 0.5
        const cy = (a.y + c.y) * 0.5
        const cz = (a.z + c.z) * 0.5
        for (let gI = 0; gI < 6; gI++) {
          const ga = (gI / 6) * Math.PI * 2
          const sp = 80 + small.r * 6
          this.spawnGas(cx, cy, cz,
            Math.cos(ga) * sp + big.vx, Math.sin(ga) * sp + big.vy,
            ((gI % 3) - 1) * sp * 0.3,
            small.r * 0.5, Math.min(1.3, small.cr * 1.3), small.cg, small.cb * 0.8, 1.2)
        }
        if (this.eaten.has(a.id)) break
      }
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
    // 탈속박 사출 — 절반은 내 것이 아니다 (반반 법칙, Rees 1988): 고속 리본으로
    // 계 밖으로 튕겨 나간다. 조급함의 세금이 실물리가 됐다.
    for (let i = 0; i < 6; i++) {
      const t2 = i / 6
      const a2 = Math.atan2(b.y - this.y, b.x - this.x) - 0.9 + t2 * 0.55
      const spd = 900 + this.radius * 6
      this.spawnGas(b.x, b.y, b.z,
        Math.cos(a2) * spd + b.vx, Math.sin(a2) * spd + b.vy, (t2 - 0.5) * spd * 0.3,
        b.r * 0.3, 1.25, 1.05, 0.85, 1.6)
    }
    // 단단한 심 — 재회수 가능한 얼음 (질량 소수)
    this.spawnCores(b)
    this.gulp = Math.max(this.gulp, 0.6)
    this.feed = Math.max(this.feed, 0.55)
    this.camera.shake(3, 7)
    {
      const nm = nameOf(b.id)?.name ?? b.origin
      if (nm) {
        const entry: JournalEntry = {
          name: nm,
          log: '',
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
    this.sfx('kill')
  }

  /**
   * 은하에 별 하나 — 3성분 구조(실제 은하처럼): 안쪽은 붉은 팽대부(둥근 궤도),
   * 중간은 얇고 젊은 원반(나선팔 소속), 바깥은 성긴 헤일로. age 0 = 갓 태어난 청백색.
   */
  private captureStar(h: number, size: number, cr: number, cg: number, cb: number, age: number): void {
    // M-σ 밸브 (조사 ②-26): 은하는 내 질량에 걸맞게만 자라고(공진화),
    // 퀘이사 폭식 중엔 별이 못 자란다 (AGN 피드백 소광)
    if (this.quasar > 0.75) return
    const cap = Math.min(380, Math.round(10 + Math.pow(this.vol, 0.25) * 1.1))
    if (this.halo.length >= cap) return
    const k = 2.2 + (h % 1000) * 0.0048 // 2.2R ~ 7R
    const tier = k < 3.2 ? 0 : k < 5.6 ? 1 : 2
    this.halo.push({
      k,
      ang: (h % 628) * 0.01,
      w: (0.55 + ((h >>> 10) % 100) * 0.004) / Math.sqrt(k), // 케플러: 안쪽이 빠르다
      inc:
        tier === 0
          ? (((h >>> 5) % 100) * 0.01 - 0.5) * 1.6 // 팽대부 — 통통한 회전 타원체
          : tier === 1
            ? (((h >>> 5) % 100) * 0.01 - 0.5) * 0.1 // 원반 — 얇다
            : (((h >>> 5) % 100) * 0.01 - 0.5) * 0.9, // 헤일로 — 제멋대로
      size,
      cr: Math.min(1.2, cr * 1.2),
      cg: Math.min(1.1, cg * 1.1),
      cb,
      arm: h % 2,
      age,
      tier,
    })
  }

  /**
   * 별의 죽음 — 잠식으로 임계(원래 크기의 55%)를 넘긴 항성은 조용히 줄지 않는다.
   * 큰 별(r0>260)은 II형 초신성: 충격파 + 파편 성찬. 중간 별은 행성상성운:
   * 껍질을 벗고 백색왜성 심만 남긴다. 실제 항성 진화의 갈림길 그대로.
   */
  private stellarDeath(b: Body): void {
    this.eaten.add(b.id)
    const idx = this.active.indexOf(b)
    if (idx >= 0) this.active.splice(idx, 1)
    // 초신성 4경로 (조사 ②-21): 쌍불안정(초거성 — 심조차 안 남는 완전 소멸) /
    // II형(대형 — 함몰 후 폭발) / Ia형급 완전 파괴(중형) / 행성상성운(소형)
    const pair = b.r0 > 700
    const nova = b.r0 > 260
    for (let i = 0; i < (pair ? 30 : nova ? 22 : 14); i++) {
      const a = (i / (pair ? 30 : nova ? 22 : 14)) * Math.PI * 2
      const sp = pair ? 500 + b.r0 : nova ? 260 + b.r0 * 0.8 : 120 + b.r0 * 0.4
      this.spawnGas(
        b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r, b.z,
        Math.cos(a) * sp + b.vx, Math.sin(a) * sp + b.vy, ((i % 3) - 1) * sp * 0.3,
        b.r0 * (nova ? 0.2 : 0.14),
        nova ? 1.5 : 1.1, nova ? 1.2 : 0.9, nova ? 0.9 : 1.0, 1.8,
      )
    }
    if (!pair) this.spawnDeathCores(b, nova) // 쌍불안정은 심조차 남기지 않는다
    this.waveX = b.x
    this.waveY = b.y
    this.waveZ = b.z
    this.waveT = 0
    this.feed = 1
    this.streamIn += b.r * b.r * b.r * (pair ? 0.85 : 0.4) * ABSORB_GAIN
    this.camera.shake(pair ? 10 : nova ? 7 : 4, 7)
    const nm = nameOf(b.id)?.name
    if (nm) {
      const entry: JournalEntry = {
        name: nm,
        log: '',
        kind: b.kind,
        r: Math.round(b.r0),
        x: Math.round(b.x),
        y: Math.round(b.y),
      }
      this.journal.push(entry)
      this.lastFound = entry
      this.persistSoon()
    }
    this.sfx('nova')
  }

  /** 별 죽음의 잔해 — 초신성은 파편 다발, 행성상성운은 백색왜성 심 하나. */
  private spawnDeathCores(b: Body, nova: boolean): void {
    if (this.active.length > 1200) return
    const sx = Math.floor(b.x / SECTOR)
    const sy = Math.floor(b.y / SECTOR)
    const list = this.sectorBodies(sx, sy)
    const n = nova ? 7 : 1
    const originName = nameOf(b.id)?.name ?? b.origin
    for (let i = 0; i < n; i++) {
      const dSeed = hashSeed(`${b.id}:sn:${i}`)
      if (this.eaten.has(dSeed)) continue
      const a = (i / n) * Math.PI * 2 + (dSeed % 100) * 0.01
      const pr = nova
        ? Math.max(3, Math.min(this.radius * 0.5, b.r0 * 0.06 + ((dSeed >>> 5) % 20) * 0.2))
        : Math.max(4, Math.min(this.radius * 0.6, b.r0 * 0.1))
      const d = this.newBody(dSeed, BodyKind.Dust,
        b.x + Math.cos(a) * b.r * 0.8, b.y + Math.sin(a) * b.r * 0.8, pr,
        nova ? 1.3 : 1.5, nova ? 1.1 : 1.45, nova ? 0.8 : 1.4)
      d.z = b.z
      d.free = true
      d.hot = true
      d.origin = originName
      const sp = nova ? 200 + b.r0 * 0.5 : 40
      d.vx = Math.cos(a) * sp + b.vx
      d.vy = Math.sin(a) * sp + b.vy
      d.vz = b.vz
      list.push(d)
      this.active.push(d)
    }
  }

  /** 조석 파괴의 심 — 2개. 최소 크기는 내 몸 상대(≤0.35R): 연쇄 파쇄 방지. */
  private spawnCores(b: Body): void {
    if (this.active.length > 1200) return
    const sx = Math.floor(b.x / SECTOR)
    const sy = Math.floor(b.y / SECTOR)
    const list = this.sectorBodies(sx, sy)
    const minR = Math.min(2.2, this.radius * 0.35)
    const originName = nameOf(b.id)?.name ?? b.origin
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
      d.origin = originName
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
      const rr = bhRadius(rv.vol)
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
