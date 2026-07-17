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
  /**
   * 심장박동 BPM — 블랙홀의 맥. 무기 발사(8분음 양자화)·중력 펄스(마디 첫 박)·
   * 포식(8마디째)·BGM 이 전부 이 박자 하나에 물린다. 막이 오를수록 빨라진다.
   */
  readonly bpm: number
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
 * 그 뒤의 체력 곡선(1 → 32, 막 안 진행 1.55 포함 최대 50배)은 화력 140배의 일부만
 * 따라간다: 전부 상쇄하면 초당 수백 킬의 파워판타지가 죽는다. 이 값의 몫은 "군체는
 * 쓸리되 굵은 것(5막 Hex ≈ 2,280hp)은 화망 속에서 몇 초를 버티고 몸에 닿는다"까지다.
 * (한때 여기 적혔던 190/13,500hp 는 구조 수정 전의 시도값이다. 코드는 내려갔는데
 * 주석이 옛 서사를 계속 주장하고 있었다 — 주석도 계측 대상이다.)
 */
/**
 * 압박 비트 — 25~40초마다 삽입되는 이름 붙은 전투 상황.
 *
 * 균일한 스폰 흐름은 몇 분이면 "자동사냥 구경"이 된다(실플레이: "루즈하다").
 * 비트는 한 방향·한 진형으로 뭉쳐 온다 — 예고(파문·배너)를 보고, 자리를 잡고,
 * 해소하는 짧은 arc 가 생긴다. 위치를 강제해야 이동이 다시 결정이 된다.
 */
export interface BeatDef {
  readonly name: string
  readonly type: FoeType
  readonly count: number
  readonly hpMul: number
  /** 진형: 0 = 쐐기(한 방향 덩어리), 1 = 올가미(포위 링), 2 = 호송대(가로지르는 행렬) */
  readonly form: number
}

export const BEATS: readonly BeatDef[] = [
  { name: '잔불 조류', type: Foe.Mote, count: 55, hpMul: 0.8, form: 0 },
  { name: '사냥대', type: Foe.Husk, count: 11, hpMul: 1.0, form: 0 },
  { name: '호송대', type: Foe.Hex, count: 5, hpMul: 1.15, form: 2 },
  { name: '올가미', type: Foe.Wisp, count: 22, hpMul: 0.9, form: 1 },
  { name: '주시', type: Foe.Eye, count: 2, hpMul: 1.35, form: 0 },
]

/** 막별 등장 가능한 비트 (BEATS 인덱스). 뒤로 갈수록 흉포한 진형이 섞인다. */
export const ACT_BEATS: readonly (readonly number[])[] = [
  [0, 0, 1], // 1막: 조류 위주 — 배우는 시간의 파도
  [0, 1, 3],
  [1, 2, 3],
  [1, 2, 3, 4],
  [2, 3, 4, 0], // 5막의 조류는 물량 그 자체가 구경거리다
]

/**
 * 막의 계약 — 막이 바뀔 때마다 셋 중 하나를 **반드시** 고른다 (거절 없음).
 *
 * 균일한 15분은 6분쯤이면 결과가 정해진 관람이 된다. 계약은 같은 시드에서도
 * 플레이어가 런의 규칙을 저자로서 바꾸게 한다 — 전부 득실이 함께 있어야
 * "정답 찾기"가 아니라 "내 빌드에 맞는 위험 고르기"가 된다.
 * 전부 배율(1 = 무변화). dmg·maxHp·speed·cooldown 은 플레이어(loadout)가,
 * xp·foeHp·spawn·foeSpeed·heal 은 세계(game)가 적용한다.
 */
export interface PactDef {
  readonly name: string
  readonly desc: string
  readonly dmg: number
  readonly maxHp: number
  readonly speed: number
  readonly cooldown: number
  readonly xp: number
  readonly foeHp: number
  readonly spawn: number
  readonly foeSpeed: number
  readonly heal: number
}

export const PACTS: readonly PactDef[] = [
  {
    name: '혈월', desc: '적이 40% 더 몰려온다. 경험치 +35%',
    dmg: 1, maxHp: 1, speed: 1, cooldown: 1, xp: 1.35, foeHp: 1, spawn: 1.4, foeSpeed: 1, heal: 1,
  },
  {
    name: '유리심장', desc: '피해 +40%. 최대 체력 -25%',
    dmg: 1.4, maxHp: 0.75, speed: 1, cooldown: 1, xp: 1, foeHp: 1, spawn: 1, foeSpeed: 1, heal: 1,
  },
  {
    name: '잿바람', desc: '이동 +12%, 공격 속도 +12%. 적도 12% 빨라진다',
    dmg: 1, maxHp: 1, speed: 1.12, cooldown: 0.88, xp: 1, foeHp: 1, spawn: 1, foeSpeed: 1.12, heal: 1,
  },
  {
    name: '탐식', desc: '경험치 +25%. 회복이 절반만 떨어진다',
    dmg: 1, maxHp: 1, speed: 1, cooldown: 1, xp: 1.25, foeHp: 1, spawn: 1, foeSpeed: 1, heal: 0.5,
  },
  {
    name: '고행', desc: '적 체력 +30%. 경험치 +45%',
    dmg: 1, maxHp: 1, speed: 1, cooldown: 1, xp: 1.45, foeHp: 1.3, spawn: 1, foeSpeed: 1, heal: 1,
  },
  {
    name: '질풍', desc: '공격 속도 +20%. 적 체력 +15%',
    dmg: 1, maxHp: 1, speed: 1, cooldown: 0.8, xp: 1, foeHp: 1.15, spawn: 1, foeSpeed: 1, heal: 1,
  },
]

export const ACT_SECONDS = 180
export const ACTS: readonly ActDef[] = [
  {
    // 1막은 **배우는 시간**이다. 접촉 피해가 진짜가 되자 여기서 12~23초 만에 죽었다
    // (무기 1개, 화력 없음). 튜토리얼이 없는 게임이라 1막이 곧 튜토리얼이다.
    // 0.5는 과했다 — game.ts 의 warmup 과 겹쳐 초반이 텅 비고 첫 레벨업이 10초를
    // 넘겼다(결정론 테스트가 잡았다). 완만함의 주 담당은 warmup 하나로 몰았다.
    name: '잔불', sub: '죽은 별의 심장이 뛴다',
    tintA: [0.30, 0.13, 0.55], tintB: [0.05, 0.28, 0.45],
    weights: [{ type: Foe.Mote, w: 1 }],
    rate: 0.7, hp: 1, boss: Foe.Eye, bpm: 88,
  },
  {
    name: '조수', sub: '지평선이 숨을 들이쉰다',
    tintA: [0.10, 0.30, 0.58], tintB: [0.30, 0.10, 0.50],
    weights: [
      { type: Foe.Mote, w: 0.62 }, { type: Foe.Husk, w: 0.26 }, { type: Foe.Wisp, w: 0.12 },
    ],
    rate: 1.6, hp: 2.8, boss: Foe.Hex, bpm: 100,
  },
  {
    name: '균열', sub: '원반이 타오르기 시작한다',
    tintA: [0.52, 0.10, 0.42], tintB: [0.14, 0.16, 0.60],
    weights: [
      { type: Foe.Mote, w: 0.44 }, { type: Foe.Husk, w: 0.24 },
      { type: Foe.Wisp, w: 0.18 }, { type: Foe.Hex, w: 0.14 },
    ],
    rate: 2.6, hp: 7, boss: Foe.Eye, bpm: 112,
  },
  {
    name: '심연', sub: '빛도 되돌아오지 못한다',
    tintA: [0.44, 0.06, 0.16], tintB: [0.26, 0.04, 0.44],
    weights: [
      { type: Foe.Mote, w: 0.34 }, { type: Foe.Husk, w: 0.24 },
      { type: Foe.Wisp, w: 0.18 }, { type: Foe.Hex, w: 0.2 }, { type: Foe.Eye, w: 0.04 },
    ],
    rate: 3.6, hp: 17, boss: Foe.Hex, bpm: 124,
  },
  {
    // 마지막 막은 잔챙이가 없다. 4막과 종족 구성이 같으면 마지막 6분이 한 장면이다
    // (테스트가 이걸 잡았다). 여기선 무거운 것들만 밀려온다 — 물량이 아니라 무게로.
    name: '승천', sub: '삼켜지거나, 타오르거나',
    tintA: [0.85, 0.42, 0.10], tintB: [0.52, 0.10, 0.46],
    weights: [
      { type: Foe.Husk, w: 0.34 }, { type: Foe.Hex, w: 0.38 },
      { type: Foe.Wisp, w: 0.14 }, { type: Foe.Eye, w: 0.14 },
    ],
    // 42·5.2 → 36·4.9 → 32·4.6 세 눈금을 쟀는데 **완주율이 이 다이얼을 안 따라왔다.**
    // 후반 사망은 스탯 여유 부족이 아니라 스폰 초과의 구조적 홍수다(막 끝 초당
    // ~630 스폰 vs 킬 용량 ~300). 필요해지면 구조(킬 용량 연동 스폰 상한)로 풀 것.
    //
    // 주의: 봇 6판 표는 코드가 조금만 바뀌어도 크게 출렁인다(같은 날 완주 2→1→1→2→0).
    // 이 표로 미세조정하지 마라. 지키는 계약은 두 개다 —
    // ① 초반 사망 0 (earlygame.test 가 10종 × 90s 하한을 잠근다)
    // ② 완주는 봇 기준 소수 (블랙홀 개편 후 관측 2~4/6 — 봇은 전지적 상한이고,
    //    사람에겐 포식·중력·박자 회피가 얹힌다. 포식 흡입을 5.2→3.8로 낮추고
    //    포식 중 스폰 1.6배를 넣어도 완주율은 안 움직였다 — rate 다이얼과 마찬가지로
    //    완주율은 구조가 정하지 눈금이 정하지 않는다)
    rate: 4.6, hp: 32, boss: Foe.Eye, bpm: 136,
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
