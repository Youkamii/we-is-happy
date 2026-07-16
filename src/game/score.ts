/**
 * 스코어와 기록.
 *
 * 5분이 끝나면 숫자 하나가 남아야 한다. 그래야 "한 판 더"가 생긴다.
 */
import { dailySeed } from '../engine/rng'
import type { Game } from './game'
import { RUN_SECONDS } from './game'
import { WEAPONS } from './weapons'

export interface RunResult {
  seedLabel: string
  score: number
  grade: string
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
  if (g.elapsed >= RUN_SECONDS) s += 6000
  // 맞을수록 깎이되 바닥은 있다. 감점이 무한하면 겁쟁이 플레이가 정답이 된다.
  s -= Math.min(4000, Math.floor(p.damageTaken * 4))
  return Math.max(0, Math.floor(s))
}

const GRADES: readonly [number, string][] = [
  [42000, 'S+'],
  [30000, 'S'],
  [21000, 'A'],
  [14000, 'B'],
  [8000, 'C'],
  [3500, 'D'],
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

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<Records>
    // 손상된 저장본으로 게임이 죽으면 안 된다 — 모양이 이상하면 조용히 버린다.
    if (!parsed || typeof parsed !== 'object' || typeof parsed.best !== 'object' || parsed.best === null) {
      return empty()
    }
    return {
      best: parsed.best as Record<string, number>,
      allTime: typeof parsed.allTime === 'number' ? parsed.allTime : 0,
      runs: typeof parsed.runs === 'number' ? parsed.runs : 0,
      totalKills: typeof parsed.totalKills === 'number' ? parsed.totalKills : 0,
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
