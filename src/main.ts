/**
 * 검은 입 부트스트랩 — 진짜 3D (three.js).
 *
 * 시뮬레이션은 voyage.ts(완전 3D), 화면은 render3d/scene3d.ts 가 그린다.
 * 이동은 카메라 기준(WASD·마우스), 카메라는 오른쪽 드래그·휠.
 */
import * as THREE from 'three'
import { Input } from './engine/input'
import { LY } from './game/starmap'
import { STORE_KEY, Voyage, rankOf, type Store } from './game/voyage'
import { Scene3D } from './render3d/scene3d'

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
  const scene = new Scene3D(canvas)
  const input = new Input(canvas)
  const game = new Voyage()

  const store: Store = {
    load: () => localStorage.getItem(STORE_KEY),
    save: (s) => localStorage.setItem(STORE_KEY, s),
  }
  game.start(store)

  // 소리 없음 — 오디오는 구 게임의 유물이었고 판정으로 전부 제거됐다 (2026-07-18)
  // 배치 저장의 마지막 조각 — 탭을 닫아도 마지막 한 입은 명부에 남는다
  window.addEventListener('pagehide', () => game.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') game.flush()
  })

  ;(window as unknown as Record<string, unknown>)['MAW'] = { game, scene, input }

  const ui = document.getElementById('ui')!

  const coords = document.createElement('div')
  coords.style.cssText =
    'position:absolute;left:16px;bottom:14px;font:600 12px/1.8 ui-monospace,monospace;' +
    'color:#7d90a8;text-shadow:0 0 8px rgba(60,120,255,.3);white-space:pre;'
  ui.appendChild(coords)

  const foundEl = document.createElement('div')
  foundEl.style.cssText =
    'position:absolute;left:0;right:0;bottom:18%;text-align:center;pointer-events:none;' +
    'font:700 20px/1.8 ui-monospace,monospace;color:#ffe6b8;white-space:pre;' +
    'text-shadow:0 0 24px rgba(255,180,80,.6);opacity:0;transition:opacity 1.2s;'
  ui.appendChild(foundEl)
  let foundUntil = 0

  // 나침반 — 화면 가장자리 금색 화살촉 (씬 밖 먹이 방향)
  const arrow = document.createElement('div')
  arrow.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;opacity:0;' +
    'border-left:9px solid transparent;border-right:9px solid transparent;' +
    'border-bottom:16px solid #d9a84c;filter:drop-shadow(0 0 6px rgba(255,190,90,.8));'
  ui.appendChild(arrow)

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
      line('아직 아무것도 삼키지 않았다. 처음엔 달부터.', 'color:#8fa8c4')
    }
    for (let i = game.journal.length - 1; i >= Math.max(0, game.journal.length - 40); i--) {
      const e = game.journal[i]!
      line(`「${e.name}」  r${e.r}  (${e.x}, ${e.y})`, 'color:#ffe6b8;margin-top:10px')
    }
    line('J — 닫기', 'margin-top:26px;color:#5f7893;font-size:12px')
    journalEl.appendChild(wrap)
  }

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
    line('카이퍼 벨트와 오르트 구름을 지나면, 빈 우주에선 성간 순항이 붙는다', 'font-size:13px;color:#6f8299;line-height:2;margin-top:14px')
    line('나침반이 언제나 다음 별을 가리킨다 — 은하수는 넓고, 끝은 안드로메다 너머다', 'font-size:13px;color:#6f8299;line-height:2')
    line('이동 WASD · 상승 스페이스 · 하강 시프트', 'font-size:13px;color:#ffd9a8;line-height:2')
    line('시점: 마우스 왼쪽 드래그 · 줌 휠 | J 명부 · N 자동 항법(먹으며 항로 추적)', 'font-size:13px;color:#6f8299;line-height:2')
    line('아무 키나 눌러 눈을 뜬다 — 항해는 언제나 티끌에서 시작한다', 'margin-top:20px;font-size:15px;color:#ffe6b8')
    if (game.journal.length > 0) {
      line(
        `— ${game.voyages}번째 항해 · 명부 ${game.journal.length} · 최고 ${rankOf(game.bestR)} —`,
        'margin-top:10px;font-size:12px;color:#7d90a8',
      )
    }
  }
  showTitle()

  const wrapped = { move: { x: 0, y: 0 }, lift: 0 } as unknown as Input
  // 자동 항법 — 나침반이 가리키는 것(먹이 우선, 없으면 다음 항로)을 추적하며
  // 먹고 이동한다. 수동 입력이 오면 즉시 해제 ("주변거 잡아먹으면서 목적지로").
  let autoNav = false
  const autoSteer = (): void => {
    const w = wrapped as unknown as { move: { x: number; y: number }; lift: number }
    const dx = game.preyX - game.x
    const dy = game.preyY - game.y
    const d = Math.hypot(dx, dy) || 1
    const sp = Math.hypot(game.vx, game.vy)
    if (d < sp * 0.7 && sp > 1) {
      // 도착 브레이크 — 지나치기 전에 역추진 (봇 검증 로직)
      w.move.x = -game.vx / sp
      w.move.y = -game.vy / sp
    } else {
      w.move.x = dx / d
      w.move.y = dy / d
    }
    const dz = game.preyZ - game.z
    const zBand = Math.max(300, d * 0.2)
    w.lift = dz > zBand ? 1 : dz < -zBand ? -1 : 0
  }
  const steer = (): void => {
    // 이동은 WASD(카메라 기준)·스페이스·시프트, 마우스 왼쪽은 시점 회전 전용
    const w = wrapped as unknown as { move: { x: number; y: number }; lift: number }
    // forward = 카메라 반대편(화면 안쪽), right = forward 를 +90° 돌린 것.
    // 부호가 하나라도 틀리면 좌우 반전 — D 는 반드시 화면 오른쪽이다 (실플레이).
    const fx = -Math.sin(scene.yaw)
    const fy = -Math.cos(scene.yaw)
    w.move.x = -fy * input.move.x + fx * input.move.y
    w.move.y = fx * input.move.x + fy * input.move.y
    w.lift = input.lift
  }

  const proj = new THREE.Vector3()
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
      }
      game.visualTime += dt
      scene.resize()
      scene.sync(game, game.visualTime)
      scene.render()
      input.endFrame()
      requestAnimationFrame(frame)
      return
    }

    if (input.consumePressed('j')) {
      journalOpen = !journalOpen
      journalEl.style.display = journalOpen ? 'grid' : 'none'
      if (journalOpen) renderJournal()
    }
    if (input.consumePressed('x')) scene.axes.visible = !scene.axes.visible
    if (input.consumePressed('n')) autoNav = !autoNav
    if (autoNav && (input.move.x !== 0 || input.move.y !== 0 || input.lift !== 0)) autoNav = false

    if (!journalOpen) {
      if (autoNav && game.preyDist < Infinity) autoSteer()
      else steer()
      game.update(wrapped, dt)
    }
    scene.resize()
    scene.sync(game, game.visualTime)
    scene.render()

    game.sfxQueue.length = 0

    if (game.lastFound) {
      foundEl.textContent = `「${game.lastFound.name}」`
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

    // 나침반 — 먹이를 화면에 투영해, 화면 밖이면 가장자리 화살표로
    if (game.preyDist < Infinity) {
      proj.set(game.preyX, game.preyZ, game.preyY).project(scene.camera)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const behind = proj.z > 1
      let sx = (proj.x + 1) / 2
      let sy = (1 - proj.y) / 2
      if (behind) {
        sx = 1 - sx
        sy = 1 - sy
      }
      const off = sx < 0.03 || sx > 0.97 || sy < 0.03 || sy > 0.97 || behind
      if (off) {
        const cx = Math.min(0.97, Math.max(0.03, sx))
        const cy = Math.min(0.95, Math.max(0.05, sy))
        const ang = Math.atan2(sy - 0.5, sx - 0.5)
        arrow.style.opacity = '0.9'
        arrow.style.left = `${cx * w - 9}px`
        arrow.style.top = `${cy * h - 8}px`
        arrow.style.transform = `rotate(${ang + Math.PI / 2}rad)`
      } else {
        arrow.style.opacity = '0'
      }
    } else {
      arrow.style.opacity = '0'
    }

    // 다음 항로 — 공허에서 게임이 안 끝났다고 말하는 줄
    const lyd = game.routeDist / LY
    const navTag = autoNav ? '  ·  자동 항법(N 해제)' : ''
    const routeLine = game.routeName
      ? `\n다음 항로  ${game.routeName} · ${lyd >= 0.1 ? `${lyd.toFixed(1)}광년` : `${Math.round(game.routeDist / 1000)}k`}` +
        (game.cruise > 1.5 ? `  ·  성간 순항 ×${game.cruise.toFixed(1)}` : '') + navTag
      : (game.cruise > 1.5 ? `\n성간 순항 ×${game.cruise.toFixed(1)}${navTag}` : navTag ? `\n${navTag.trim()}` : '')
    // 성장은 반지름이 아니라 질량이다 — 소화 중(스트림)인 것도 이미 내 질량이다:
    // 태양을 삼킨 직후 "지구 ×22" 같은 헛숫자를 막는다 (실플레이)
    const totalVol = game.vol + game.digesting
    const mE = totalVol / 779
    const mass = (mE >= 936
      ? `태양 ×${(totalVol / 729000).toFixed(totalVol / 729000 < 100 ? 1 : 0)}`
      : mE >= 1
        ? `지구 ×${mE >= 100 ? Math.round(mE) : mE.toFixed(1)}`
        : `달 ×${Math.max(1, Math.round(totalVol / 15.6))}`) +
      (game.digesting > totalVol * 0.05 ? ' (소화 중)' : '')
    coords.textContent =
      `${rankOf(game.radius)}  ·  질량 ${mass}\n` +
      `(${Math.round(game.x)}, ${Math.round(game.y)}, z${Math.round(game.z)})  ·  ` +
      `이번 항해 ${game.eatenThisRun} · 명부 ${game.journal.length}` +
      `${game.halo.length > 0 ? ` · 나의 은하 ${game.halo.length}성` : ''}` +
      `${routeLine}\n` +
      `축(X 토글): 빨강 x · 파랑 y · 초록 z↑`

    input.endFrame()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

try {
  boot()
} catch (e) {
  fatal(`부팅 실패: ${String(e)}`)
}
