/**
 * 은하 밀도장 — 실척 계층 우주의 뼈대 (아키텍처 §3-1, Phase 3).
 *
 * 국부 은하군 카탈로그(실명 5은하)와 순수 밀도 함수. 모든 절차 천체는
 * 이 장(場)의 값이 0보다 큰 곳에서만 태어난다 — "무소속 0"의 방벽.
 * 좌표는 실척 px (1광년 = 50,000px), 중심은 STAR_MAP 실명 앵커에서 온다.
 *
 * 물리 근거: docs/은하-성단-성운-구조-조사.md (opus 12기) —
 * 지수원반(스케일길이 ~2.6kpc)·얇은/두꺼운 원반 1:3·팽대부 r^-1.8·
 * 헤일로 r^-3.5·나선팔 φ=12° 로그나선 2개(밝기 대비, 질량 아님).
 */
import { STAR_MAP } from './starmap'

export interface Galaxy {
  readonly id: number
  readonly name: string
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly rDisk: number
  readonly rScale: number
  readonly hThin: number
  readonly hThick: number
  readonly rBulge: number
  readonly rHalo: number
  /** 나선팔 수 — 0 = 불규칙/플로큘런트 (팔 부스트 없음) */
  readonly arms: number
  /** 중심 블랙홀 유무 — M33·SMC 는 없음 (조사 [확인]) */
  readonly hasBH: boolean
}

function anchor(name: string): { x: number; y: number; z: number } {
  const s = STAR_MAP.find((m) => m.name === name)
  if (!s) throw new Error(`은하 앵커 실종: ${name}`)
  return { x: s.x, y: s.y, z: s.z }
}

function mk(id: number, name: string, rDisk: number, arms: number, hasBH: boolean): Galaxy {
  const a = anchor(name === '우리 은하' ? '궁수자리 A*' : name)
  return {
    id, name,
    cx: a.x, cy: a.y, cz: a.z,
    rDisk,
    rScale: rDisk / 5.8, // 지수원반 스케일길이 ≈ R_disk/5.8 (은하수 15kpc/2.6kpc)
    hThin: rDisk / 49, // 높이/길이 ≈ 1/9 → 얇은 원반 (조사①)
    hThick: (rDisk / 49) * 3,
    rBulge: rDisk * 0.13,
    rHalo: rDisk * 7, // 밖은 ρ=0 — 진짜 공허 (조사①)
    arms, hasBH,
  }
}

/** 국부 은하군 — 실명 5은하 (아키텍처 §1-4, 조사 은하③) */
export const GALAXIES: readonly Galaxy[] = [
  mk(1, '우리 은하', 2.45e9, 2, true), // 49,000광년 원반 — grand design φ12°
  mk(2, '큰 마젤란 은하', 7.0e8, 1, true), // 팔 1개 + 어긋난 막대 (BH ~6e5 간접)
  mk(3, '작은 마젤란 은하', 4.0e8, 0, false), // 불규칙·붕괴 — BH 없음
  mk(4, '안드로메다 은하', 3.8e9, 2, true), // 1.4e8 Msun + 10kpc 고리
  mk(5, '삼각형자리 은하', 1.5e9, 0, false), // 플로큘런트 — SMBH 없음 (최대 무BH 은하)
]

const TAN12 = Math.tan((12 * Math.PI) / 180)
const ARM_SIGMA = 0.35 // 팔 각폭 (rad) — 밝기 대비 10~20% (조사②)

function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** 월드 → 은하 원기둥 좌표 [평면거리 r, 각 θ, 높이 h] */
export function galacticCyl(G: Galaxy, x: number, y: number, z: number): [number, number, number] {
  const dx = x - G.cx
  const dy = y - G.cy
  return [Math.hypot(dx, dy), Math.atan2(dy, dx), z - G.cz]
}

/** 로그나선 팔 근접도 0..1 — 크레스트=1, 팔 사이=0. r→0 NaN 가드 (아키텍처 §3-1) */
export function armProximity(G: Galaxy, r: number, th: number): number {
  if (G.arms <= 0) return 0
  const rg = Math.max(r, 1e-3 * G.rDisk)
  const a0 = G.rBulge * 0.5
  let best = Math.PI
  for (let k = 0; k < G.arms; k++) {
    const arm = Math.log(rg / a0) / TAN12 + (2 * Math.PI * k) / G.arms
    const d = Math.abs(angDiff(th, arm % (Math.PI * 2)))
    if (d < best) best = d
  }
  return Math.exp(-(best * best) / (2 * ARM_SIGMA * ARM_SIGMA))
}

/**
 * 은하 밀도 ρ ≥ 0 — 팽대부(r^-1.8) + 얇은 원반(지수·팔 부스트) + 두꺼운
 * 원반(0.15·, 3배 두께) + 헤일로(r^-3.5). rHalo 밖 = 0 (공허).
 */
export function galaxyDensityAt(G: Galaxy, x: number, y: number, z: number): number {
  const [r, th, h] = galacticCyl(G, x, y, z)
  if (r > G.rHalo) return 0
  const ah = Math.abs(h)
  const bulge = r < G.rBulge
    ? 2.2 * Math.pow(Math.max(r, 0.01 * G.rBulge) / G.rBulge, -1.8) *
      Math.exp(-ah / (0.6 * G.rBulge))
    : 0
  const thin = Math.exp(-r / G.rScale) * Math.exp(-ah / G.hThin)
  const thick = 0.15 * Math.exp(-r / G.rScale) * Math.exp(-ah / G.hThick)
  const halo = 0.02 * Math.pow(r / G.rScale + 0.1, -3.5)
  const arm = armProximity(G, r, th)
  return bulge + thin * (1 + 0.8 * arm) + thick + halo
}

/** 이 자리를 품은 은하 — 없으면 null = 은하간 진짜 공허 (무소속 0의 게이트).
 *  **최대 밀도** 귀속 (P7 CONFIRMED): 첫 일치 반환은 우리 은하 헤일로(7·rDisk
 *  = 34만 광년)가 마젤란(15.8만 광년)을 통째로 삼켰다 — 위성은하 곁에선
 *  위성의 원반 밀도가 모은하의 헤일로 꼬리보다 압도적으로 크다. */
export function galaxyOf(x: number, y: number, z: number): Galaxy | null {
  let best: Galaxy | null = null
  let bestRho = 0
  for (const G of GALAXIES) {
    if (Math.abs(x - G.cx) > G.rHalo || Math.abs(y - G.cy) > G.rHalo) continue
    const rho = galaxyDensityAt(G, x, y, z)
    if (rho > bestRho) {
      bestRho = rho
      best = G
    }
  }
  return best
}
