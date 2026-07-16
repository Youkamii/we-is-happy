/**
 * 엔트리. 부팅 → 게임 루프 → HUD.
 */
import { Audio } from './engine/audio'
import { createContext, GLError } from './engine/gl'
import { Input } from './engine/input'
import { Renderer } from './engine/renderer'
import { dailySeed, hashSeed } from './engine/rng'
import { ACTS } from './game/acts'
import { Game, Phase, RUN_SECONDS } from './game/game'
import { LevelUpUI } from './ui/levelup'
import { WEAPONS } from './game/weapons'
import { loadRecords, makeResult, saveRecord, type RunResult } from './game/score'

const GRADE_COLOR: Record<string, string> = {
  'S+': '#ffe27a', S: '#ffd166', A: '#8affc1', B: '#7de3ff', C: '#b9c6d6', D: '#8d9aab', E: '#6b7787',
}

/**
 * 결과 화면. **innerHTML 을 쓰지 않는다.**
 *
 * 여기 들어가는 seedLabel 은 URL 쿼리(?seed=...)에서 오고, prevBest 는 localStorage
 * 에서 온다 — 둘 다 공격자가 정할 수 있다. 예전엔 이걸 템플릿 문자열로 innerHTML 에
 * 넣었는데, 5분이면 판이 반드시 끝나므로 `?seed=<img src=x onerror=...>` 링크 하나로
 * 100% 실행됐다(rAF 안이라 초당 60회). 이스케이프 함수를 끼우는 것보다 textContent
 * 로 조립하는 게 근본적이다 — 다음 사람이 필드를 하나 더 추가해도 안전하다.
 */
function renderResult(
  root: HTMLElement,
  result: RunResult,
  prevBest: number,
  isBest: boolean,
  seedLabel: string,
): void {
  root.replaceChildren()
  const line = (text: string, style: string): void => {
    const d = document.createElement('div')
    d.textContent = text
    d.style.cssText = style
    root.appendChild(d)
  }

  line(result.won ? '버텨냈다' : '꺼졌다', 'font-size:38px;letter-spacing:.14em')
  line(
    result.grade,
    `margin-top:18px;font-size:74px;line-height:1;color:${GRADE_COLOR[result.grade] ?? '#ffd9a8'}`,
  )
  line(result.score.toLocaleString(), 'margin-top:10px;font-size:26px')
  line(
    isBest ? '이 시드 신기록' : `최고 ${prevBest.toLocaleString()}`,
    `margin-top:6px;font-size:14px;color:${isBest ? '#8affc1' : '#7d90a8'}`,
  )

  const stats = document.createElement('div')
  stats.style.cssText = 'margin-top:22px;font-size:14px;color:#a9bdd4;line-height:1.9'
  const put = (text: string, color?: string): void => {
    const s = document.createElement('div')
    s.textContent = text
    if (color) s.style.color = color
    stats.appendChild(s)
  }
  put(`${result.act}막 ${result.actName} · ${fmtTime(result.survived)} 버팀`)
  put(`${result.kills.toLocaleString()} 처치 · Lv ${result.level}`)
  put(result.weapons.join(' · ') || '맨손')
  put(seedLabel, '#6f8299')
  root.appendChild(stats)

  line('R — 다시', 'margin-top:24px;font-size:15px;color:#ffb066')
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
  // 시드는 화면에도 뜨고 localStorage 키도 되므로 길이를 자른다.
  // (긴 문자열로 저장 쿼터를 채워 기록을 못 남기게 만드는 것도 막는다)
  const seedParam = params.get('seed')?.slice(0, 32) || null
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

  // 막 전환 배너 — 15분을 하나의 곡선으로 만드는 이정표
  const actBanner = document.createElement('div')
  actBanner.style.cssText =
    'position:absolute;left:0;right:0;top:24%;text-align:center;pointer-events:none;' +
    'font:800 42px/1.5 ui-monospace,monospace;color:#ffe6b8;white-space:pre;' +
    'text-shadow:0 0 40px rgba(255,180,80,.9);opacity:0;transition:opacity .5s;letter-spacing:.16em;'
  ui.appendChild(actBanner)

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
  let resultShown = false

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
        // 난수는 game.rng 를 쓴다. Math.random 을 쓰면 같은 시드로 열어도 매번 다른
        // 빌드가 나와서, 결정론을 확인하려고 만든 모드가 결정론을 깨는 꼴이 된다.
        const cs = game.pendingChoices
        const evo = cs.find((c) => c.kind === 'evolve')
        game.choose(evo ?? cs[game.rng.int(cs.length)]!)
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
    const act = ACTS[game.act]!
    const bossHp = game.bossIdx >= 0 && game.bossMaxHp > 0
      ? Math.max(0, Math.round((game.foes.hp[game.bossIdx]! / game.bossMaxHp) * 100))
      : -1
    hud.textContent =
      `${game.act + 1}막 ${act.name}\n` +
      `${fmtTime(RUN_SECONDS - game.elapsed)}  남음\n` +
      `HP ${hpPct}%   Lv ${p.level}\n` +
      `처치 ${p.kills.toLocaleString()}\n` +
      `${gear}\n` +
      (bossHp >= 0 ? `\n◆ 보스 ${bossHp}%\n` : '\n') +
      `\n` +
      `적 ${game.foes.count.toLocaleString()}  탄 ${game.shots.count}  입자 ${game.motes.count.toLocaleString()}\n` +
      `fps ${fps.toFixed(0)}`

    // 막 전환 — 화면 가운데에 잠깐. 15분이 5분×3이 아니라 하나의 곡선이 되려면
    // "여기까지 왔다"는 이정표가 있어야 한다.
    if (game.actIntro > 0 && !result) {
      actBanner.style.opacity = String(Math.min(1, game.actIntro / 0.8))
      actBanner.textContent = `${game.act + 1}막 · ${act.name}\n${act.sub}`
    } else {
      actBanner.style.opacity = '0'
    }

    // 결과 화면은 판이 끝난 순간 한 번만 조립한다. 예전엔 rAF 마다 innerHTML 을
    // 통째로 재파싱했다 — 초당 60번 DOM 을 새로 짓는 건 그냥 낭비다.
    if (result && !resultShown) {
      resultShown = true
      // 뒤에서 화면이 계속 불타고 있어서 오버레이 없이는 글자가 안 읽힌다.
      center.style.background = 'radial-gradient(ellipse at center,rgba(4,6,12,.86),rgba(2,3,7,.97))'
      center.style.backdropFilter = 'blur(3px)'
      renderResult(center, result, records.best[seedLabel] ?? 0, isBest, seedLabel)
    } else if (!result && resultShown) {
      resultShown = false
      center.style.background = 'none'
      center.style.backdropFilter = 'none'
      center.replaceChildren()
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
