/**
 * 월드 안에 그리는 정보 — 체력 고리, 위협 화살표, XP 진행.
 *
 * DOM HUD 는 화면 구석에 있다. 후반에 적 2,400마리 사이에서 플레이어는 **화면 중앙만**
 * 본다 — 좌상단 8px 글자로 "HP 49%"를 써 봐야 아무도 안 읽고, 죽기 직전인지도 모른 채
 * 죽는다. 위계를 세워놓고 정작 가장 중요한 정보를 최하위에 둔 셈이었다.
 *
 * 그래서 목숨과 관련된 것은 전부 **플레이어 몸에** 붙인다. 시선이 이미 거기 있으니까.
 *
 * 순수 연출이다 — 시뮬레이션·결정론에 영향이 없다.
 */
import type { SpriteBatch } from '../engine/batch'
import { Shape } from '../engine/shapes'

/** 체력 고리 세그먼트 수. 많으면 매끄럽고 비싸다. */
const RING_SEGMENTS = 40

/**
 * 플레이어를 두르는 체력 고리.
 *
 * 색이 아니라 **길이**로 읽힌다 — 색맹도 읽을 수 있고, 곁눈으로도 "반쯤 남았다"가
 * 즉시 보인다. 위험할 때만 붉어지고 맥동한다.
 */
export function drawHealthRing(
  b: SpriteBatch,
  x: number, y: number,
  hpFrac: number,
  time: number,
): void {
  const R = 52
  const lit = Math.max(0, Math.min(1, hpFrac))
  // 25% 아래면 맥동한다. 이 순간엔 화면을 봐야 하므로 강하게.
  const danger = lit < 0.25 ? 1 : 0
  const pulse = danger ? 0.6 + Math.abs(Math.sin(time * 7)) * 0.9 : 1
  const n = Math.round(RING_SEGMENTS * lit)

  for (let k = 0; k < RING_SEGMENTS; k++) {
    // 12시에서 시계 방향으로 찬다 — 위에서부터 줄어드는 게 직관적이다
    const a = Math.PI * 0.5 - (k / RING_SEGMENTS) * Math.PI * 2
    const px = x + Math.cos(a) * R
    const py = y + Math.sin(a) * R

    if (k >= n) {
      // **빈 궤도.** 이게 없으면 체력이 낮을수록 표시가 사라져서 오히려 안 보인다 —
      // 18% 일 때 조각 7개만 떠 있으면 그게 체력인지도 모른다. 정반대다.
      // 궤도가 항상 원이라야 "얼마나 닳았나"가 길이로 읽힌다.
      b.push(px, py, 4, a, 0.16, 0.14, 0.2, 1, Shape.Orb)
      continue
    }
    // 초록(안전) → 노랑 → 빨강(위험). 길이가 주 신호고 색은 보조다.
    const r = lit > 0.5 ? (1 - lit) * 2 : 1
    const g = lit > 0.5 ? 1 : lit * 2
    const k2 = (danger ? 1.9 : 0.85) * pulse
    b.push(px, py, 5.5, a, r * k2, g * k2, 0.12 * k2, 1, Shape.Orb)
  }
}

/**
 * XP 진행 — 체력 고리 바깥의 얇은 호.
 * 다음 레벨이 얼마나 남았는지가 곧 "언제 강해지나"라서, 이것도 몸에 붙는다.
 */
export function drawXpArc(
  b: SpriteBatch,
  x: number, y: number,
  xpFrac: number,
): void {
  const R = 62
  const n = Math.round(28 * Math.max(0, Math.min(1, xpFrac)))
  for (let k = 0; k < n; k++) {
    const a = Math.PI * 0.5 + (k / 28) * Math.PI * 2
    b.push(x + Math.cos(a) * R, y + Math.sin(a) * R, 3.2, a, 0.2, 0.75, 1.0, 1, Shape.Orb)
  }
}

/**
 * 화면 밖 위협 표시.
 *
 * 보스가 화면 밖에 있으면 어디서 오는지 알 방법이 없다. 카메라 가장자리에
 * 방향 표시를 띄운다 — 이게 없으면 "갑자기 죽었다"가 된다.
 */
export function drawOffscreenMarker(
  b: SpriteBatch,
  camX: number, camY: number,
  halfW: number, halfH: number,
  targetX: number, targetY: number,
  r: number, g: number, bl: number,
  time: number,
): void {
  const dx = targetX - camX
  const dy = targetY - camY
  // 화면 안이면 표시할 필요 없다
  if (Math.abs(dx) < halfW * 0.86 && Math.abs(dy) < halfH * 0.86) return

  // 화면 가장자리 안쪽으로 당긴 위치
  const inset = 0.84
  const sx = halfW * inset
  const sy = halfH * inset
  // 방향 벡터를 사각형 경계에 투영
  const scale = Math.min(
    sx / Math.max(Math.abs(dx), 1e-3),
    sy / Math.max(Math.abs(dy), 1e-3),
  )
  const mx = camX + dx * scale
  const my = camY + dy * scale
  const ang = Math.atan2(dy, dx)
  const pulse = 0.7 + Math.abs(Math.sin(time * 4)) * 0.6
  b.push(mx, my, 26, ang, r * pulse, g * pulse, bl * pulse, 1, Shape.Husk)
}
