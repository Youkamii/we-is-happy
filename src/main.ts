/**
 * 검은 입 부트스트랩 — 우주를 삼키는 탐험 (씨앗: 사용자, 2026-07-18).
 *
 * 점수도 타이머도 없는 게임의 껍데기는 조용해야 한다:
 * 좌하단 좌표·칭호(우주가 결정론이라 좌표가 곧 장소다), 삼킨 것의 이름 페이드,
 * 등급 배너, J 로 여는 포식 명부. 그게 전부다.
 */
import { Audio } from './engine/audio'
import { createContext, GLError } from './engine/gl'
import { Input } from './engine/input'
import { Renderer } from './engine/renderer'
import { STORE_KEY, Voyage, rankOf, type Store } from './game/voyage'

function fatal(msg: string): void {
  const el = document.getElementById('fatal')
  const m = document.getElementById('fatal-msg')
  if (m) m.textContent = msg
  if (el) el.classList.add('show')
  console.error(msg)
}

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null
  if (!canvas) throw new Error('캔버스를 찾을 수 없습니다.')
  const gl = createContext(canvas)
  const renderer = new Renderer(canvas, gl)
  const input = new Input(canvas)
  const audio = new Audio()
  const game = new Voyage()

  const store: Store = {
    load: () => localStorage.getItem(STORE_KEY),
    save: (s) => localStorage.setItem(STORE_KEY, s),
  }
  game.start(store)

  const wake = (): void => {
    audio.start()
    audio.resume()
  }
  window.addEventListener('pointerdown', wake, { once: true })
  window.addEventListener('keydown', wake, { once: true })
  // 배치 저장의 마지막 조각 — 탭을 닫아도 마지막 한 입은 명부에 남는다
  window.addEventListener('pagehide', () => game.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') game.flush()
  })

  ;(window as unknown as Record<string, unknown>)['MAW'] = { game, audio, renderer, input }

  const ui = document.getElementById('ui')!

  // 좌하단 — 좌표와 빛. 우주에서 좌표는 곧 주소다.
  const coords = document.createElement('div')
  coords.style.cssText =
    'position:absolute;left:16px;bottom:14px;font:600 12px/1.8 ui-monospace,monospace;' +
    'color:#7d90a8;text-shadow:0 0 8px rgba(60,120,255,.3);white-space:pre;'
  ui.appendChild(coords)

  // 발견 문장 — 화면 하단 중앙에 떠올랐다 사라진다
  const foundEl = document.createElement('div')
  foundEl.style.cssText =
    'position:absolute;left:0;right:0;bottom:18%;text-align:center;pointer-events:none;' +
    'font:700 20px/1.8 ui-monospace,monospace;color:#ffe6b8;white-space:pre;' +
    'text-shadow:0 0 24px rgba(255,180,80,.6);opacity:0;transition:opacity 1.2s;'
  ui.appendChild(foundEl)
  let foundUntil = 0

  // 항해일지 오버레이 (J)
  const journalEl = document.createElement('div')
  journalEl.style.cssText =
    'position:absolute;inset:0;display:none;place-content:center;text-align:left;' +
    'background:radial-gradient(ellipse at center,rgba(4,6,12,.88),rgba(2,3,7,.97));' +
    'font:500 14px/2 ui-monospace,monospace;color:#cfe8ff;padding:40px;overflow:auto;'
  ui.appendChild(journalEl)
  let journalOpen = false
  const renderJournal = (): void => {
    journalEl.replaceChildren()
    const wrap = document.createElement('div')
    wrap.style.cssText = 'max-width:640px;margin:0 auto;'
    const line = (text: string, style: string): void => {
      const d = document.createElement('div')
      d.textContent = text
      d.style.cssText = style
      wrap.appendChild(d)
    }
    line('포식 명부', 'font-size:28px;letter-spacing:.3em;color:#ffd9a8;margin-bottom:6px')
    line(
      `${game.voyages}번째 항해 · 명부 ${game.journal.length} · 이번 판 ${game.eatenThisRun} · ` +
      `최고 반지름 ${game.bestR} · 가장 큰 한 입 ${game.biggestMeal} · ` +
      `가장 먼 항해 ${Math.round(game.farthest).toLocaleString()}`,
      'font-size:12px;color:#7d90a8;margin-bottom:20px',
    )
    if (game.journal.length === 0) {
      line('아직 아무것도 삼키지 않았다. 처음엔 티끌부터.', 'color:#8fa8c4')
    }
    for (let i = game.journal.length - 1; i >= Math.max(0, game.journal.length - 40); i--) {
      const e = game.journal[i]!
      line(`「${e.name}」  r${e.r}  (${e.x}, ${e.y})`, 'color:#ffe6b8;margin-top:10px')
      line(e.log, 'color:#8fa8c4;font-size:13px')
    }
    line('J — 닫기', 'margin-top:26px;color:#5f7893;font-size:12px')
    journalEl.appendChild(wrap)
  }

  // 등급 배너 — "내가 무엇이 되어가는가"의 세리머니
  const rankEl = document.createElement('div')
  rankEl.style.cssText =
    'position:absolute;left:0;right:0;top:26%;text-align:center;pointer-events:none;' +
    'font:800 36px/1.6 ui-monospace,monospace;color:#ffe6b8;white-space:pre;' +
    'text-shadow:0 0 36px rgba(255,180,80,.8);opacity:0;transition:opacity 1s;letter-spacing:.24em;'
  ui.appendChild(rankEl)
  let rankUntil = 0

  let started = false
  const center = document.createElement('div')
  center.style.cssText =
    'position:absolute;inset:0;display:grid;place-content:center;text-align:center;' +
    'font:700 30px/1.6 ui-monospace,monospace;color:#ffd9a8;white-space:pre;' +
    'text-shadow:0 0 24px rgba(255,140,40,.45);'
  ui.appendChild(center)
  const showTitle = (): void => {
    center.replaceChildren()
    const line = (text: string, style: string): void => {
      const d = document.createElement('div')
      d.textContent = text
      d.style.cssText = style
      center.appendChild(d)
    }
    line('검은 입', 'font-size:56px;letter-spacing:.5em;color:#ffd9a8')
    line('너는 지구 곁의, 티끌만 한 블랙홀이다', 'margin-top:16px;font-size:14px;color:#8fa8c4;line-height:2')
    line('삼키면 커지고, 커지면 어제 못 삼키던 것을 삼킨다', 'font-size:14px;color:#ffb066;line-height:2')
    line('여긴 진짜 우주다 — 달부터. 그다음 행성. 그다음 태양.', 'font-size:14px;color:#8fa8c4;line-height:2')
    line('카이퍼 벨트와 오르트 구름을 지나면, 프록시마까지는 한세월이다', 'font-size:13px;color:#6f8299;line-height:2;margin-top:14px')
    line('삼키기엔 큰 것은 바짝 붙어 조석으로 찢어라 — 가스가 되어 흘러들어온다', 'font-size:13px;color:#6f8299;line-height:2')
    line('이동 WASD·마우스·터치 | 상승 스페이스 · 하강 시프트 | J 명부 · M 소리', 'font-size:13px;color:#6f8299;line-height:2')
    line('아무 키나 눌러 눈을 뜬다 — 항해는 언제나 티끌에서 시작한다', 'margin-top:20px;font-size:15px;color:#ffe6b8')
    if (game.journal.length > 0) {
      line(
        `— ${game.voyages}번째 항해 · 명부 ${game.journal.length} · 최고 ${rankOf(game.bestR)} —`,
        'margin-top:10px;font-size:12px;color:#7d90a8',
      )
    }
  }
  showTitle()

  let last = performance.now()
  const frame = (): void => {
    const now = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    input.update()

    if (!started) {
      if (input.anyInput) {
        started = true
        center.replaceChildren()
        wake()
      }
      // 타이틀에서도 시간은 흐른다 — 별이 반짝이고 성운이 흘러야 우주가 살아 보인다
      game.visualTime += dt
      renderer.resize()
      game.render(renderer)
      input.endFrame()
      requestAnimationFrame(frame)
      return
    }

    if (input.consumePressed('j')) {
      journalOpen = !journalOpen
      journalEl.style.display = journalOpen ? 'grid' : 'none'
      if (journalOpen) renderJournal()
    }
    if (input.consumePressed('m')) audio.setMuted(!audio.muted)

    if (!journalOpen) game.update(input, dt)
    renderer.resize()
    game.render(renderer)

    for (let i = 0; i < game.sfxQueue.length; i++) audio.play(game.sfxQueue[i]!)
    game.sfxQueue.length = 0

    if (game.lastFound) {
      foundEl.textContent = `「${game.lastFound.name}」 을 삼켰다\n${game.lastFound.log}`
      foundEl.style.opacity = '1'
      foundUntil = now + 4200
      game.lastFound = null
    }
    if (foundUntil > 0 && now > foundUntil) {
      foundEl.style.opacity = '0'
      foundUntil = 0
    }
    if (game.rankUp) {
      rankEl.textContent = `— ${game.rankUp} —`
      rankEl.style.opacity = '1'
      rankUntil = now + 3600
      game.rankUp = null
    }
    if (rankUntil > 0 && now > rankUntil) {
      rankEl.style.opacity = '0'
      rankUntil = 0
    }

    coords.textContent =
      `${rankOf(game.radius)}  ·  r${Math.round(game.radius)}\n` +
      `(${Math.round(game.x)}, ${Math.round(game.y)}, z${Math.round(game.z)})  ·  ` +
      `이번 항해 ${game.eatenThisRun} · 명부 ${game.journal.length}`

    input.endFrame()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

try {
  boot()
} catch (e) {
  fatal(e instanceof GLError ? e.message : `부팅 실패: ${String(e)}`)
}
