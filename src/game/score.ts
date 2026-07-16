/**
 * 스코어와 기록.
 *
 * 5분이 끝나면 숫자 하나가 남아야 한다. 그래야 "한 판 더"가 생긴다.
 */
import { ACTS } from './acts'
import { dailySeed } from '../engine/rng'
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
 * 처치가 기본이고, 완주가 크게 붙고, 진화는 조합을 맞춘 값이라 후하게 준다.
 * 무피해 보너스는 넣지 않았다 — 그걸 넣으면 도망만 다니는 게 최적해가 된다.
 */
export function computeScore(g: Game): number {
  const p = g.player
  let s = 0
  s += p.kills * 12
  s += Math.floor(g.elapsed) * 24
  s += p.level * 140
  s += g.loadout.weapons.filter((w) => w.evolved).length * 1600
  // 막을 넘길 때마다 크게 — 15분에서 "어디까지 갔나"가 곧 실력이다
  s += g.act * 3500
  if (g.elapsed >= RUN_SECONDS) s += 20000
  // 맞을수록 깎이되 바닥은 있다. 감점이 무한하면 겁쟁이 플레이가 정답이 된다.
  s -= Math.min(6000, Math.floor(p.damageTaken * 4))
  return Math.max(0, Math.floor(s))
}

/**
 * 등급 문턱. 15분·12무기로 늘어나며 점수 규모가 3배쯤 커졌다
 * (봇 실측 178,000킬 → 처치 점수만 200만). 문턱도 같이 올려야 S 가 S 로 남는다.
 */
const GRADES: readonly [number, string][] = [
  [1600000, 'S+'],
  [900000, 'S'],
  [450000, 'A'],
  [180000, 'B'],
  [60000, 'C'],
  [15000, 'D'],
  [0, 'E'],
]

export function gradeOf(score: number): string {
  for (const [min, g] of GRADES) if (score >= min) return g
  return 'E'
}

export function makeResult(g: Game, seedLabel: string): RunResult {
  const score = computeScore(g)
  return {
    seedLabel,
    score,
    grade: gradeOf(score),
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

const KEY = 'embertide:records:v1'

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

export function todayLabel(): string {
  return dailySeed(new Date()).label
}
