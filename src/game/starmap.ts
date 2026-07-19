/**
 * 실제 우주 지도 — 이 게임의 맵은 절차 생성이 아니라 **현실이다**.
 *
 * 태양이 원점이고, 실존 천체가 실제 거리 순서·실제(근사) 방향으로 박혀 있다.
 * 눈금: 1광년 = 50,000px (16광년까지 선형). 그 너머는 로그 압축 —
 * px(ly) = LY·(16 + 34·ln(ly/16)). 순서와 "멀다"의 감각은 보존되고,
 * 은하 중심(26,000광년)도 언젠가 닿을 수 있는 곳이 된다.
 *
 * 방향은 실제 하늘의 별자리 위치를 2D로 근사한 것이다 (궁수자리 = 남쪽 등).
 * 게임 y+ 가 북쪽이다.
 */
import { hashSeed } from '../engine/rng'

export const LY = 50000

export function pxOf(ly: number): number {
  return ly <= 16 ? ly * LY : LY * (16 + 34 * Math.log(ly / 16))
}

export interface MapPlanet {
  readonly name: string
  readonly r: number
  readonly orbMul: number
  readonly ringed?: boolean
  readonly log?: string
}

export interface MapSystem {
  readonly name: string
  readonly log: string
  /** 실거리 (광년) — 기록용. 게임 좌표는 x,y 로 이미 압축돼 있다 */
  readonly ly: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly r: number
  /** 'sun' | 'garden' | 'core' — Voyage 가 BodyKind 로 옮긴다 */
  readonly kind: 'sun' | 'garden' | 'core'
  readonly cr: number
  readonly cg: number
  readonly cb: number
  readonly planets?: readonly MapPlanet[]
  /** 동반성 — 쌍성·삼중성 (실제 다중성계) */
  readonly companions?: readonly { name: string; r: number; orbMul: number; log?: string }[]
}

function at(ly: number, angleDeg: number, name: string): { x: number; y: number; z: number } {
  const d = pxOf(ly)
  const a = (angleDeg * Math.PI) / 180
  const h = hashSeed(`map:${name}`)
  // 별은 구형으로 흩어져 있다 — z ±35% 거리 (구 z-슬랩 시절의 1.6% 압착은
  // "별자리가 일렬"을 만들던 유물: 실플레이. z 상한 폐지로 전부 닿는다)
  const z = (((h % 1000) / 1000 - 0.5) * 0.7 * d)
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, z }
}

function sys(
  name: string, ly: number, angleDeg: number, r: number,
  kind: MapSystem['kind'], color: [number, number, number], log: string,
  extra?: { planets?: readonly MapPlanet[]; companions?: MapSystem['companions'] },
): MapSystem {
  const p = at(ly, angleDeg, name)
  // 성운·은하는 은하 원반(얇은 층)에 있다 — 실물리이자 도달 가능성: z 를 심연에
  // 두면 "가까이 오니 사라져"가 된다 (실플레이). 항성만 구형 분포 유지.
  const z = kind === 'sun' ? p.z : Math.max(-42000, Math.min(42000, p.z))
  return {
    name, log, ly, x: p.x, y: p.y, z, r, kind,
    cr: color[0], cg: color[1], cb: color[2],
    planets: extra?.planets, companions: extra?.companions,
  }
}

/**
 * 항성 지도 — 태양에서 가까운 순서대로, 실존하는 것들.
 * 크기는 게임 눈금(태양=90)에 맞춘 상대 감각이다: 적색왜성은 태양보다 작고,
 * 시리우스는 크고, 베텔게우스는 괴물이다. 백색왜성 동반성은 작다.
 */
export const STAR_MAP: readonly MapSystem[] = [
  sys('프록시마 센타우리', 4.25, 210, 26, 'sun', [1.3, 0.5, 0.3], '', {
      planets: [{ name: '프록시마 b', r: 8, orbMul: 2.4, log: '' }],
    }),
  sys('알파 센타우리', 4.37, 208, 100, 'sun', [1.8, 1.5, 0.7], '', {
      companions: [{ name: '알파 센타우리 B', r: 82, orbMul: 3.2, log: '' }],
    }),
  sys('바너드 별', 5.96, 30, 24, 'sun', [1.2, 0.5, 0.3], ''),
  sys('볼프 359', 7.86, 120, 18, 'sun', [1.1, 0.4, 0.3], ''),
  sys('랄랑드 21185', 8.31, 100, 30, 'sun', [1.2, 0.55, 0.35], ''),
  sys('시리우스', 8.66, 160, 155, 'sun', [1.5, 1.6, 1.9], '', {
      companions: [{ name: '시리우스 B', r: 10, orbMul: 3.6, log: '' }],
    }),
  sys('루이텐 726-8', 8.79, 175, 15, 'sun', [1.1, 0.45, 0.3], '', {
    companions: [{ name: 'UV 고래자리', r: 14, orbMul: 2.8 }],
  }),
  sys('로스 154', 9.71, 250, 20, 'sun', [1.15, 0.45, 0.3], ''),
  sys('로스 248', 10.29, 330, 18, 'sun', [1.15, 0.45, 0.3], ''),
  sys('엡실론 에리다니', 10.47, 190, 78, 'sun', [1.6, 1.2, 0.6], '', {
      planets: [{ name: '에기르', r: 12, orbMul: 3.4, log: '' }],
    }),
  sys('라카유 9352', 10.74, 235, 28, 'sun', [1.2, 0.5, 0.35], ''),
  sys('로스 128', 11.01, 145, 22, 'sun', [1.2, 0.5, 0.3], '', {
    planets: [{ name: '로스 128 b', r: 9, orbMul: 2.5 }],
  }),
  sys('백조자리 61', 11.4, 60, 56, 'sun', [1.5, 0.9, 0.5], '', {
      companions: [{ name: '백조자리 61 B', r: 50, orbMul: 3.4 }],
    }),
  sys('프로키온', 11.46, 140, 170, 'sun', [1.7, 1.5, 1.1], '', {
    companions: [{ name: '프로키온 B', r: 9, orbMul: 3.8, log: '' }],
  }),
  sys('엡실론 인디', 11.87, 230, 66, 'sun', [1.6, 1.1, 0.55], ''),
  sys('타우 세티', 11.91, 185, 72, 'sun', [1.7, 1.4, 0.7], '', {
      planets: [
        { name: '타우 세티 e', r: 9, orbMul: 2.6 },
        { name: '타우 세티 f', r: 10, orbMul: 3.5 },
      ],
    }),
  sys('알타이르', 16.7, 55, 160, 'sun', [1.8, 1.7, 1.4], ''),
  sys('글리제 581', 20.5, 200, 24, 'sun', [1.2, 0.5, 0.3], '', {
    planets: [
      { name: '글리제 581 c', r: 8, orbMul: 2.3 },
      { name: '글리제 581 g', r: 9, orbMul: 3.1, log: '' },
    ],
  }),
  sys('베가', 25.0, 75, 230, 'sun', [1.6, 1.7, 2.0], ''),
  sys('포말하우트', 25.1, 240, 175, 'sun', [1.7, 1.6, 1.5], '', {
    planets: [{ name: '다갈라', r: 10, orbMul: 4.2, log: '' }],
  }),
  sys('폴룩스', 33.8, 113, 185, 'sun', [1.8, 1.15, 0.55], '', {
      planets: [{ name: '테스티아스', r: 12, orbMul: 3.1, log: '' }],
    }),
  sys('아르크투루스', 36.7, 95, 780, 'sun', [1.9, 1.3, 0.5], ''),
  sys('트라피스트-1', 40.7, 220, 16, 'sun', [1.1, 0.4, 0.25], '', {
      planets: [
        { name: '트라피스트-1b', r: 2.9, orbMul: 1.9 },
        { name: '트라피스트-1c', r: 2.9, orbMul: 2.2 },
        { name: '트라피스트-1d', r: 2.4, orbMul: 2.5 },
        { name: '트라피스트-1e', r: 2.8, orbMul: 2.8, log: '' },
        { name: '트라피스트-1f', r: 3.1, orbMul: 3.1 },
        { name: '트라피스트-1g', r: 3.4, orbMul: 3.4 },
        { name: '트라피스트-1h', r: 2.3, orbMul: 3.8 },
      ],
    }),
  sys('카펠라', 42.9, 85, 320, 'sun', [1.8, 1.5, 0.8], '', {
    companions: [{ name: '카펠라 B', r: 260, orbMul: 3.0 }],
  }),
  sys('알데바란', 65.3, 150, 900, 'sun', [1.9, 1.1, 0.45], ''),
  sys('레굴루스', 79.3, 110, 260, 'sun', [1.7, 1.7, 1.8], ''),
  sys('히아데스 성단', 153, 148, 0, 'garden', [0.9, 0.8, 0.6], ''),
  sys('스피카', 250, 105, 480, 'sun', [1.5, 1.6, 2.0], ''),
  sys('플레이아데스 성단', 444, 145, 0, 'garden', [0.7, 0.85, 1.2], ''),
  sys('폴라리스', 433, 90, 420, 'sun', [1.7, 1.6, 1.3], ''),
  sys('안타레스', 554, 265, 1350, 'sun', [1.9, 0.7, 0.35], ''),
  sys('베텔게우스', 548, 155, 1450, 'sun', [1.9, 0.8, 0.4], ''),
  sys('헬릭스 성운', 650, 245, 700, 'garden', [0.5, 0.85, 0.9], ''),
  sys('리겔', 863, 165, 800, 'sun', [1.6, 1.7, 2.0], ''),
  sys('말머리 성운', 1375, 157, 1100, 'garden', [0.8, 0.5, 0.7], ''),
  sys('오리온 대성운', 1344, 158, 2400, 'garden', [0.9, 0.6, 1.0], ''),
  sys('베일 성운', 2400, 68, 1500, 'garden', [0.7, 0.9, 1.0], ''),
  sys('고리 성운', 2567, 62, 620, 'garden', [0.6, 0.8, 0.9], ''),
  sys('데네브', 2615, 65, 1900, 'sun', [1.7, 1.8, 2.0], ''),
  sys('석호 성운', 4100, 268, 1900, 'garden', [1.0, 0.6, 0.8], ''),
  sys('백조자리 X-1', 6070, 63, 300, 'core', [0.9, 0.7, 1.2], '', {
      companions: [{ name: 'HDE 226868', r: 720, orbMul: 4.5, log: '' }],
    }),
  sys('게 성운', 6500, 130, 1600, 'garden', [0.8, 0.9, 1.1], ''),
  sys('독수리 성운', 7000, 255, 2600, 'garden', [0.7, 0.9, 0.8], ''),
  sys('카리나 성운', 8500, 282, 2800, 'garden', [0.9, 0.7, 0.9], ''),
  sys('오메가 센타우리', 15800, 232, 0, 'garden', [1.0, 0.95, 0.8], ''),
  sys('궁수자리 A*', 26673, 270, 9000, 'core', [1.2, 0.95, 1.4], ''),
  sys('큰 마젤란 은하', 158200, 278, 30000, 'core', [0.9, 0.85, 1.1], ''),
  sys('작은 마젤란 은하', 199000, 285, 20000, 'core', [0.85, 0.8, 1.05], ''),
  sys('안드로메다 은하', 2537000, 20, 26000, 'core', [1.1, 1.0, 1.3], ''),
  sys('삼각형자리 은하', 2730000, 28, 20000, 'core', [1.0, 0.95, 1.2], ''),
]

/**
 * 실존 블랙홀 카탈로그 — 우주 시뮬(SpaceEngine·Celestia)처럼 블랙홀은 희귀
 * 랜드마크다. 절차 생성 금지 ("무슨 다른 천체 있듯 블랙홀이 있어": 실플레이).
 */
export const HOLES: readonly { name: string; r: number; x: number; y: number; z: number; log: string }[] = [
  { ...at(1560, 252, '가이아 BH1'), name: '가이아 BH1', r: 90, log: '' },
  { ...at(1926, 57, '가이아 BH3'), name: '가이아 BH3', r: 210, log: '' },
  { ...at(3800, 215, '가이아 BH2'), name: '가이아 BH2', r: 110, log: '' },
  { ...at(4700, 150, 'V616 모노케로티스'), name: 'V616 모노케로티스', r: 100, log: '' },
  { ...at(7800, 63, 'V404 백조자리'), name: 'V404 백조자리', r: 140, log: '' },
  { ...at(11000, 265, 'GRO J1655-40'), name: 'GRO J1655-40', r: 130, log: '' },
  // IMBH 관문 — 질량 사다리의 잃어버린 계단 (조사 ②-19): 성단 코어의 중간질량
  { ...at(13000, 233, '47 큰부리새 IMBH'), name: '47 큰부리새 IMBH', r: 360, log: '' },
  { ...at(15800, 232, '오메가 센타우리 IMBH'), name: '오메가 센타우리 IMBH', r: 480, log: '' },
  { ...at(33600, 90, 'M15 IMBH'), name: 'M15 IMBH', r: 560, log: '' },
]

/** 태양계 껍질 경계 (게임 px) — 실제 구조의 축소: 행성계 → 카이퍼 → 산란 원반 → 오르트 */
export const SHELL = {
  /** 행성 궤도 끝 (해왕성 ~30AU) */
  planets: 1100,
  /** 카이퍼 벨트 30~50AU — 명왕성·에리스가 사는 곳 */
  kuiperIn: 3400,
  kuiperOut: 5400,
  /** 산란 원반 — 세드나의 영역. 공백 축소 ("공백은 줄이고 구조는 키운다") */
  scatterOut: 9500,
  /** 오르트 구름 — 혜성 수조 개의 껍질. 태양계의 진짜 끝 */
  oortIn: 10500,
  oortOut: 21000,
} as const

/** 카이퍼 벨트의 이름 있는 것들 (실존 왜소행성) */
export const KUIPER: readonly { name: string; r: number; orb: number; log: string }[] = [
  { name: '명왕성', r: 2.6, orb: 3600, log: '' },
  { name: '에리스', r: 2.6, orb: 4600, log: '' },
  { name: '마케마케', r: 2.0, orb: 4300, log: '' },
  { name: '하우메아', r: 1.9, orb: 4400, log: '' },
  { name: '콰오아', r: 1.6, orb: 4000, log: '' },
  { name: '아로코스', r: 1.2, orb: 4150, log: '' },
  { name: '세드나', r: 1.8, orb: 9000, log: '' },
]

/** 인류가 가장 멀리 보낸 것들 — 성간 공간 어딘가에 떠 있다 (실제 이탈 방향 근사) */
export const PROBES: readonly { name: string; x: number; y: number; log: string }[] = [
  { name: '보이저 1호', x: 34000, y: 21000, log: '' },
  { name: '보이저 2호', x: 26000, y: -27000, log: '' },
  { name: '파이어니어 10호', x: -38000, y: 6000, log: '' },
  { name: '파이어니어 11호', x: -19000, y: -31000, log: '' },
  { name: '뉴허라이즌스', x: 30000, y: -9000, log: '' },
]
