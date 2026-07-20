/**
 * 검은 입 부트스트랩 — 진짜 3D (three.js).
 *
 * 시뮬레이션은 voyage.ts(완전 3D), 화면은 render3d/scene3d.ts 가 그린다.
 * 이동은 카메라 기준(WASD·마우스), 카메라는 오른쪽 드래그·휠.
 */
import * as THREE from 'three'
import { Input } from './engine/input'
import { lyOf } from './game/starmap'
import { STORE_KEY, Voyage, type Store } from './game/voyage'
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
  // 질량 과부하 — H 토글: 켜져 있는 동안 유효 질량 추가 ×1000
  let surgeOn = false
  window.addEventListener('keydown', (e) => {
    if (!e.repeat && (e.key === 'h' || e.key === 'H' || e.key === 'ㅗ')) surgeOn = !surgeOn
  })
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
  let lastRegion = ''

  // 블랙홀 실험 — 버튼을 누르면 10초 카운트 후 30초에 걸쳐 붕괴 (사용자 사양).
  // 누르기 전까지 나는 평범한 지구다: 아무것도 끌지도, 먹지도 않는다.
  const expBtn = document.createElement('button')
  expBtn.textContent = '☺ 행복 버튼'
  expBtn.style.cssText =
    'position:absolute;right:16px;top:14px;font:800 15px/1.6 ui-monospace,monospace;' +
    'color:#3b1020;background:linear-gradient(135deg,#ffd9a8,#ff9ec0 60%,#ffb066);' +
    'border:none;border-radius:999px;padding:10px 22px;letter-spacing:.14em;' +
    'box-shadow:0 0 18px rgba(255,158,192,.75),0 0 42px rgba(255,176,102,.4);' +
    // #ui 는 pointer-events:none — 명시로 켜야 클릭이 닿는다 ("눌러도 안 움직여")
    'cursor:pointer;display:none;pointer-events:auto;'
  expBtn.addEventListener('click', () => {
    game.startExperiment()
  })
  ui.appendChild(expBtn)
  const expEl = document.createElement('div')
  expEl.style.cssText =
    'position:absolute;right:16px;top:14px;text-align:right;pointer-events:none;' +
    'font:800 18px/1.6 ui-monospace,monospace;color:#ffb066;white-space:pre;' +
    'text-shadow:0 0 14px rgba(255,140,40,.55);display:none;'
  ui.appendChild(expEl)

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
    line('We is Happy', 'font-size:56px;letter-spacing:.35em;color:#ffd9a8')
    line('"모두 하나가 되면 행복해질 수 있어."', 'margin-top:16px;font-size:17px;color:#ffb8c8;line-height:2;text-shadow:0 0 18px rgba(255,158,192,.5)')
    line('키보드 — 이동 W A S D · 상승 스페이스 · 하강 시프트', 'margin-top:20px;font-size:13px;color:#ffd9a8;line-height:2')
    line('마우스 — 왼쪽 드래그 시점 회전 · 휠 줌', 'font-size:13px;color:#ffd9a8;line-height:2')
    line('좌표 클릭 — 화면의 천체 이름을 누르면 그곳까지 자동 비행', 'font-size:13px;color:#ffd9a8;line-height:2')
    line('자동 항법 — N 켜고 끄기 · 먹이와 다음 항로를 알아서 쫓는다', 'font-size:13px;color:#ffd9a8;line-height:2')
    line('J 명부 · H 질량 과부하(토글) · X 축 표시', 'font-size:12px;color:#6f8299;line-height:2')
    line('아무 키나 눌러 시작 — 그리고 우측 상단의 행복 버튼을 누른다', 'margin-top:20px;font-size:15px;color:#ffe6b8')
    if (game.journal.length > 0) {
      line(
        `— ${game.voyages}번째 항해 · 명부 ${game.journal.length} —`,
        'margin-top:10px;font-size:12px;color:#7d90a8',
      )
    }
  }
  showTitle()

  const wrapped = { move: { x: 0, y: 0 }, lift: 0 } as unknown as Input
  // 자동 항법 — 나침반이 가리키는 것(먹이 우선, 없으면 다음 항로)을 추적하며
  // 먹고 이동한다. 수동 입력이 오면 즉시 해제 ("주변거 잡아먹으면서 목적지로").
  let autoNav = false
  /** 라벨 클릭 목적지 — 도착(3화면)하면 해제되고 일반 항법으로 넘어간다 */
  let navPick: { x: number; y: number; z: number; name: string } | null = null
  const autoSteer = (): void => {
    const w = wrapped as unknown as { move: { x: number; y: number }; lift: number }
    const vh = game.camera.viewHeight
    // 도착 판정은 3D — xy 만 보면 z 가 수백만 남은 채 항법이 풀린다 ("z좌표 버그")
    if (navPick && Math.hypot(navPick.x - game.x, navPick.y - game.y, navPick.z - game.z) < vh * 3) {
      // 클릭 목적지 도착 — 항법을 끄고 그 자리에 선다 ("베가 찍고 바로 딴 데로": 실플레이)
      navPick = null
      autoNav = false
      w.move.x = 0
      w.move.y = 0
      w.lift = 0
      return
    }
    // 클릭 목적지 > 근처 실속 먹이 > 항로 ("자동항법 느림" 수리 유지)
    const useRoute = !navPick && game.routeName !== null && game.preyDist > vh * 2.2
    const tx = navPick ? navPick.x : useRoute ? game.routeX : game.preyX
    const ty = navPick ? navPick.y : useRoute ? game.routeY : game.preyY
    const tz = navPick ? navPick.z : useRoute ? game.routeZ : game.preyZ
    const dx = tx - game.x
    const dy = ty - game.y
    const d = Math.hypot(dx, dy) || 1
    const sp = Math.hypot(game.vx, game.vy)
    if (d < sp * 0.7 && sp > 1) {
      // 도착 브레이크 — 항로든 먹이든, 지나치기 전에 역추진 (봇 검증 로직)
      w.move.x = -game.vx / sp
      w.move.y = -game.vy / sp
    } else {
      w.move.x = dx / d
      w.move.y = dy / d
    }
    const dz = tz - game.z
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
    if (scene.pick) {
      navPick = scene.pick
      autoNav = true
      scene.pick = null
    }
    if (autoNav && (input.move.x !== 0 || input.move.y !== 0 || input.lift !== 0)) {
      autoNav = false
      navPick = null
    }

    if (!journalOpen) {
      game.navAssist = autoNav
      game.surge = surgeOn
      // 클릭 목적지를 시뮬에 정식 전달 — 속도·제동·z 수렴이 전부 이 좌표 기준
      game.navOn = navPick !== null
      if (navPick) {
        game.navX = navPick.x
        game.navY = navPick.y
        game.navZ = navPick.z
      }
      if (autoNav && (navPick || game.preyDist < Infinity)) autoSteer()
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
    // 지역 도달 — 이름 하나만 뜬다 (등급 배너 폐지)
    game.rankUp = null
    if (game.region && game.region !== lastRegion) {
      lastRegion = game.region
      rankEl.textContent = game.region
      rankEl.style.opacity = '1'
      rankUntil = now + 3200
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

    // 다음 항로 — 공허에서 게임이 안 끝났다고 말하는 줄.
    // 거리는 **실거리 광년** — 압축 좌표를 광년으로 나누면 마젤란(16만 광년)이
    // "300광년"으로 뜨는 거짓말이 된다 (실플레이)
    const fmtLy = (px: number): string => {
      const v = lyOf(px)
      return v >= 10000 ? `${(v / 10000).toFixed(1)}만 광년`
        : v >= 0.1 ? `${v.toFixed(1)}광년` : `${Math.round(px / 1000)}k`
    }
    const navTag = autoNav ? '  ·  자동 항법(N 해제)' : ''
    // 클릭 지정 목적지가 있으면 HUD 도 그걸 말한다 ("찍었는데 왜 프록시마": 실플레이)
    const routeLine = navPick
      ? `\n지정 항로  ${navPick.name} · ${fmtLy(Math.hypot(navPick.x - game.x, navPick.y - game.y, navPick.z - game.z))}` +
        (game.cruise > 1.5 ? `  ·  성간 순항 ×${game.cruise.toFixed(1)}` : '') + navTag
      : game.routeName
      ? `\n다음 항로  ${game.routeName} · ${fmtLy(game.routeDist)}` +
        (game.cruise > 1.5 ? `  ·  성간 순항 ×${game.cruise.toFixed(1)}` : '') + navTag
      : (game.cruise > 1.5 ? `\n성간 순항 ×${game.cruise.toFixed(1)}${navTag}` : navTag ? `\n${navTag.trim()}` : '')
    // 성장은 반지름이 아니라 질량이다 — 소화 중(스트림)인 것도 이미 내 질량이다.
    // 지구 기준 = 시작 질량(volFor(15.6)≈64,690): 나는 지구 ×1 에서 시작한다
    const totalVol = game.vol + game.digesting
    const mE = totalVol / 64690
    const mass = (totalVol >= 729000
      ? `태양 ×${(totalVol / 729000).toFixed(totalVol / 729000 < 100 ? 1 : 0)}`
      : `지구 ×${mE >= 100 ? Math.round(mE) : mE.toFixed(1)}`) +
      (game.digesting > totalVol * 0.05 ? ' (소화 중)' : '')
    // 실험 카운트 — 우측 상단: 버튼 전엔 버튼, 카운트 중엔 초읽기
    if (!game.expOn) {
      expBtn.style.display = started ? 'block' : 'none'
      expEl.style.display = 'none'
    } else {
      expBtn.style.display = 'none'
      if (game.expT < 10) {
        expEl.style.display = 'block'
        expEl.textContent = `블랙홀화 시작  ${Math.ceil(10 - game.expT)}`
      } else if (game.expT < 40) {
        expEl.style.display = 'block'
        expEl.textContent = `블랙홀화  ${Math.ceil(40 - game.expT)}`
      } else {
        expEl.style.display = 'none'
      }
    }
    coords.textContent =
      `${game.region || '태양계'}  ·  질량 ${mass}${surgeOn ? '  ·  과부하 ×1000' : ''}\n` +
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
