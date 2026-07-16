/**
 * 밸런스 계측.
 *
 * 감으로 숫자를 고치지 않으려고 만든 자동 플레이 통계다.
 * 여기 수치가 크게 흔들리면 밸런스가 바뀐 것이고, 그건 의도했을 때만 괜찮다.
 *
 * **봇 완주율을 사람 완주율로 읽지 말 것.** 처음엔 봇이 사람보다 못할 거라
 * 생각했는데(레벨업을 랜덤으로 고르고 무기 사거리를 모른다) 실제로는 더 잘한다 —
 * 화면 밖까지 포함해 모든 적의 좌표를 알고 매 프레임 최적 회피를 한다. 사람은
 * 화면만 본다. 그래서 이 수치는 **상한선**이고, 진짜 난이도는 사람이 해봐야 안다.
 *
 * 그럼에도 이게 값어치를 한 건 절대적 실패를 잡아 주기 때문이다:
 * "0킬로 완주", "가만히 서 있어도 완주", "20초 만에 전멸" 같은 건 봇도 잡는다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Rng } from '../engine/rng'
import { Bot } from './bot'
import { Game, Phase, RUN_SECONDS } from './game'

// @types/node 를 넣으면 브라우저 코드에서도 process 가 보여 실수를 부른다.
// 계측 파일에서만 최소한으로 선언한다.
declare const process: {
  env: Record<string, string | undefined>
  stdout: { write(s: string): void }
}

interface RunStat {
  seed: number
  survived: number
  won: boolean
  kills: number
  level: number
  weapons: number
  evolved: number
}

/** 사람 없이 한 판 끝까지. 렌더가 없으니 5분이 순식간이다. */
function playRun(seed: number, pickBest = false): RunStat {
  const game = new Game()
  game.start(seed)
  const bot = new Bot()
  const rng = new Rng(seed ^ 0x5f3759df)
  const input = { move: bot.move } as unknown as Input
  const dt = 1 / 60
  const maxSteps = Math.ceil(RUN_SECONDS / dt) + 120

  for (let i = 0; i < maxSteps; i++) {
    if (game.phase === Phase.LevelUp) {
      const cs = game.pendingChoices
      if (cs.length === 0) break
      // 진화가 뜨면 무조건 집는다. 나머지는 랜덤 — 사람이라면 더 잘 고른다.
      const evo = cs.find((c) => c.kind === 'evolve')
      game.choose(pickBest && evo ? evo : cs[rng.int(cs.length)]!)
      continue
    }
    if (game.phase === Phase.Dead || game.phase === Phase.Won) break
    bot.think(game, dt)
    game.update(input, dt)
  }

  return {
    seed,
    survived: game.elapsed,
    won: game.phase === Phase.Won,
    kills: game.player.kills,
    level: game.player.level,
    weapons: game.loadout.weapons.length,
    evolved: game.loadout.weapons.filter((w) => w.evolved).length,
  }
}

/**
 * 봇 한 판이 5분치 시뮬레이션(18,000 스텝)이라 판당 40초쯤 걸린다.
 * 기본 스위트에 두면 매번 테스트가 5분씩 멎으므로 명시적으로 켤 때만 돈다:
 *   BALANCE=1 npx vitest run balance
 */
const RUN_SIM = process.env['BALANCE'] === '1'

describe.skipIf(!RUN_SIM)('밸런스 (봇 자동 플레이)', () => {
  const SEEDS = [1, 42, 1337, 2026, 8888, 31337]
  let runs: RunStat[] = []

  it('통계를 찍는다', () => {
    runs = SEEDS.map((s) => playRun(s, true))
    const avg = (f: (r: RunStat) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length
    const wins = runs.filter((r) => r.won).length
    const table = runs
      .map((r) =>
        `  seed ${String(r.seed).padStart(5)} | ${r.won ? '완주' : '사망'} ${r.survived.toFixed(0).padStart(3)}s` +
        ` | ${String(r.kills).padStart(5)}킬 | Lv${String(r.level).padStart(2)}` +
        ` | 무기${r.weapons} 진화${r.evolved}`,
      )
      .join('\n')
    // vitest 의 console 캡처를 타지 않고 직접 쓴다 (수집 단계 로그가 삼켜진 적이 있다)
    process.stdout.write(
      `\n── 밸런스 (봇 ${runs.length}판) ──\n${table}\n` +
      `  완주 ${wins}/${runs.length} | 평균 생존 ${avg((r) => r.survived).toFixed(0)}s` +
      ` | 평균 ${avg((r) => r.kills).toFixed(0)}킬 | 평균 Lv${avg((r) => r.level).toFixed(1)}` +
      ` | 평균 진화 ${avg((r) => r.evolved).toFixed(1)}\n\n`,
    )
    expect(runs.length).toBe(SEEDS.length)
  })

  it('봇이 초반 30초는 넘긴다 (시작하자마자 죽으면 아무도 두 번 안 한다)', () => {
    for (const r of runs) expect(r.survived, `seed ${r.seed}`).toBeGreaterThan(30)
  })

  it('레벨이 오른다 (성장이 멈추면 조합이 안 굴러간다)', () => {
    const avgLv = runs.reduce((a, r) => a + r.level, 0) / runs.length
    expect(avgLv).toBeGreaterThan(6)
  })
})

describe('밸런스 (빠른 것만)', () => {
  it('시작 무기가 시드마다 갈린다 (매판 같은 빌드면 리플레이가 없다)', () => {
    const firsts = new Set<number>()
    for (let s = 1; s <= 30; s++) {
      const g = new Game()
      g.start(s)
      firsts.add(g.loadout.weapons[0]!.def)
    }
    expect(firsts.size).toBeGreaterThanOrEqual(4)
  })

  it('아무것도 안 하면 완주하지 못한다 (가만히 서 있어도 이기면 게임이 아니다)', () => {
    const game = new Game()
    game.start(3)
    const input = { move: { x: 0, y: 0 } } as unknown as Input
    // 스텝 수로 돌면 레벨업 처리(continue)가 게임 시간을 안 쓰면서 예산만 먹는다.
    // 실제로 그것 때문에 5분을 못 채우고 Playing 인 채로 루프가 끝났다.
    // guard 는 런 길이(900초 × 60)보다 넉넉해야 한다. 400*60 으로 뒀더니 15분
    // 확장 후 '루프가 안 끝난다'로 터졌다 — 게임이 아니라 상한이 낡은 것이었다.
    let guard = 0
    while (game.phase === Phase.Playing || game.phase === Phase.LevelUp) {
      if (guard++ > (RUN_SECONDS + 60) * 60) throw new Error('루프가 안 끝난다')
      if (game.phase === Phase.LevelUp) {
        game.choose(game.pendingChoices[0]!)
        continue
      }
      game.update(input, 1 / 60)
    }
    expect(game.phase).toBe(Phase.Dead)
  })
})
