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
  // z 는 그 거리에 닿을 몸집의 z 슬랩(0.8·시야) 안에 있어야 한다 — 못 닿는 명소는 고문이다
  const z = (((h % 1000) / 1000 - 0.5) * Math.min(4400, d * 0.016))
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, z }
}

function sys(
  name: string, ly: number, angleDeg: number, r: number,
  kind: MapSystem['kind'], color: [number, number, number], log: string,
  extra?: { planets?: readonly MapPlanet[]; companions?: MapSystem['companions'] },
): MapSystem {
  const p = at(ly, angleDeg, name)
  return {
    name, log, ly, x: p.x, y: p.y, z: p.z, r, kind,
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
  sys('프록시마 센타우리', 4.25, 210, 26, 'sun', [1.3, 0.5, 0.3],
    '태양에서 가장 가까운 별. 첫 번째 이웃이었다.', {
      planets: [{ name: '프록시마 b', r: 8, orbMul: 2.4, log: '가장 가까운 외계행성이었다.' }],
    }),
  sys('알파 센타우리', 4.37, 208, 100, 'sun', [1.8, 1.5, 0.7],
    '태양을 닮은 별. 인류가 처음 가려던 곳이었다.', {
      companions: [{ name: '알파 센타우리 B', r: 82, orbMul: 3.2, log: '둘이 함께 돌고 있었다.' }],
    }),
  sys('바너드 별', 5.96, 30, 24, 'sun', [1.2, 0.5, 0.3], '하늘에서 가장 빨리 움직이던 별.'),
  sys('볼프 359', 7.86, 120, 18, 'sun', [1.1, 0.4, 0.3], '아주 작고 아주 붉은 별이었다.'),
  sys('랄랑드 21185', 8.31, 100, 30, 'sun', [1.2, 0.55, 0.35], '북두칠성 곁의 조용한 왜성.'),
  sys('시리우스', 8.66, 160, 155, 'sun', [1.5, 1.6, 1.9],
    '밤하늘에서 가장 밝던 별. 큰개자리의 심장.', {
      companions: [{ name: '시리우스 B', r: 10, orbMul: 3.6, log: '죽은 별이 곁을 돌고 있었다 — 백색왜성.' }],
    }),
  sys('루이텐 726-8', 8.79, 175, 15, 'sun', [1.1, 0.45, 0.3], '섬광을 터뜨리던 쌍둥이 왜성.', {
    companions: [{ name: 'UV 고래자리', r: 14, orbMul: 2.8 }],
  }),
  sys('로스 154', 9.71, 250, 20, 'sun', [1.15, 0.45, 0.3], '궁수자리 쪽의 붉은 점.'),
  sys('로스 248', 10.29, 330, 18, 'sun', [1.15, 0.45, 0.3], '보이저 2호가 4만 년 뒤 스칠 별.'),
  sys('엡실론 에리다니', 10.47, 190, 78, 'sun', [1.6, 1.2, 0.6],
    '젊은 태양. 아직 먼지 원반을 두르고 있었다.', {
      planets: [{ name: '에기르', r: 12, orbMul: 3.4, log: '엡실론 에리다니 b — 실명이 붙은 행성.' }],
    }),
  sys('라카유 9352', 10.74, 235, 28, 'sun', [1.2, 0.5, 0.35], '남쪽 하늘의 빠른 왜성.'),
  sys('로스 128', 11.01, 145, 22, 'sun', [1.2, 0.5, 0.3], '고요한 왜성 — 섬광이 없어 살 만하다던 곳.', {
    planets: [{ name: '로스 128 b', r: 9, orbMul: 2.5 }],
  }),
  sys('백조자리 61', 11.4, 60, 56, 'sun', [1.5, 0.9, 0.5],
    '인류가 처음으로 거리를 잰 별.', {
      companions: [{ name: '백조자리 61 B', r: 50, orbMul: 3.4 }],
    }),
  sys('프로키온', 11.46, 140, 170, 'sun', [1.7, 1.5, 1.1], '작은개자리의 으뜸.', {
    companions: [{ name: '프로키온 B', r: 9, orbMul: 3.8, log: '여기도 백색왜성이 돌고 있었다.' }],
  }),
  sys('엡실론 인디', 11.87, 230, 66, 'sun', [1.6, 1.1, 0.55], '남쪽 인디언자리의 주황 별.'),
  sys('타우 세티', 11.91, 185, 72, 'sun', [1.7, 1.4, 0.7],
    'SF 가 사랑하던 별 — 태양을 가장 닮은 이웃.', {
      planets: [
        { name: '타우 세티 e', r: 9, orbMul: 2.6 },
        { name: '타우 세티 f', r: 10, orbMul: 3.5 },
      ],
    }),
  sys('알타이르', 16.7, 55, 160, 'sun', [1.8, 1.7, 1.4], '독수리자리의 으뜸 — 견우성.'),
  sys('글리제 581', 20.5, 200, 24, 'sun', [1.2, 0.5, 0.3], '행성이 줄줄이 딸린 왜성.', {
    planets: [
      { name: '글리제 581 c', r: 8, orbMul: 2.3 },
      { name: '글리제 581 g', r: 9, orbMul: 3.1, log: '있는지 없는지로 십 년을 싸운 행성.' },
    ],
  }),
  sys('베가', 25.0, 75, 230, 'sun', [1.6, 1.7, 2.0], '직녀성. 만 이천 년 뒤의 북극성.'),
  sys('포말하우트', 25.1, 240, 175, 'sun', [1.7, 1.6, 1.5], '남쪽 물고기의 입.', {
    planets: [{ name: '다갈라', r: 10, orbMul: 4.2, log: '포말하우트 b — 먼지 속의 유령 행성.' }],
  }),
  sys('아르크투루스', 36.7, 95, 780, 'sun', [1.9, 1.3, 0.5], '목동자리의 거성. 북두의 손잡이가 가리키던 곳.'),
  sys('트라피스트-1', 40.7, 220, 16, 'sun', [1.1, 0.4, 0.25],
    '일곱 세계를 거느린 초저온 왜성.', {
      planets: [
        { name: '트라피스트-1b', r: 2.9, orbMul: 1.9 },
        { name: '트라피스트-1c', r: 2.9, orbMul: 2.2 },
        { name: '트라피스트-1d', r: 2.4, orbMul: 2.5 },
        { name: '트라피스트-1e', r: 2.8, orbMul: 2.8, log: '가장 지구 같다던 일곱 중 넷째.' },
        { name: '트라피스트-1f', r: 3.1, orbMul: 3.1 },
        { name: '트라피스트-1g', r: 3.4, orbMul: 3.4 },
        { name: '트라피스트-1h', r: 2.3, orbMul: 3.8 },
      ],
    }),
  sys('카펠라', 42.9, 85, 320, 'sun', [1.8, 1.5, 0.8], '마차부자리의 염소 별 — 사실은 넷이었다.', {
    companions: [{ name: '카펠라 B', r: 260, orbMul: 3.0 }],
  }),
  sys('알데바란', 65.3, 150, 900, 'sun', [1.9, 1.1, 0.45], '황소의 눈. 붉게 타는 거성.'),
  sys('레굴루스', 79.3, 110, 260, 'sun', [1.7, 1.7, 1.8], '사자의 심장.'),
  sys('히아데스 성단', 153, 148, 0, 'garden', [0.9, 0.8, 0.6], '가장 가까운 성단 — 황소의 얼굴.'),
  sys('스피카', 250, 105, 480, 'sun', [1.5, 1.6, 2.0], '처녀자리의 이삭.'),
  sys('플레이아데스 성단', 444, 145, 0, 'garden', [0.7, 0.85, 1.2],
    '일곱 자매. 어느 문명이든 이 별무리의 이름을 지었다.'),
  sys('폴라리스', 433, 90, 420, 'sun', [1.7, 1.6, 1.3], '북극성. 모든 항해가 여기서 시작됐다.'),
  sys('안타레스', 554, 265, 1350, 'sun', [1.9, 0.7, 0.35], '화성의 라이벌 — 전갈의 심장.'),
  sys('베텔게우스', 548, 155, 1450, 'sun', [1.9, 0.8, 0.4],
    '오리온의 어깨. 언제 터져도 이상하지 않던 별.'),
  sys('리겔', 863, 165, 800, 'sun', [1.6, 1.7, 2.0], '오리온의 발. 푸른 초거성.'),
  sys('오리온 대성운', 1344, 158, 2400, 'garden', [0.9, 0.6, 1.0],
    '지구에서 가장 가까운 별의 요람이었다.'),
  sys('데네브', 2615, 65, 1900, 'sun', [1.7, 1.8, 2.0], '백조의 꼬리. 저 거리에 저 밝기였다.'),
  sys('게 성운', 6500, 130, 1600, 'garden', [0.8, 0.9, 1.1],
    '1054년 낮에도 보였다는 초신성의 잔해. 심장엔 펄서가 돈다.'),
  sys('독수리 성운', 7000, 255, 2600, 'garden', [0.7, 0.9, 0.8], '창조의 기둥이 서 있던 곳.'),
  sys('카리나 성운', 8500, 282, 2800, 'garden', [0.9, 0.7, 0.9], '에타 카리나이가 잠든 남쪽의 대성운.'),
  sys('궁수자리 A*', 26673, 270, 9000, 'core', [1.2, 0.95, 1.4],
    '우리 은하의 심장. 사백만 개의 태양이 뭉친 것.'),
  sys('안드로메다 은하', 2537000, 20, 26000, 'core', [1.1, 1.0, 1.3],
    '은하수 밖. 여기를 삼키는 날, 이 항해의 이름이 정해진다.'),
]

/** 태양계 껍질 경계 (게임 px) — 실제 구조의 축소: 행성계 → 카이퍼 → 산란 원반 → 오르트 */
export const SHELL = {
  /** 행성 궤도 끝 (해왕성 ~30AU) */
  planets: 1100,
  /** 카이퍼 벨트 30~50AU — 명왕성·에리스가 사는 곳 */
  kuiperIn: 3400,
  kuiperOut: 5400,
  /** 산란 원반 — 세드나의 영역 */
  scatterOut: 12000,
  /** 오르트 구름 — 혜성 수조 개의 껍질. 태양계의 진짜 끝 */
  oortIn: 14000,
  oortOut: 30000,
} as const

/** 카이퍼 벨트의 이름 있는 것들 (실존 왜소행성) */
export const KUIPER: readonly { name: string; r: number; orb: number; log: string }[] = [
  { name: '명왕성', r: 2.6, orb: 3600, log: '끝내 행성이 아니었던 것.' },
  { name: '에리스', r: 2.6, orb: 4600, log: '명왕성을 끌어내린 장본인.' },
  { name: '마케마케', r: 2.0, orb: 4300, log: '이스터 섬의 신의 이름을 받은 얼음.' },
  { name: '하우메아', r: 1.9, orb: 4400, log: '달걀처럼 도는 얼음 — 하루가 4시간.' },
  { name: '콰오아', r: 1.6, orb: 4000, log: '고리를 두른 작은 세계.' },
  { name: '아로코스', r: 1.2, orb: 4150, log: '인류가 가장 멀리서 만져본 돌.' },
  { name: '세드나', r: 1.8, orb: 9000, log: '만 년에 한 바퀴. 가장 외로운 궤도.' },
]

/** 인류가 가장 멀리 보낸 것들 — 성간 공간 어딘가에 떠 있다 (실제 이탈 방향 근사) */
export const PROBES: readonly { name: string; x: number; y: number; log: string }[] = [
  { name: '보이저 1호', x: 34000, y: 21000, log: '인류가 가장 멀리 보낸 것. 금빛 음반을 싣고 있었다.' },
  { name: '보이저 2호', x: 26000, y: -27000, log: '네 행성을 전부 스쳐 간 유일한 것.' },
  { name: '파이어니어 10호', x: -38000, y: 6000, log: '인류의 첫 성간 전령. 명판에는 인사하는 두 사람.' },
  { name: '파이어니어 11호', x: -19000, y: -31000, log: '신호가 끊긴 지 오래. 그래도 날고 있었다.' },
  { name: '뉴허라이즌스', x: 30000, y: -9000, log: '명왕성의 민낯을 처음 보여준 것.' },
]
