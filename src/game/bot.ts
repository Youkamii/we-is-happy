/**
 * 자동 조종 봇.
 *
 * 밸런싱을 감으로 하지 않으려고 만들었다. 사람 대신 5분을 플레이시켜서
 * 완주율·킬·레벨을 통계로 뽑는다. 사람보다 조금 못하는 수준이면 충분하다 —
 * 봇이 완주율 90%면 사람에겐 너무 쉽다는 뜻이고, 0%면 너무 어렵다는 뜻이다.
 *
 * 게임 코드가 아니라 계측 도구다. 번들에는 테스트에서만 쓰여 들어가지 않는다.
 */
import type { MoveVector } from '../engine/input'
import type { Game } from './game'
import { WORLD_R } from './game'

const buf = new Int32Array(256)

export class Bot {
  readonly move: MoveVector = { x: 0, y: 0 }
  private wander = 0

  /** 사람 흉내: 적 무리에서 멀어지고, 비어 있으면 XP 를 주우러 간다. */
  think(game: Game, dt: number): void {
    const p = game.player
    this.wander += dt

    // 1) 주변 적에서 멀어지는 방향 — 가까울수록 세게.
    // 반경이 넓으면 적 근처에 아예 안 가서 근접 무기(호·위성)로 시작한 판이
    // 영원히 0킬로 끝난다. 사람은 근접 무기면 붙는다.
    const n = game.foesInRadius(p.x, p.y, 165, buf)
    let ax = 0
    let ay = 0
    for (let k = 0; k < n; k++) {
      const j = buf[k]!
      const dx = p.x - game.foes.x[j]!
      const dy = p.y - game.foes.y[j]!
      const d2 = dx * dx + dy * dy
      if (d2 < 1) continue
      const w = 1 / d2
      ax += dx * w
      ay += dy * w
    }

    // 2) 가까운 XP 쪽으로 살짝 (사람도 줍고 싶어 한다)
    const drops = game.drops
    let gx = 0
    let gy = 0
    let best = 260 * 260
    for (let i = 0; i < drops.high; i++) {
      if (drops.alive[i] === 0) continue
      const dx = drops.x[i]! - p.x
      const dy = drops.y[i]! - p.y
      const d2 = dx * dx + dy * dy
      if (d2 < best) {
        best = d2
        gx = dx
        gy = dy
      }
    }

    let mx = 0
    let my = 0
    const aLen = Math.hypot(ax, ay)
    if (aLen > 1e-6) {
      mx += (ax / aLen) * 1.0
      my += (ay / aLen) * 1.0
    }
    const gLen = Math.hypot(gx, gy)
    if (gLen > 1e-6) {
      mx += (gx / gLen) * 0.72
      my += (gy / gLen) * 0.72
    }

    // 3) 아무것도 없으면 크게 원을 그린다 (구석에 박히지 않게)
    if (Math.hypot(mx, my) < 0.05) {
      mx = Math.cos(this.wander * 0.55)
      my = Math.sin(this.wander * 0.55)
    }

    // 4) 월드 밖으로 나가지 않게 — 경계에 붙으면 갇혀서 죽는다
    const r = Math.hypot(p.x, p.y)
    if (r > WORLD_R * 0.72) {
      const inward = (r - WORLD_R * 0.72) / (WORLD_R * 0.28)
      mx += (-p.x / r) * inward * 2.4
      my += (-p.y / r) * inward * 2.4
    }

    const len = Math.hypot(mx, my)
    if (len > 1e-6) {
      this.move.x = mx / len
      this.move.y = my / len
    } else {
      this.move.x = 0
      this.move.y = 0
    }
  }
}
