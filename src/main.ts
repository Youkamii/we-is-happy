/**
 * 검은 입 부트스트랩 — 진짜 3D (three.js).
 *
 * 시뮬레이션은 voyage.ts(완전 3D), 화면은 render3d/scene3d.ts 가 그린다.
 * 이동은 카메라 기준(WASD·마우스), 카메라는 오른쪽 드래그·휠.
 */
import * as THREE from 'three'
import { Audio } from './engine/audio'
import { Input } from './engine/input'
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

  ;(window as unknown as Record<string, unknown>)['MAW'] = { game, scene, audio, input }

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
      line(e.log, 'color:#8fa8c4;font-size:13px')
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
    line('카이퍼 벨트와 오르트 구름을 지나면, 프록시마까지는 한세월이다', 'font-size:13px;color:#6f8299;line-height:2;margin-top:14px')
    line('마우스를 누르고 있으면 — 가리키는 곳으로 난다 (위아래 포함)', 'font-size:13px;color:#ffd9a8;line-height:2')
    line('보조: WASD·스페이스·시프트 | 시점: 오른쪽 드래그·휠 | J 명부 · M 소리', 'font-size:13px;color:#6f8299;line-height:2')
    line('아무 키나 눌러 눈을 뜬다 — 항해는 언제나 티끌에서 시작한다', 'margin-top:20px;font-size:15px;color:#ffe6b8')
    if (game.journal.length > 0) {
      line(
        `— ${game.voyages}번째 항해 · 명부 ${game.journal.length} · 최고 ${rankOf(game.bestR)} —`,
        'margin-top:10px;font-size:12px;color:#7d90a8',
      )
    }
  }
  showTitle()

  // 조작 — 마우스 홀드: 가리키는 곳으로 난다(위아래 포함). 키보드: 카메라 기준.
  const wrapped = { move: { x: 0, y: 0 }, lift: 0 } as unknown as Input
  const ndc = new THREE.Vector2()
  const ray = new THREE.Raycaster()
  const aim = new THREE.Vector3()
  const steer = (): void => {
    const w = wrapped as unknown as { move: { x: number; y: number }; lift: number }
    if (input.pointerHeld) {
      // 조준 비행 — 커서 광선 위 한 점(카메라~나 거리만큼 앞)을 향해 난다
      const r = canvas.getBoundingClientRect()
      ndc.set(
        ((input.pointerCX - r.left) / r.width) * 2 - 1,
        -(((input.pointerCY - r.top) / r.height) * 2 - 1),
      )
      ray.setFromCamera(ndc, scene.camera)
      const dist = scene.camera.position.distanceTo(aim.set(game.x, game.z, game.y))
      aim.copy(ray.ray.direction).multiplyScalar(dist * 1.15).add(scene.camera.position)
      // three (x,y,z) → 게임 (x, z, y)
      const dx = aim.x - game.x
      const dy = aim.z - game.y
      const dz = aim.y - game.z
      const m = Math.hypot(dx, dy)
      const total = Math.hypot(dx, dy, dz)
      if (total > game.radius * 2.2) {
        w.move.x = m > 1 ? dx / m : 0
        w.move.y = m > 1 ? dy / m : 0
        w.lift = Math.min(1, Math.max(-1, (dz / (total || 1)) * 2.2))
      } else {
        w.move.x = 0
        w.move.y = 0
        w.lift = 0
      }
    } else {
      const fx = -Math.sin(scene.yaw)
      const fy = -Math.cos(scene.yaw)
      w.move.x = fy * input.move.x + fx * input.move.y
      w.move.y = -fx * input.move.x + fy * input.move.y
      w.lift = input.lift
    }
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
        wake()
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
    if (input.consumePressed('m')) audio.setMuted(!audio.muted)

    if (!journalOpen) {
      steer()
      game.update(wrapped, dt)
    }
    scene.resize()
    scene.sync(game, game.visualTime)
    scene.render()

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
  fatal(`부팅 실패: ${String(e)}`)
}
