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

/**
 * 막 난이도 곡선.
 *
 * hp 를 1 → 9.5 로 뒀을 때 **가만히 서 있어도 15분을 완주했다.**
 * 실측: 15분 동안 받은 총 피해가 **167**(한 방도 안 된다), 180초 이후 계속 만피.
 *
 * 원인은 명확했다. 적 체력이 14.7배 느는 동안 플레이어 화력은 레벨성장 3배 ×
 * 완력 2.4배 × 무기렙 3.3배 × 무기 6종 ≈ **140배**로 는다. 근접 무기(호·신성·위성)가
 * 150px 반경에서 초당 만 단위를 넣으므로, 적이 마지막 150px 를 건너는 1초를 못 버틴다 —
 * 적이 5,210마리 쌓여도 **닿지를 못한다.** 요새가 성립한다.
 *
 * 34 로도, 85 로도 여전했다. 실측(t=880s): 적 8,581마리인데 **120px 안에는 1마리**.
 * 400px 안에 3,900 이 눌러오는데 못 뚫는다. 진화 무기 6종 — 특히 회오리(호 진화)가
 * 360° 지속 AOE 라 120px 짜리 믹서를 만들고, 적이 그 0.8초(148px/s 로 120px)를
 * 못 버틴다.
 *
 * 즉 요새는 체력 숫자로 깨지지 않았다. 실제로 깬 것은 **구조 수정 둘**이다 —
 * 접촉 피해를 한 방 크기로(foes.ts), 자석 레벨성장 제거(player.ts, 이동 동기 복원).
 * 그 뒤의 체력 곡선(1 → 36, 막 안 진행 1.55 포함 최대 56배)은 화력 140배의 일부만
 * 따라간다: 전부 상쇄하면 초당 수백 킬의 파워판타지가 죽는다. 이 값의 몫은 "군체는
 * 쓸리되 굵은 것(5막 Hex ≈ 2,570hp)은 화망 속에서 몇 초를 버티고 몸에 닿는다"까지다.
 * (한때 여기 적혔던 190/13,500hp 는 구조 수정 전의 시도값이다. 코드는 내려갔는데
 * 주석이 옛 서사를 계속 주장하고 있었다 — 주석도 계측 대상이다.)
 */
export const ACT_SECONDS = 180
export const ACTS: readonly ActDef[] = [
  {
    // 1막은 **배우는 시간**이다. 접촉 피해가 진짜가 되자 여기서 12~23초 만에 죽었다
    // (무기 1개, 화력 없음). 튜토리얼이 없는 게임이라 1막이 곧 튜토리얼이다.
    // 0.5는 과했다 — game.ts 의 warmup 과 겹쳐 초반이 텅 비고 첫 레벨업이 10초를
    // 넘겼다(결정론 테스트가 잡았다). 완만함의 주 담당은 warmup 하나로 몰았다.
    name: '잔불', sub: '별이 하나 꺼졌다',
    tintA: [0.30, 0.13, 0.55], tintB: [0.05, 0.28, 0.45],
    weights: [{ type: Foe.Mote, w: 1 }],
    rate: 0.7, hp: 1, boss: Foe.Eye,
  },
  {
    name: '조수', sub: '허공이 밀려온다',
    tintA: [0.10, 0.30, 0.58], tintB: [0.30, 0.10, 0.50],
    weights: [
      { type: Foe.Mote, w: 0.62 }, { type: Foe.Husk, w: 0.26 }, { type: Foe.Wisp, w: 0.12 },
    ],
    rate: 1.6, hp: 2.8, boss: Foe.Hex,
  },
  {
    name: '균열', sub: '무언가 들여다본다',
    tintA: [0.52, 0.10, 0.42], tintB: [0.14, 0.16, 0.60],
    weights: [
      { type: Foe.Mote, w: 0.44 }, { type: Foe.Husk, w: 0.24 },
      { type: Foe.Wisp, w: 0.18 }, { type: Foe.Hex, w: 0.14 },
    ],
    rate: 2.6, hp: 7, boss: Foe.Eye,
  },
  {
    name: '심연', sub: '빛이 닿지 않는 곳',
    tintA: [0.44, 0.06, 0.16], tintB: [0.26, 0.04, 0.44],
    weights: [
      { type: Foe.Mote, w: 0.34 }, { type: Foe.Husk, w: 0.24 },
      { type: Foe.Wisp, w: 0.18 }, { type: Foe.Hex, w: 0.2 }, { type: Foe.Eye, w: 0.04 },
    ],
    rate: 3.6, hp: 17, boss: Foe.Hex,
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
    // 42·5.2 → 36·4.9 → 32·4.6 세 눈금을 쟀는데 **완주율이 1/6에서 안 움직였다**
    // (사망 시각만 758~859s 사이에서 ±10s). 후반 사망은 스탯 여유 부족이 아니라
    // 스폰 초과의 구조적 홍수다(막 끝 초당 ~630 스폰 vs 킬 용량 ~300). 그러니 이
    // 다이얼로 완주율을 만들려 하지 마라 — 필요해지면 구조(킬 용량 연동 스폰 상한)로.
    // 지금 분포(초반 사망 0, 사망 전부 773~851s 의 "아깝게 실패", 완주 1/6)는
    // 피날레 긴장으로 수용한다. 사람 실플레이가 불공정하다고 느껴질 때만 재방문.
    rate: 4.6, hp: 32, boss: Foe.Eye,
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
