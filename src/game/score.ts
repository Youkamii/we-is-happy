/**
 * 스코어와 기록.
 *
 * 5분이 끝나면 숫자 하나가 남아야 한다. 그래야 "한 판 더"가 생긴다.
 */
import { ACTS } from './acts'
import type { Game } from './game'
import { RUN_SECONDS } from './game'
import { WEAPONS } from './weapons'

export interface RunResult {
  seedLabel: string
  score: number
  grade: string
  /** 어느 막까지 갔나 (1-based) */
  act: number
  actName: string
  survived: number
  won: boolean
  kills: number
  level: number
  damageDealt: number
  damageTaken: number
  weapons: string[]
  evolved: string[]
}

/**
 * 점수 공식.
 *
 * 처치가 킬 수에 선형(×12)이던 시절, 후반 킬 인플레이션(실측 12만~19만)이 등급을
 * **단독** 결정했다 — 킬 점수 하나(213만)가 S+ 문턱(160만)을 넘고, 완주·진화·막
 * 도달·레벨을 전부 합쳐도 7만이 안 됐다. "완주가 크게 붙는다"는 이 자리 주석과
 * 산수가 정반대였다.
 *
 * 지금은 성취가 뼈대다: 생존(초당 300)과 처치(×2)가 몸통을 채우고, 진화(1.5만)·
 * 막(8천)·완주(12만)가 등급을 가른다. 무피해 보너스는 여전히 없다(도망만 다니는 게
 * 최적해가 되면 안 된다). 피해 감점도 없앴다 — ×4 에 상한 6000이라 몇 번 맞으면
 * 즉시 바닥에 붙는 상수였고, 그 정보는 이미 생존 시간과 완주에 들어 있다.
 */
export function computeScore(g: Game): number {
  const p = g.player
  let s = 0
  s += p.kills * 2
  s += Math.floor(g.elapsed) * 300
  s += p.level * 800
  s += g.loadout.weapons.filter((w) => w.evolved).length * 15000
  // 막을 넘길 때마다 크게 — 15분에서 "어디까지 갔나"가 곧 실력이다
  s += g.act * 8000
  if (g.elapsed >= RUN_SECONDS) s += 120000
  return Math.max(0, Math.floor(s))
}

/**
 * 등급 문턱 (봇 실측으로 보정: 완주 936k, 최고 근접 실패 748k, 3막 8분 사망 322k).
 * S+ 는 문턱과 무관하게 **완주의 것**이다 — gradeOf 가 구조로 강제한다.
 */
const GRADES: readonly [number, string][] = [
  [900000, 'S+'],
  [700000, 'S'],
  [550000, 'A'],
  [350000, 'B'],
  [180000, 'C'],
  [70000, 'D'],
  [0, 'E'],
]

export function gradeOf(score: number, won: boolean): string {
  for (const [min, g] of GRADES) {
    if (score >= min) {
      // 킬 파밍이 아무리 커도 S+ 는 버텨낸 사람만 단다.
      if (g === 'S+' && !won) return 'S'
      return g
    }
  }
  return 'E'
}

export function makeResult(g: Game, seedLabel: string): RunResult {
  const score = computeScore(g)
  const won = g.elapsed >= RUN_SECONDS
  return {
    seedLabel,
    score,
    grade: gradeOf(score, won),
    act: g.act + 1,
    actName: ACTS[g.act]!.name,
    survived: g.elapsed,
    won: g.elapsed >= RUN_SECONDS,
    kills: g.player.kills,
    level: g.player.level,
    damageDealt: Math.floor(g.player.damageDealt),
    damageTaken: Math.floor(g.player.damageTaken),
    weapons: g.loadout.weapons.map((w) => {
      const d = WEAPONS[w.def]!
      return `${w.evolved ? d.evoName : d.name} ${w.level}`
    }),
    evolved: g.loadout.weapons.filter((w) => w.evolved).map((w) => WEAPONS[w.def]!.evoName),
  }
}

// ── 기록 저장 ─────────────────────────────────────────────────────────

// v2: 점수 공식 교체(2026-07-17). 옛 기록(킬 선형 시절 200만대)과 비교가 성립하지
// 않아 키를 올린다 — 안 올리면 새 공식으론 영원히 못 깨는 유령 기록이 남는다.
const KEY = 'weishappy:records:v2'

export interface Records {
  /** 시드 라벨 → 그 시드의 최고 점수 */
  best: Record<string, number>
  /** 전체 최고 */
  allTime: number
  runs: number
  totalKills: number
}

function empty(): Records {
  return { best: {}, allTime: 0, runs: 0, totalKills: 0 }
}

/** 유한한 숫자만 통과. NaN·Infinity·문자열·객체는 전부 버린다. */
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as unknown
    // 손상된 저장본으로 게임이 죽으면 안 된다 — 모양이 이상하면 조용히 버린다.
    if (!parsed || typeof parsed !== 'object') return empty()
    const p = parsed as Record<string, unknown>
    if (!p['best'] || typeof p['best'] !== 'object' || Array.isArray(p['best'])) return empty()

    // **값까지 검사한다.** 껍데기(typeof === 'object')만 보면 best 의 값이 문자열일 수
    // 있고, 그게 화면으로 흘러가면 오염된 localStorage 가 영구 XSS 로 굳는다
    // (isBest 비교 `12345 > "<img...>"` 가 false 라 덮어써지지도 않는다).
    // 결과 화면이 이제 textContent 라 그 경로는 닫혔지만, 여기서도 막는 게 옳다.
    const best: Record<string, number> = {}
    for (const [k, v] of Object.entries(p['best'] as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) best[k] = v
    }
    return {
      best,
      allTime: num(p['allTime']),
      runs: num(p['runs']),
      totalKills: num(p['totalKills']),
    }
  } catch {
    return empty()
  }
}

/** 저장하고, 이번 판이 그 시드의 신기록이었는지 반환한다. */
export function saveRecord(r: RunResult): { records: Records; isBest: boolean } {
  const rec = loadRecords()
  const prev = rec.best[r.seedLabel] ?? 0
  const isBest = r.score > prev
  if (isBest) rec.best[r.seedLabel] = r.score
  if (r.score > rec.allTime) rec.allTime = r.score
  rec.runs++
  rec.totalKills += r.kills
  try {
    localStorage.setItem(KEY, JSON.stringify(rec))
  } catch {
    // 사파리 프라이빗 모드 등에서 localStorage 가 던진다. 기록을 못 남길 뿐 게임은 돈다.
  }
  return { records: rec, isBest }
}

// todayLabel() 이 있었지만 호출부 0이라 지웠다 (#9) — 데일리 라벨은 main 이 dailySeed 로 직접 만든다.
