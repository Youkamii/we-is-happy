import { Shape } from './shapes'

/**
 * 밝기 위계 — 이 게임의 시각 규칙 단일 진실.
 *
 * 문제였던 것: 적도 2.9, 탄도 3.4, 지형도, 파티클도 전부 HDR 1.0 을 한참 넘겼다.
 * bloom 임계값이 1.05 이니 **화면의 모든 것이 번졌고**, 전부 밝으면 아무것도 안 밝다.
 * 사용자 피드백: "이펙트 너무 세서 화면이 안 보임".
 *
 * 규칙 하나: **1.0 을 넘는 건 특권이다.** 넘는 순간 bloom 이 물고 화면을 지배한다.
 * 그 특권은 지금 이 순간 가장 중요한 것에만 준다.
 *
 *   BG      0.02~0.15  배경 성운·별. 있는지도 모를 정도.
 *   TERRAIN 0.10~0.30  지형. 구조만 읽히면 된다. 절대 안 번진다.
 *   DROP    0.35~0.70  XP. 보이되 시선을 뺏지 않는다.
 *   FOE     0.55~1.00  적. **이게 기준선이다** — 화면의 대부분을 차지하므로
 *                      여기가 1.0 을 넘으면 그 순간 화면이 하얘진다.
 *   SHOT    0.90~1.30  내 탄. 적보다 조금 밝다.
 *   ACCENT  1.4~2.2    치명타·명중 플래시·진화탄. 짧고 드물다.
 *   PLAYER  1.6~2.4    나. 화면에서 제일 밝다. 하나뿐이라 안전하다.
 *   EVENT   2.5~3.5    진화·보스 등장·레벨업. 세리머니. 1초 미만.
 */

/** 적 기준선. FOE_STATS 의 색은 이 배율 안에서 논다. */
export const FOE_BASE = 0.78
/** 내 탄 */
export const SHOT_BASE = 1.05
/** 지형 */
export const TERRAIN_BASE = 0.2
/** 드랍 */
export const DROP_BASE = 0.55
/** 플레이어 코어 */
export const PLAYER_BASE = 2.0
/** 명중·치명 등 순간 강조 */
export const ACCENT = 1.8
/** 세리머니 (진화·보스) */
export const EVENT = 3.0

/**
 * 파티클 밝기. 후반에 수천 개가 겹치므로 개당은 아주 어두워야 한다 —
 * 이게 누적돼 화면을 태웠다.
 */
export const FX_BASE = 0.5

/** 지속 효과체(필드). 바닥에 깔린 것이라 적보다 어둡다. */
export const FIELD_BASE = 0.42

// ── 광량 보존 ──────────────────────────────────────────────────────────

/**
 * 윤곽 모양(링·광륜·인장·소용돌이…) — 쿼드 면적 대비 실제로 빛나는 픽셀이
 * 둘레 비례라, 채움 모양과 감광 지수가 달라야 한다. 렌더 hot path 라 Set 대신 표.
 */
export const SHAPE_SPARSE = new Uint8Array(24)
for (const s of [
  Shape.Ring, Shape.Halo, Shape.Sigil, Shape.Vortex, Shape.Singularity,
  Shape.Rift, Shape.Rune, Shape.Crack, Shape.Nova,
]) SHAPE_SPARSE[s] = 1

/**
 * 광량 보존 감광 — 세 번째 실플레이 보고("범위 확장 몇 번이면 화면이 하얘진다")의
 * 구조적 해답.
 *
 * 가법 블렌딩에서 쿼드가 화면에 더하는 빛은 **밝기 × 면적**이다. 크기가 스탯
 * (범위·폭심)으로 커질 때 밝기가 그대로면 방출 광량이 크기²로 폭증한다 —
 * 범위 ×2.5 = 빛 ×6, 무기 6종이 겹치면 ACES 톤매퍼가 포화돼 백색이 된다
 * (fxbudget.test 실측: 중심 광량 p95 = 3.66, 상한의 3.7배).
 *
 * 그래서 기준 크기를 넘는 fx 쿼드는 넘친 만큼 어두워진다. 채움 모양은 면적 비례라
 * 지수 1.5, 윤곽 모양은 둘레 비례라 지수 1. 개별 밝기 위계(위 규칙)와 직교하는
 * 세 번째 축이다: 밝기 위계(개당) × 연출 예산(개수, fx.ts) × 광량 보존(크기).
 */
export function conserve(size: number, sparse: number): number {
  if (sparse === 1) return size > 80 ? 80 / size : 1
  if (size <= 46) return 1
  const k = 46 / size
  // 지수 2 = 순수 에너지 보존. 1.5 로 시작했더니 최악 빌드 p95 가 1.39 로 상한(1.0)을
  // 넘었다 — 위성·광선의 130px 급 쿼드가 여전히 화면 광량의 주범이었다(실측).
  return k * k
}
