/**
 * 엔트리. 부팅 → 게임 루프 → HUD.
 */
import { Audio } from './engine/audio'
import { createContext, GLError } from './engine/gl'
import { Input } from './engine/input'
import { Renderer } from './engine/renderer'
import { dailySeed, hashSeed } from './engine/rng'
import { ACTS, DISK_IN, DISK_OUT } from './game/acts'
import { Game, Phase, RUN_SECONDS, WORLD_R } from './game/game'
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

  line('R 또는 터치 — 다시', 'margin-top:24px;font-size:15px;color:#ffb066')
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
  // ?debug — 개발자 계기판(적/탄/입자/fps). 벤치마크는 fps 를 봐야 하므로 자동 포함.
  const debug = params.has('debug') || bench > 0

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

  // 압박 비트 배너 — 막 배너보다 작게, "무엇이 오는지"만 짧게
  const beatBanner = document.createElement('div')
  beatBanner.style.cssText =
    'position:absolute;left:0;right:0;top:35%;text-align:center;pointer-events:none;' +
    'font:800 22px/1.4 ui-monospace,monospace;color:#ffb066;white-space:pre;' +
    'text-shadow:0 0 24px rgba(255,140,60,.8);opacity:0;transition:opacity .3s;letter-spacing:.3em;'
  ui.appendChild(beatBanner)

  const center = document.createElement('div')
  center.style.cssText =
    'position:absolute;inset:0;display:grid;place-content:center;text-align:center;' +
    'font:700 30px/1.4 ui-monospace,monospace;color:#ffd9a8;' +
    'text-shadow:0 0 24px rgba(255,140,40,.55);'
  ui.appendChild(center)

  // 일시정지 표지
  const pauseEl = document.createElement('div')
  pauseEl.style.cssText =
    'position:absolute;inset:0;display:none;place-content:center;text-align:center;' +
    'font:800 34px/1.9 ui-monospace,monospace;color:#cfe8ff;letter-spacing:.22em;' +
    'background:rgba(3,5,10,.45);text-shadow:0 0 30px rgba(80,160,255,.6);'
  pauseEl.textContent = '일시정지 — P 계속'
  ui.appendChild(pauseEl)

  // 음소거 — 키보드 없는 기기를 위한 버튼 + 상태 표시 (M 과 동일)
  const muteBtn = document.createElement('button')
  muteBtn.style.cssText =
    'position:absolute;top:12px;right:14px;pointer-events:auto;cursor:pointer;' +
    'background:rgba(10,14,24,.55);color:#9fb6d4;border:1px solid rgba(120,160,220,.25);' +
    'border-radius:6px;font:600 12px ui-monospace,monospace;padding:6px 10px;'
  const syncMute = (): void => {
    muteBtn.textContent = audio.muted ? '소리 꺼짐 (M)' : '소리 켬 (M)'
  }
  muteBtn.onclick = () => {
    audio.setMuted(!audio.muted)
    syncMute()
  }
  syncMute()
  ui.appendChild(muteBtn)

  // 고도계 — 좌측 세로 트랙. 아래 = 지평선(죽음), 금빛 밴드 = 강착원반(부의 구역),
  // 점 = 나. 하단 숫자는 포식까지 남은 마디 — "박자 전에 나온다"를 읽는 계기판이다.
  const ALT_H = 240
  const altim = document.createElement('div')
  altim.style.cssText =
    'position:absolute;left:18px;top:50%;transform:translateY(-50%);width:10px;' +
    `height:${ALT_H}px;pointer-events:none;background:rgba(8,12,22,.55);` +
    'border:1px solid rgba(120,160,220,.22);border-radius:5px;'
  const altBand = document.createElement('div')
  altBand.style.cssText =
    'position:absolute;left:0;right:0;border-radius:4px;' +
    'background:linear-gradient(rgba(255,190,90,.12),rgba(255,150,50,.5),rgba(255,190,90,.12));'
  altim.appendChild(altBand)
  const altHole = document.createElement('div')
  altHole.style.cssText =
    'position:absolute;left:-3px;right:-3px;bottom:-7px;height:13px;background:#000;' +
    'border:1px solid rgba(255,160,80,.7);border-radius:7px;'
  altim.appendChild(altHole)
  const altDot = document.createElement('div')
  altDot.style.cssText =
    'position:absolute;left:50%;width:15px;height:15px;transform:translate(-50%,-50%);' +
    'background:radial-gradient(circle,#e8f6ff 0%,#5fb0ff 55%,transparent 72%);border-radius:50%;'
  altim.appendChild(altDot)
  const altFeed = document.createElement('div')
  altFeed.style.cssText =
    'position:absolute;left:50%;transform:translateX(-50%);bottom:-30px;' +
    'font:800 13px ui-monospace,monospace;color:#ff9d6a;white-space:nowrap;letter-spacing:.08em;'
  altim.appendChild(altFeed)
  ui.appendChild(altim)

  let last = performance.now()
  let acc = 0
  let frames = 0
  let fps = 0
  let worstFrame = 0
  let result: RunResult | null = null
  let records = loadRecords()
  let isBest = false
  let resultShown = false
  // 타이틀에서 첫 입력을 기다린다 — 로드 즉시 15분 타이머가 돌면 안 된다.
  // ?auto/?bench 는 사람이 없는 검증 모드라 바로 시작한다.
  let started = autoPick || bench > 0
  let paused = false
  /** 결과 화면이 뜬 시각 — 죽는 순간의 조작이 재시작으로 새는 것을 막는 지연용 */
  let resultAt = 0

  // 창을 벗어나면 스스로 멈춘다 — 돌아왔더니 죽어 있으면 억울하다
  window.addEventListener('blur', () => {
    if (started && !paused && game.phase === Phase.Playing) {
      paused = true
      pauseEl.style.display = 'grid'
    }
  })

  // 타이틀 — 게임 안의 유일한 조작 안내가 여기다
  const showTitle = (): void => {
    center.replaceChildren()
    const line = (text: string, style: string): void => {
      const d = document.createElement('div')
      d.textContent = text
      d.style.cssText = style
      center.appendChild(d)
    }
    line('EMBERTIDE', 'font-size:52px;letter-spacing:.3em;color:#ffd9a8')
    line('죽은 별의 심장이 뛴다 — 지평선 위에서 15분', 'margin-top:10px;font-size:15px;color:#a9bdd4')
    line('이동  WASD · 방향키 · 마우스 홀드 · 터치 드래그', 'margin-top:30px;font-size:14px;color:#8fa8c4;line-height:2')
    line('공격은 자동이다 — 움직임이 전부다', 'font-size:14px;color:#8fa8c4;line-height:2')
    line('P 일시정지 · M 소리', 'font-size:13px;color:#6f8299;line-height:2')
    line('아무 키 · 클릭 · 터치로 시작', 'margin-top:34px;font-size:16px;color:#ffb066')
    center.style.background =
      'radial-gradient(ellipse at center,rgba(4,6,12,.55),rgba(2,3,7,.82))'
  }
  if (!started) showTitle()

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

    // 타이틀 — 첫 입력 전에는 시뮬레이션(15분 타이머 포함)이 돌지 않는다
    if (!started) {
      if (input.anyInput) {
        started = true
        center.replaceChildren()
        center.style.background = 'none'
        // 시작을 부른 그 입력이 아래 단축키(P 등)로 새지 않게 엣지를 비운다
        input.endFrame()
      } else {
        game.visualTime += dt // 배경(성운·광륜)은 살아 있게
        renderer.resize()
        game.render(renderer)
        input.endFrame()
        requestAnimationFrame(frame)
        return
      }
    }

    // 일시정지 — P/Esc. 시뮬레이션이 도는 동안(Playing)에만 의미가 있다.
    if (
      game.phase === Phase.Playing &&
      (input.consumePressed('p') || input.consumePressed('escape'))
    ) {
      paused = !paused
      pauseEl.style.display = paused ? 'grid' : 'none'
    }
    if (paused && game.phase !== Phase.Playing) {
      paused = false
      pauseEl.style.display = 'none'
    }
    if (paused) {
      game.visualTime += dt
      renderer.resize()
      game.render(renderer)
      audio.intensity = 0
      audio.updateMusic(dt)
      // 정지 직전 프레임이 쌓아둔 효과음은 버린다 — 재개 몇 초 뒤에 낡은
      // 피격음이 터지면 유령 피해처럼 들린다.
      game.sfxQueue.length = 0
      if (input.consumePressed('m')) {
        audio.setMuted(!audio.muted)
        syncMute()
      }
      input.endFrame()
      requestAnimationFrame(frame)
      return
    }

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
        const isPact = game.pendingChoices[0]!.kind === 'pact'
        levelUp.show(game.pendingChoices, game.player.level, (c) => game.choose(c), {
          ...(isPact ? { header: `${game.act + 1}막의 계약` } : {}),
          onReroll: !isPact && game.rerollLeft > 0 ? () => game.reroll() : null,
        })
      }
    }

    if (game.phase === Phase.Dead || game.phase === Phase.Won) {
      // 결과는 판이 끝난 순간 딱 한 번 확정한다 (매 프레임 저장하면 기록이 뻥튀기된다)
      if (!result) {
        result = makeResult(game, seedLabel)
        resultAt = game.visualTime
        const saved = saveRecord(result)
        records = saved.records
        isBest = saved.isBest
      }
      // 터치 기기도 다시 시작할 수 있어야 한다 — R 는 키보드 전용이었다.
      // 0.5s 지연: 죽는 순간까지 누르던 조작이 그대로 재시작으로 새면 결과를 못 본다.
      const tapRestart = game.visualTime - resultAt > 0.5 && input.consumePointerPressed()
      if (input.consumePressed('r') || tapRestart) {
        levelUp.hide()
        result = null
        isBest = false
        game.start(seed)
        // beatClock 이 0으로 돌아가므로 오디오 시퀀서 인덱스도 함께 되감는다 —
        // 안 되감으면 두 번째 런부터 BGM 이 통째로 무음이다 (적대 리뷰가 잡았다)
        audio.resetMusicSync()
        if (bench > 0) game.benchSpawn(bench)
      }
    }

    if (input.consumePressed('m')) {
      audio.setMuted(!audio.muted)
      syncMute()
    }

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
    // 심장박동 동기 — BGM 킥이 곧 게임의 박자다 (무기 발사·중력 펄스와 같은 시계)
    audio.updateMusic(dt, game.beatClock)

    const p = game.player
    const hpPct = Math.round((p.hp / p.stats.maxHp) * 100)
    const gear = game.loadout.weapons
      .map((w) => {
        const d = WEAPONS[w.def]!
        return `${w.evolved ? `${d.evoName}★` : d.name}${w.level}`
      })
      .join(' ')
    const act = ACTS[game.act]!
    const bossHp = game.boss.idx >= 0 && game.boss.maxHp > 0
      ? Math.max(0, Math.round((game.foes.hp[game.boss.idx]! / game.boss.maxHp) * 100))
      : -1
    // 개발자 계기판(적/탄/입자/fps)은 ?debug·?bench 에서만 — 평소 HUD 에 섞이면
    // 게임이 기술 데모처럼 보인다. 목숨과 무관한 숫자는 특권이 없다.
    hud.textContent =
      `${game.act + 1}막 ${act.name}\n` +
      `${fmtTime(RUN_SECONDS - game.elapsed)}  남음\n` +
      `HP ${hpPct}%   Lv ${p.level}\n` +
      `처치 ${p.kills.toLocaleString()}\n` +
      `${gear}\n` +
      (bossHp >= 0 ? `\n◆ 보스 ${bossHp}%` : '') +
      (debug
        ? `\n\n적 ${game.foes.count.toLocaleString()}  탄 ${game.shots.count}` +
          `  입자 ${game.motes.count.toLocaleString()}\nfps ${fps.toFixed(0)}` +
          // 배치 용량 초과 = 이번 프레임에 flush 가 몇 번 더 돌았나. 조용히 쌓이면
          // 아무도 모르는 성능 누수라, 계기판이 이 카운터의 유일한 독자다 (#9).
          (renderer.batch.overflows > 0 ? `  배치초과 ${renderer.batch.overflows}` : '')
        : '')

    // 고도계 — sqrt 스케일 (선형이면 원반 대역이 하단에 뭉개진다)
    {
      const hr = game.holeR()
      const scaleY = (v: number): number => {
        const f = Math.sqrt(Math.min(1, Math.max(0, (v - hr) / (WORLD_R - hr))))
        return ALT_H - f * ALT_H
      }
      altDot.style.top = `${scaleY(Math.hypot(p.x, p.y))}px`
      const bTop = scaleY(hr * DISK_OUT)
      const bBot = scaleY(hr * DISK_IN)
      altBand.style.top = `${bTop}px`
      altBand.style.height = `${Math.max(3, bBot - bTop)}px`
      const bar = Math.floor(game.beatClock / 4)
      altFeed.textContent = game.feeding() ? '포식!' : bar >= 16 ? `${7 - (bar % 8)}` : '—'
      altFeed.style.color = game.feeding() || game.feedWarn() ? '#ff5a46' : '#ff9d6a'
      altim.style.display = started && !result ? 'block' : 'none'
    }

    // 막 전환 — 화면 가운데에 잠깐. 15분이 5분×3이 아니라 하나의 곡선이 되려면
    // "여기까지 왔다"는 이정표가 있어야 한다.
    if (game.actIntro > 0 && !result) {
      actBanner.style.opacity = String(Math.min(1, game.actIntro / 0.8))
      actBanner.textContent = `${game.act + 1}막 · ${act.name}\n${act.sub}`
    } else {
      actBanner.style.opacity = '0'
    }
    // 비트는 막 배너와 겹치지 않게 그 아래에서 짧게
    if (game.beatIntro > 0 && !result) {
      beatBanner.style.opacity = String(Math.min(1, game.beatIntro / 0.6))
      beatBanner.textContent = `— ${game.beatName} —`
    } else {
      beatBanner.style.opacity = '0'
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
