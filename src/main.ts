/**
 * 엔트리. 부팅 → 게임 루프 → HUD.
 */
import { Audio } from './engine/audio'
import { createContext, GLError } from './engine/gl'
import { Input } from './engine/input'
import { Renderer } from './engine/renderer'
import { dailySeed, hashSeed } from './engine/rng'
import { Game, Phase, RUN_SECONDS } from './game/game'
import { LevelUpUI } from './ui/levelup'
import { WEAPONS } from './game/weapons'
import { loadRecords, makeResult, saveRecord, type RunResult } from './game/score'

const GRADE_COLOR: Record<string, string> = {
  'S+': '#ffe27a', S: '#ffd166', A: '#8affc1', B: '#7de3ff', C: '#b9c6d6', D: '#8d9aab', E: '#6b7787',
}

function fatal(msg: string): void {
  const el = document.getElementById('fatal')
  const m = document.getElementById('fatal-msg')
  if (m) m.textContent = msg
  if (el) el.classList.add('show')
  console.error(msg)
}

function fmtTime(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null
  if (!canvas) throw new Error('캔버스를 찾을 수 없습니다.')

  const gl = createContext(canvas)
  const renderer = new Renderer(canvas, gl)
  const input = new Input(canvas)
  const game = new Game()
  const audio = new Audio()

  // 자동재생 정책: 사용자 제스처 전에는 오디오 컨텍스트가 suspended 로 태어난다.
  const wake = () => {
    audio.start()
    audio.resume()
  }
  window.addEventListener('pointerdown', wake, { once: true })
  window.addEventListener('keydown', wake, { once: true })

  const params = new URLSearchParams(location.search)
  const daily = dailySeed(new Date())
  const seedParam = params.get('seed')
  const seed = seedParam ? hashSeed(seedParam) : daily.seed
  // 기록은 시드별로 남는다. 데일리는 날짜가 곧 라벨이라 매일 새 판이 열린다.
  const seedLabel = seedParam ? `seed:${seedParam}` : daily.label
  game.start(seed)

  // ?bench=10000 — 적을 즉시 N마리 풀어 성능만 본다.
  const bench = Math.min(20000, Math.max(0, parseInt(params.get('bench') ?? '0', 10) || 0))
  if (bench > 0) game.benchSpawn(bench)
  // ?auto — 레벨업을 자동으로 골라 사람 없이 완주시킨다 (검증용)
  const autoPick = params.has('auto')

  // 콘솔에서 만져볼 수 있게 열어 둔다. 싱글플레이 게임이라 숨길 이유가 없고,
  // 이게 있어야 headless 검증도 되고 밸런싱도 콘솔에서 바로 실험할 수 있다.
  ;(window as unknown as Record<string, unknown>)['EMBERTIDE'] = { game, audio, renderer, input }

  const ui = document.getElementById('ui')!
  const levelUp = new LevelUpUI(ui)
  const hud = document.createElement('div')
  hud.style.cssText =
    'position:absolute;top:14px;left:16px;font:600 13px/1.7 ui-monospace,monospace;' +
    'color:#cfe8ff;text-shadow:0 0 10px rgba(60,160,255,.55);white-space:pre;'
  ui.appendChild(hud)

  const center = document.createElement('div')
  center.style.cssText =
    'position:absolute;inset:0;display:grid;place-content:center;text-align:center;' +
    'font:700 30px/1.4 ui-monospace,monospace;color:#ffd9a8;' +
    'text-shadow:0 0 24px rgba(255,140,40,.55);'
  ui.appendChild(center)

  let last = performance.now()
  let acc = 0
  let frames = 0
  let fps = 0
  let worstFrame = 0
  let result: RunResult | null = null
  let records = loadRecords()
  let isBest = false

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.25)
    last = now
    acc += dt
    frames++
    if (dt > worstFrame) worstFrame = dt
    if (acc >= 0.5) {
      fps = frames / acc
      acc = 0
      frames = 0
      worstFrame = 0
    }

    input.update()

    // 레벨업: 선택지가 떠 있는 동안 시뮬레이션은 멈춘다 (game.update 가 알아서 건너뛴다)
    if (game.phase === Phase.LevelUp && game.pendingChoices.length > 0) {
      if (autoPick) {
        // ?auto — 사람 없이 5분 완주를 돌려 보기 위한 모드. 진화가 있으면 진화를 집는다.
        const cs = game.pendingChoices
        const evo = cs.find((c) => c.kind === 'evolve')
        game.choose(evo ?? cs[Math.floor(Math.random() * cs.length)]!)
      } else if (!levelUp.isVisible) {
        levelUp.show(game.pendingChoices, game.player.level, (c) => game.choose(c))
      }
    }

    if (game.phase === Phase.Dead || game.phase === Phase.Won) {
      // 결과는 판이 끝난 순간 딱 한 번 확정한다 (매 프레임 저장하면 기록이 뻥튀기된다)
      if (!result) {
        result = makeResult(game, seedLabel)
        const saved = saveRecord(result)
        records = saved.records
        isBest = saved.isBest
      }
      if (input.consumePressed('r')) {
        levelUp.hide()
        result = null
        isBest = false
        game.start(seed)
        if (bench > 0) game.benchSpawn(bench)
      }
    }

    if (input.consumePressed('m')) audio.setMuted(!audio.muted)

    renderer.resize()
    game.update(input, dt)
    game.render(renderer)

    // 소리: 게임이 쌓아둔 이벤트를 흘려보낸다 (스로틀·보이스 상한은 Audio 가 건다)
    if (game.sfxQueue.length > 0) {
      for (let i = 0; i < game.sfxQueue.length; i++) audio.play(game.sfxQueue[i]!)
      game.sfxQueue.length = 0
    }
    // 음악 압박도 = 런 진행도. 마지막 1분이 다른 곡처럼 들려야 한다.
    audio.intensity = game.phase === Phase.Playing ? Math.min(1, game.elapsed / RUN_SECONDS) : 0
    audio.updateMusic(dt)

    const p = game.player
    const hpPct = Math.round((p.hp / p.stats.maxHp) * 100)
    const gear = game.loadout.weapons
      .map((w) => {
        const d = WEAPONS[w.def]!
        return `${w.evolved ? `${d.evoName}★` : d.name}${w.level}`
      })
      .join(' ')
    hud.textContent =
      `${fmtTime(RUN_SECONDS - game.elapsed)}  남음\n` +
      `HP ${hpPct}%   Lv ${p.level}\n` +
      `처치 ${p.kills.toLocaleString()}\n` +
      `${gear}\n` +
      `\n` +
      `적 ${game.foes.count.toLocaleString()}  탄 ${game.shots.count}  입자 ${game.motes.count.toLocaleString()}\n` +
      `fps ${fps.toFixed(0)}`

    if (result) {
      const prevBest = records.best[seedLabel] ?? 0
      // 뒤에서 화면이 계속 불타고 있어서 오버레이 없이는 글자가 안 읽힌다.
      center.style.background = 'radial-gradient(ellipse at center,rgba(4,6,12,.86),rgba(2,3,7,.97))'
      center.style.backdropFilter = 'blur(3px)'
      center.innerHTML =
        `<div style="font-size:38px;letter-spacing:.14em">${result.won ? '버텨냈다' : '꺼졌다'}</div>` +
        `<div style="margin-top:18px;font-size:74px;line-height:1;color:${GRADE_COLOR[result.grade] ?? '#ffd9a8'}">${result.grade}</div>` +
        `<div style="margin-top:10px;font-size:26px">${result.score.toLocaleString()}</div>` +
        (isBest
          ? '<div style="margin-top:6px;font-size:14px;color:#8affc1">이 시드 신기록</div>'
          : `<div style="margin-top:6px;font-size:14px;color:#7d90a8">최고 ${prevBest.toLocaleString()}</div>`) +
        `<div style="margin-top:22px;font-size:14px;color:#a9bdd4;line-height:1.9">` +
        `${fmtTime(result.survived)} 버팀 · ${result.kills.toLocaleString()} 처치 · Lv ${result.level}<br>` +
        `${result.weapons.join(' · ') || '맨손'}<br>` +
        `<span style="color:#6f8299">${seedLabel}</span>` +
        `</div>` +
        `<div style="margin-top:24px;font-size:15px;color:#ffb066">R — 다시</div>`
    } else {
      center.style.background = 'none'
      center.style.backdropFilter = 'none'
      center.innerHTML = ''
    }

    input.endFrame()
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

try {
  boot()
} catch (e) {
  fatal(e instanceof GLError ? e.message : `초기화 실패: ${(e as Error).message}`)
}
