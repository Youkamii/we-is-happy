/**
 * 막(Act) — 15분 런의 뼈대.
 *
 * 5분은 짧고 15분은 지루해지기 쉽다. 같은 그림이 15분 반복되면 실패다.
 * 그래서 3분짜리 막 5개로 나누고, 막마다 등장 종족·밀도·성운 색·음악을 바꾼다.
 * 막이 바뀌는 순간이 곧 "여기까지 왔다"는 이정표가 된다.
 *
 * 스폰 규칙을 game.ts 상수에서 여기 데이터로 뺐다 — 밸런싱이 코드 수정이 되면 안 된다.
 */
import { Foe, type FoeType } from './pools'

export interface ActDef {
  readonly name: string
  /** 부제 — 막 전환 연출에 뜬다 */
  readonly sub: string
  /** 성운 색 두 개. HDR 이라 1을 넘겨도 된다. */
  readonly tintA: readonly [number, number, number]
  readonly tintB: readonly [number, number, number]
  /** 이 막에서 나오는 종족과 가중치 (합이 1일 필요는 없다) */
  readonly weights: readonly { readonly type: FoeType; readonly w: number }[]
  /** 초당 스폰 예산 배율 */
  readonly rate: number
  /** 적 체력 배율 */
  readonly hp: number
  /** 막 끝 보스 */
  readonly boss: FoeType
}

export const ACT_SECONDS = 180
export const ACTS: readonly ActDef[] = [
  {
    name: '잔불', sub: '별이 하나 꺼졌다',
    tintA: [0.30, 0.13, 0.55], tintB: [0.05, 0.28, 0.45],
    weights: [{ type: Foe.Mote, w: 1 }],
    rate: 1, hp: 1, boss: Foe.Eye,
  },
  {
    name: '조수', sub: '허공이 밀려온다',
    tintA: [0.10, 0.30, 0.58], tintB: [0.30, 0.10, 0.50],
    weights: [
      { type: Foe.Mote, w: 0.62 }, { type: Foe.Husk, w: 0.26 }, { type: Foe.Wisp, w: 0.12 },
    ],
    rate: 1.5, hp: 1.9, boss: Foe.Hex,
  },
  {
    name: '균열', sub: '무언가 들여다본다',
    tintA: [0.52, 0.10, 0.42], tintB: [0.14, 0.16, 0.60],
    weights: [
      { type: Foe.Mote, w: 0.44 }, { type: Foe.Husk, w: 0.24 },
      { type: Foe.Wisp, w: 0.18 }, { type: Foe.Hex, w: 0.14 },
    ],
    rate: 2.3, hp: 3.4, boss: Foe.Eye,
  },
  {
    name: '심연', sub: '빛이 닿지 않는 곳',
    tintA: [0.44, 0.06, 0.16], tintB: [0.26, 0.04, 0.44],
    weights: [
      { type: Foe.Mote, w: 0.34 }, { type: Foe.Husk, w: 0.24 },
      { type: Foe.Wisp, w: 0.18 }, { type: Foe.Hex, w: 0.2 }, { type: Foe.Eye, w: 0.04 },
    ],
    rate: 3.2, hp: 5.8, boss: Foe.Hex,
  },
  {
    // 마지막 막은 잔챙이가 없다. 4막과 종족 구성이 같으면 마지막 6분이 한 장면이다
    // (테스트가 이걸 잡았다). 여기선 무거운 것들만 밀려온다 — 물량이 아니라 무게로.
    name: '승천', sub: '꺼지거나, 타오르거나',
    tintA: [0.85, 0.42, 0.10], tintB: [0.52, 0.10, 0.46],
    weights: [
      { type: Foe.Husk, w: 0.34 }, { type: Foe.Hex, w: 0.38 },
      { type: Foe.Wisp, w: 0.14 }, { type: Foe.Eye, w: 0.14 },
    ],
    rate: 4.6, hp: 9.5, boss: Foe.Eye,
  },
]

export const RUN_SECONDS = ACT_SECONDS * ACTS.length // 900 = 15분

/** 지금 몇 막인가 (0-based). 끝을 넘으면 마지막 막에 머문다. */
export function actIndexAt(elapsed: number): number {
  return Math.min(ACTS.length - 1, Math.floor(elapsed / ACT_SECONDS))
}

/** 막 안에서의 진행도 0..1 */
export function actProgressAt(elapsed: number): number {
  return (elapsed % ACT_SECONDS) / ACT_SECONDS
}

/**
 * 보스가 나올 시점인가.
 * 막 끝 20초 전에 한 번. 남은 시간이 있어야 보스를 잡고 정리할 여유가 생긴다.
 */
export const BOSS_AT = ACT_SECONDS - 20

/** 막 전환 연출이 뜨는 구간 (막 시작 후 몇 초 동안) */
export const ACT_INTRO_SECONDS = 3.4
