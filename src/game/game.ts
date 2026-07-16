/**
 * 게임 루프 통합.
 *
 * 고정 타임스텝으로 시뮬레이션을 돌린다. 가변 dt 를 쓰면 프레임률에 따라
 * 밸런스가 달라지고, 협동에서 두 대의 결과가 갈린다.
 */
import type { SfxName } from '../engine/audio'
import { Camera } from '../engine/camera'
import { SpatialHash } from '../engine/grid'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Rng } from '../engine/rng'
import { Shape } from '../engine/shapes'
import { burst, shockwave, smoke, spray, updateMotes } from './fx'
import { FOE_STATS, foeRotation, spawnCluster, spawnRing, updateFoes } from './foes'
import { Loadout, type Choice } from './loadout'
import { Player } from './player'
import { CELL, Terrain } from './terrain'
import { Drop, Drops, Foe, Foes, Motes, Shots, type FoeType } from './pools'
import { isEvolvedShot, tickWeapon, W, WEAPONS, type FireCtx } from './weapons'

export const WORLD_R = 2600
export const RUN_SECONDS = 300

const MAX_FOES = 20000
const MAX_SHOTS = 4000
const MAX_MOTES = 24000
const MAX_DROPS = 3000

/** 시뮬레이션 고정 스텝 (초). 1/60. */
const STEP = 1 / 60
/** 한 프레임에 따라잡을 수 있는 최대 스텝 수. 탭 복귀 시 죽음의 나선을 막는다. */
const MAX_STEPS = 5

export const Phase = {
  Playing: 0,
  LevelUp: 1,
  Dead: 2,
  Won: 3,
} as const
export type PhaseType = (typeof Phase)[keyof typeof Phase]

export class Game implements FireCtx {
  readonly player = new Player()
  readonly foes = new Foes(MAX_FOES)
  readonly shots = new Shots(MAX_SHOTS)
  readonly motes = new Motes(MAX_MOTES)
  readonly drops = new Drops(MAX_DROPS)
  readonly camera = new Camera()
  readonly loadout = new Loadout()
  readonly hash = new SpatialHash(-WORLD_R, -WORLD_R, WORLD_R * 2, WORLD_R * 2, 52, MAX_FOES)
  readonly terrain = new Terrain(WORLD_R)

  rng = new Rng(1)
  private acc = 0
  private spawnTimer = 0
  /** 관통탄이 같은 적을 반복 타격하는 걸 막는 단조 증가 스탬프 */
  private hitStamp = 1
  private readonly foeStamp = new Int32Array(MAX_FOES)
  private readonly queryBuf = new Int32Array(512)
  /** 한 스텝에 화상으로 죽는 적을 담는 버퍼 */
  private readonly deadBuf = new Int32Array(2048)
  /** 불이 옮겨붙을 후보 */
  private readonly spreadBuf = new Int32Array(64)
  /** 스폰 함수에 넘길 난수원. 매 스폰마다 클로저를 새로 만들지 않으려고 붙잡아 둔다. */
  private readonly randFn = (): number => this.rng.next()
  /** 지형 충돌 결과를 받는 스크래치 */
  private readonly hit2 = new Float32Array(2)

  phase: PhaseType = Phase.Playing
  elapsed = 0
  seed = 1
  /** 순수 연출용 시간 — 일시정지 중에도 흐른다 */
  visualTime = 0
  /** 레벨업 대기 중인 선택지. UI 가 이걸 읽어 그린다. */
  pendingChoices: Choice[] = []
  /** 레벨업이 한 번에 여러 번 터졌을 때 밀린 횟수 */
  private pendingLevels = 0
  /**
   * 이번 프레임에 낼 소리. Game 이 Audio 를 직접 들면 시뮬레이션이 브라우저에
   * 묶여서 테스트가 안 돈다 — 큐에 쌓고 main 이 소비한다.
   */
  readonly sfxQueue: SfxName[] = []

  /** FireCtx — 무기 코드가 소리를 요청하는 통로 */
  sfx(name: SfxName): void {
    // 후반에 초당 수백 개가 쌓이면 그것대로 낭비다. 오디오 쪽 스로틀이 어차피 걸러낸다.
    if (this.sfxQueue.length < 24) this.sfxQueue.push(name)
  }

  /** FireCtx — 무기 코드가 읽는 시간 */
  get time(): number {
    return this.elapsed
  }

  start(seed: number): void {
    this.seed = seed
    this.rng = new Rng(seed)
    this.player.reset()
    this.foes.clear()
    this.shots.clear()
    this.motes.clear()
    this.drops.clear()
    this.foeStamp.fill(0)
    this.hitStamp = 1
    this.acc = 0
    this.spawnTimer = 0
    this.elapsed = 0
    this.phase = Phase.Playing
    this.pendingChoices = []
    this.pendingLevels = 0
    // 지형은 시드에서 나온다. 같은 시드 = 같은 맵.
    this.terrain.generate(seed, WORLD_R, 1)
    // 시작 무기는 시드로 정한다 — 매판 다른 빌드로 출발한다
    this.loadout.reset(this.rng.int(WEAPONS.length))
    this.loadout.recomputeStats(this.player)
    this.player.hp = this.player.stats.maxHp
    this.camera.x = 0
    this.camera.y = 0
    this.camera.viewHeight = 820
  }

  /** 레벨업 선택 확정. UI 가 부른다. */
  choose(choice: Choice): void {
    this.loadout.apply(choice, this.player)
    if (choice.kind === 'evolve') {
      this.sfx('evolve')
      shockwave(this.motes, this.player.x, this.player.y, 220, choice.r, choice.g, choice.b, 0.9)
      burst(this.motes, this.player.x, this.player.y, 60, choice.r, choice.g, choice.b, 460, 1.0, 8, Shape.Star)
      this.camera.shake(14, 8)
    }
    this.pendingLevels--
    if (this.pendingLevels > 0) {
      this.pendingChoices = this.loadout.roll(this.rng)
    } else {
      this.pendingChoices = []
      this.pendingLevels = 0
      if (this.phase === Phase.LevelUp) this.phase = Phase.Playing
    }
  }

  /** 프레임당 1회. 내부에서 고정 스텝으로 나눠 돈다. */
  update(input: Input, frameDt: number): void {
    this.visualTime += frameDt
    if (this.phase !== Phase.Playing) {
      // 죽거나 레벨업 창이 떠도 파티클은 계속 흐른다 (화면이 얼어붙으면 죽은 것처럼 보인다)
      updateMotes(this.motes, Math.min(frameDt, 0.05))
      this.camera.update(frameDt)
      // 피격 플래시 감쇠는 player.update() 안에 있는데 여기선 그걸 안 부른다.
      // 빼먹으면 죽는 순간의 1.0 이 박제돼 화면이 영원히 빨갛다.
      if (this.player.hurtFlash > 0) {
        this.player.hurtFlash = Math.max(0, this.player.hurtFlash - frameDt * 2.2)
      }
      return
    }

    this.acc += Math.min(frameDt, 0.25)
    let steps = 0
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.step(input, STEP)
      this.acc -= STEP
      steps++
    }
    if (steps === MAX_STEPS) this.acc = 0 // 밀린 건 버린다

    this.camera.follow(this.player.x, this.player.y, frameDt, 7.5)
    this.camera.update(frameDt)
  }

  private step(input: Input, dt: number): void {
    this.elapsed += dt

    this.player.update(input.move, dt, WORLD_R)
    // 지형은 플레이어를 막는다 (적은 갉아먹고 지나간다)
    if (this.terrain.resolveCircle(this.player.x, this.player.y, this.player.radius, this.hit2)) {
      this.player.x = this.hit2[0]!
      this.player.y = this.hit2[1]!
    }

    const res = updateFoes(
      {
        foes: this.foes,
        hash: this.hash,
        playerX: this.player.x,
        playerY: this.player.y,
        dt,
        time: this.elapsed,
        worldR: WORLD_R,
        deadOut: this.deadBuf,
        terrain: this.terrain,
      },
      this.player.radius,
    )

    // 화상으로 쓰러진 적만 거둔다. 전체를 훑으면 후반에 매 스텝 2만 번이 그냥 낭비된다.
    for (let k = 0; k < res.deadCount; k++) this.killFoe(this.deadBuf[k]!)

    if (res.contactDamage > 0 && this.player.hurt(res.contactDamage * 2.2)) {
      this.camera.shake(9, 12)
      this.sfx('hurt')
    }
    if (!this.player.alive) {
      this.onDeath()
      return
    }

    this.tickWeapons(dt)
    this.updateShots(dt)
    this.updateDrops(dt)
    updateMotes(this.motes, dt)
    this.spawn(dt)

    if (this.elapsed >= RUN_SECONDS) {
      this.phase = Phase.Won
      this.sfx('win')
    }
  }

  // ── 스폰 ─────────────────────────────────────────────────────────────

  /**
   * 5분 곡선. 처음엔 숨을 주고, 갈수록 화면을 메운다.
   * 여기 숫자가 게임의 난이도 전부다 — #6에서 웨이브 스케줄로 뺀다.
   */
  private spawn(dt: number): void {
    const t = this.elapsed
    const progress = t / RUN_SECONDS

    // 초당 스폰 수 — 후반에 화면이 터지도록 지수적으로.
    // 상수항이 곧 "첫 30초의 밀도"다. 여기가 낮으면 시작이 허전해서 첫인상을 잃는다.
    const rate = 24 + progress * progress * 430 + progress * 95
    this.spawnTimer += dt * rate

    // 후반 체력 배율. 3.4 로는 봇 완주율이 83% 였다 — 5분 버티기가 아니라 5분 산책이다.
    const hpScale = 1 + progress * progress * 7.5 + progress * 1.5
    const rand = this.randFn

    while (this.spawnTimer >= 1) {
      this.spawnTimer -= 1
      if (this.foes.count >= MAX_FOES - 32) break

      const roll = this.rng.next()
      let type: FoeType = Foe.Mote
      if (progress > 0.62 && roll > 0.985) type = Foe.Eye
      else if (progress > 0.2 && roll > 0.9) type = Foe.Hex
      else if (progress > 0.1 && roll > 0.72) type = Foe.Wisp
      else if (progress > 0.05 && roll > 0.52) type = Foe.Husk

      // 화면 가장자리 바로 밖에서 나타나게. 더 멀면 걸어오는 데만 10초가 걸려
      // 초반이 텅 비고, 더 가까우면 눈앞에 튀어나와 불공정하다.
      if (type === Foe.Mote) {
        // 잔챙이는 무리로 — 이게 "군체"의 그림을 만든다
        const size = 5 + this.rng.int(6)
        this.spawnTimer -= size - 1 // 무리 하나가 예산 size 만큼을 쓴다
        spawnCluster(
          this.foes, type, this.player.x, this.player.y,
          620, 880, hpScale, size, 66, rand, WORLD_R,
        )
      } else {
        spawnRing(
          this.foes, type, this.player.x, this.player.y,
          620, 900, hpScale, rand, WORLD_R,
        )
      }
    }
  }

  /**
   * 성능 측정용 강제 스폰. headless(SwiftShader)로는 실성능을 잴 수 없어
   * 실기기에서 ?bench=10000 으로 열어 확인한다.
   */
  benchSpawn(n: number): void {
    for (let k = 0; k < n; k++) {
      if (this.foes.count >= MAX_FOES) break
      const type = (k % 5) as FoeType
      spawnRing(
        this.foes, type, this.player.x, this.player.y,
        120, WORLD_R * 0.92, 8, this.randFn, WORLD_R,
      )
    }
  }

  // ── 공격 ─────────────────────────────────────────────────────────────

  private tickWeapons(dt: number): void {
    const list = this.loadout.weapons
    for (let i = 0; i < list.length; i++) tickWeapon(list[i]!, this, dt)
  }

  // ── FireCtx 구현 — 무기 코드가 게임에 요구하는 최소한 ──────────────

  nearestFoe(x: number, y: number, maxDist: number): number {
    const n = this.hash.query(x, y, maxDist, this.queryBuf)
    let best = -1
    let bestD = maxDist * maxDist
    for (let k = 0; k < n; k++) {
      const j = this.queryBuf[k]!
      if (this.foes.alive[j] === 0) continue
      const dx = this.foes.x[j]! - x
      const dy = this.foes.y[j]! - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD) {
        bestD = d2
        best = j
      }
    }
    return best
  }

  /** 격자 질의는 셀 단위라 반경 밖도 딸려 온다. 여기서 실제 거리까지 걸러 준다. */
  foesInRadius(x: number, y: number, r: number, out: Int32Array): number {
    const n = this.hash.query(x, y, r, this.queryBuf)
    let m = 0
    const cap = out.length
    for (let k = 0; k < n && m < cap; k++) {
      const j = this.queryBuf[k]!
      if (this.foes.alive[j] === 0) continue
      const dx = this.foes.x[j]! - x
      const dy = this.foes.y[j]! - y
      const rr = r + FOE_STATS[this.foes.type[j]!]!.radius
      if (dx * dx + dy * dy > rr * rr) continue
      out[m++] = j
    }
    return m
  }

  shake(amount: number, decay = 9): void {
    this.camera.shake(amount, decay)
  }

  private updateShots(dt: number): void {
    const shots = this.shots
    const foes = this.foes
    const high = shots.high

    for (let i = 0; i < high; i++) {
      if (shots.alive[i] === 0) continue
      const life = shots.life[i]! - dt
      if (life <= 0) {
        shots.kill(i)
        continue
      }
      shots.life[i] = life

      const x = shots.x[i]! + shots.vx[i]! * dt
      const y = shots.y[i]! + shots.vy[i]! * dt
      shots.x[i] = x
      shots.y[i] = y

      // 지형: 내 공격도 벽을 판다. 엄폐물은 나에게도 벽이라는 뜻이고,
      // 그래서 "여길 뚫을까 돌아갈까"가 선택이 된다.
      if (this.terrain.solidAt(x, y)) {
        const broke = this.terrain.damageAt(x, y, shots.damage[i]! * 1.6, this.elapsed)
        smoke(this.motes, x, y, broke ? 5 : 2, 1.5, 1.1, 0.85, broke ? 12 : 7)
        if (broke) this.camera.shake(1.6, 20)
        shots.kill(i)
        continue
      }

      // 명중 판정 — 이 탄이 이번에 때린 적을 표시하는 스탬프
      const stamp = ++this.hitStamp
      const r = shots.radius[i]!
      const n = this.hash.query(x, y, r + 30, this.queryBuf)
      for (let k = 0; k < n; k++) {
        const j = this.queryBuf[k]!
        if (foes.alive[j] === 0) continue
        if (this.foeStamp[j] === stamp) continue
        const stat = FOE_STATS[foes.type[j]!]!
        const dx = foes.x[j]! - x
        const dy = foes.y[j]! - y
        const rr = r + stat.radius
        if (dx * dx + dy * dy > rr * rr) continue

        this.foeStamp[j] = stamp
        this.damageFoe(j, shots.damage[i]!, shots.vx[i]!, shots.vy[i]!)

        const w = shots.weapon[i]!
        if (isEvolvedShot(w) && (w & 127) === W.Ember) {
          this.ignite(j, shots.damage[i]! * 0.42)
        }

        if (shots.pierce[i]! <= 0) {
          spray(this.motes, x, y, -shots.vx[i]!, -shots.vy[i]!, 1.6, 4, 2.4, 1.7, 0.6, 190, 0.22, 3)
          shots.kill(i)
          break
        }
        shots.pierce[i]!--
      }
    }
  }

  /**
   * 장작불(불씨 진화): 붙이고, 옆으로 옮긴다.
   * 이미 타는 적은 건너뛴다 — 안 그러면 두 적이 서로 계속 불을 옮겨 영원히 탄다.
   */
  private ignite(j: number, dps: number): void {
    const foes = this.foes
    if (foes.burn[j]! < 2.4) foes.burn[j] = 2.4
    if (foes.burnDps[j]! < dps) foes.burnDps[j] = dps

    const n = this.foesInRadius(foes.x[j]!, foes.y[j]!, 62, this.spreadBuf)
    for (let k = 0; k < n; k++) {
      const m = this.spreadBuf[k]!
      if (m === j || foes.burn[m]! > 0) continue
      if (this.rng.next() < 0.32) {
        foes.burn[m] = 1.7
        foes.burnDps[m] = dps * 0.55
      }
    }
  }

  /** 피해 적용 + 죽으면 보상·연출. 무기 코드가 공유하는 유일한 입구. */
  damageFoe(j: number, damage: number, fromVx: number, fromVy: number): void {
    const foes = this.foes
    const s = this.player.stats
    let dmg = damage
    if (this.rng.next() < s.critChance) dmg *= s.critMult

    foes.hp[j]! -= dmg
    foes.flash[j] = 0.09
    this.player.damageDealt += dmg
    this.sfx('hit')

    // 넉백 — 무게가 무거울수록 덜 밀린다
    const stat = FOE_STATS[foes.type[j]!]!
    const kb = 240 * s.knockback * stat.weight
    const len = Math.hypot(fromVx, fromVy) || 1
    foes.pushX[j]! += (fromVx / len) * kb
    foes.pushY[j]! += (fromVy / len) * kb

    if (foes.hp[j]! <= 0) this.killFoe(j)
  }

  private killFoe(j: number): void {
    const foes = this.foes
    const stat = FOE_STATS[foes.type[j]!]!
    const x = foes.x[j]!
    const y = foes.y[j]!

    // 화면에 2만 마리가 죽는 후반에 파티클을 그대로 뿌리면 풀이 순식간에 마른다.
    // 큰 적일수록 많이, 잔챙이는 적게.
    const big = stat.radius > 16
    const n = big ? 14 : 5
    burst(this.motes, x, y, n, stat.r, stat.g, stat.b, 210, 0.34, 4)
    if (big) shockwave(this.motes, x, y, stat.radius * 2.2, stat.r, stat.g, stat.b, 0.3)
    this.sfx(big ? 'bigKill' : 'kill')

    this.drops.spawn(
      x, y,
      (this.rng.next() - 0.5) * 60, (this.rng.next() - 0.5) * 60,
      stat.xp, Drop.Xp,
    )
    // 회복은 드물어야 긴장이 산다
    if (this.rng.next() < 0.006) this.drops.spawn(x, y, 0, 0, 22, Drop.Heal)

    foes.kill(j)
    this.player.kills++
  }

  // ── 드랍 ─────────────────────────────────────────────────────────────

  private updateDrops(dt: number): void {
    const drops = this.drops
    const p = this.player
    const magnet = p.stats.magnet
    const magnet2 = magnet * magnet
    const pickup2 = (p.radius + 12) * (p.radius + 12)
    let leveled = 0

    for (let i = 0; i < drops.high; i++) {
      if (drops.alive[i] === 0) continue
      drops.age[i]! += dt

      const dx = p.x - drops.x[i]!
      const dy = p.y - drops.y[i]!
      const d2 = dx * dx + dy * dy

      if (drops.pulled[i] === 0 && d2 < magnet2) drops.pulled[i] = 1

      if (drops.pulled[i] === 1) {
        // 가까울수록 빨라진다 — 빨려 들어가는 손맛
        const d = Math.sqrt(d2) || 1
        const pull = 340 + (1 - Math.min(1, d / magnet)) * 900
        drops.vx[i]! += (dx / d) * pull * dt
        drops.vy[i]! += (dy / d) * pull * dt
      }

      const drag = Math.exp(-3.4 * dt)
      drops.vx[i]! *= drag
      drops.vy[i]! *= drag
      drops.x[i]! += drops.vx[i]! * dt
      drops.y[i]! += drops.vy[i]! * dt

      if (d2 < pickup2) {
        const type = drops.type[i]!
        if (type === Drop.Xp) {
          leveled += p.gainXp(drops.value[i]!)
          this.sfx('pickup')
        } else if (type === Drop.Heal) {
          p.heal(drops.value[i]!)
          shockwave(this.motes, p.x, p.y, 40, 0.4, 2.4, 1.0, 0.35)
        }
        drops.kill(i)
      }
    }

    if (leveled > 0) {
      this.pendingLevels += leveled
      this.phase = Phase.LevelUp
      this.pendingChoices = this.loadout.roll(this.rng)
      shockwave(this.motes, p.x, p.y, 70, 2.6, 2.2, 0.8, 0.5)
      burst(this.motes, p.x, p.y, 26, 2.6, 2.1, 0.7, 300, 0.7, 6, Shape.Star)
      this.camera.shake(5, 14)
      this.sfx('levelup')
    }
  }

  private onDeath(): void {
    this.phase = Phase.Dead
    this.sfx('death')
    burst(this.motes, this.player.x, this.player.y, 90, 2.6, 0.5, 0.3, 420, 1.2, 9)
    shockwave(this.motes, this.player.x, this.player.y, 180, 2.6, 0.4, 0.3, 0.9)
    this.camera.shake(26, 5)
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────

  render(renderer: Renderer): void {
    const cam = this.camera
    const view = cam.toView(renderer.width, renderer.height)
    renderer.begin(view)

    const b = renderer.batch
    const t = this.visualTime
    const cullR = cam.visibleRadius(renderer.width, renderer.height)
    const cullR2 = cullR * cullR
    const cx = cam.x
    const cy = cam.y

    // 지형 — 화면에 걸치는 셀만. 격자 전체(130x130)를 매 프레임 돌 이유가 없다.
    const ter = this.terrain
    const tx0 = ter.cellX(cx - cullR)
    const tx1 = ter.cellX(cx + cullR)
    const ty0 = ter.cellY(cy - cullR)
    const ty1 = ter.cellY(cy + cullR)
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let txi = tx0; txi <= tx1; txi++) {
        if (!ter.inBounds(txi, ty)) continue
        const ci = ty * ter.cols + txi
        const hp = ter.hp[ci]!
        if (hp <= 0) continue
        const wx = ter.originX + txi * CELL + CELL * 0.5
        const wy = ter.originY + ty * CELL + CELL * 0.5
        const frac = hp / ter.maxHp[ci]!
        // 닳으면 어두워지고 갈라진다 — 얼마나 버틸지 눈으로 보여야 한다
        const recent = this.elapsed - ter.flash[ci]!
        const lit = recent < 0.12 ? 1.9 : 1
        const v = 0.1 + frac * 0.24
        const tint = ter.tint[ci]!
        // 속을 채우고 테두리를 얹는다. 속 빈 육각만 그리면 벌집처럼 보여서
        // "벽"이 아니라 "뚫린 곳"으로 읽힌다.
        b.push(wx, wy, CELL * 0.74, 0, v * 0.3 * lit, v * 0.26 * lit, v * 0.5 * lit, 1, Shape.Hex)
        b.push(
          wx, wy, CELL * 0.6, 0,
          (v + tint * 0.05) * lit, (v * 0.92) * lit, (v * 1.5 + 0.06) * lit, 1,
          frac < 0.45 ? Shape.Crack : Shape.Hex,
        )
      }
    }

    // 월드 경계 — 벽처럼 보여야 한다.
    // 원 전체를 균등 분할하면 반경 2600에서 조각 간격이 170px 라 점선이 된다.
    // 카메라 쪽 호(arc)만 촘촘히 그린다.
    const camDist = Math.hypot(cx, cy)
    if (camDist + cullR > WORLD_R * 0.94) {
      const camAngle = Math.atan2(cy, cx)
      const span = Math.asin(Math.min(1, cullR / WORLD_R)) * 1.5 + 0.06
      const steps = 72
      for (let k = 0; k <= steps; k++) {
        const a = camAngle - span + (k / steps) * span * 2
        const x = Math.cos(a) * WORLD_R
        const y = Math.sin(a) * WORLD_R
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy > cullR2 * 1.5) continue
        const pulse = 0.75 + Math.sin(t * 2.4 + a * 9) * 0.3
        b.push(x, y, 34, a, 1.5 * pulse, 0.3 * pulse, 0.5 * pulse, 1, Shape.Orb)
      }
    }

    // 드랍
    const drops = this.drops
    for (let i = 0; i < drops.high; i++) {
      if (drops.alive[i] === 0) continue
      const x = drops.x[i]!
      const y = drops.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue
      const type = drops.type[i]!
      const bob = 1 + Math.sin(t * 7 + drops.age[i]! * 4) * 0.16
      if (type === Drop.Xp) {
        b.push(x, y, 7.5 * bob, t * 2, 0.5, 2.3, 2.8, 1, Shape.Orb)
      } else if (type === Drop.Heal) {
        b.push(x, y, 12 * bob, t * 1.4, 0.5, 2.8, 1.2, 1, Shape.Star)
      }
    }

    // 적
    const foes = this.foes
    for (let i = 0; i < foes.high; i++) {
      if (foes.alive[i] === 0) continue
      const x = foes.x[i]!
      const y = foes.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue

      const stat = FOE_STATS[foes.type[i]!]!
      const flash = foes.flash[i]!
      // 맞은 순간 하얗게 뜬다. 이거 하나로 타격감이 산다.
      const hit = flash > 0 ? 1 + flash * 26 : 1
      const hpFrac = foes.hp[i]! / foes.maxHp[i]!
      // 피가 닳으면 어두워진다 — 체력바 없이 상태를 읽게
      const dim = 0.45 + hpFrac * 0.55
      // 불타는 적은 주황으로 물든다. 장작불 빌드가 화면에 보여야 재미가 있다.
      const fire = foes.burn[i]! > 0 ? 1 : 0
      b.push(
        x, y, stat.radius, foeRotation(foes, i, t),
        (stat.r + fire * 1.7) * hit * dim,
        (stat.g + fire * 0.55) * hit * dim,
        (stat.b * (1 - fire * 0.55)) * hit * dim,
        1,
        stat.shape,
      )
    }

    // 탄
    const shots = this.shots
    for (let i = 0; i < shots.high; i++) {
      if (shots.alive[i] === 0) continue
      const x = shots.x[i]!
      const y = shots.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue
      const rot = Math.atan2(shots.vy[i]!, shots.vx[i]!)
      // 무기 색을 인라인으로 푼다. shotColor() 를 부르면 탄마다 배열이 하나씩 생긴다.
      const w = shots.weapon[i]!
      const def = WEAPONS[w & 127]!
      const evo = w >= 128
      const cr = evo ? def.r * 1.3 + 0.5 : def.r
      const cg = evo ? def.g * 0.9 : def.g
      const cb = evo ? def.b * 0.75 : def.b
      const rad = shots.radius[i]!
      b.push(x, y, rad * 2.5, rot, cr * 0.8, cg * 0.8, cb * 0.8, 1, Shape.Spark)
      b.push(x, y, rad, rot, cr + 0.6, cg + 0.6, cb + 0.6, 1, Shape.Orb)
    }

    // 파티클
    const motes = this.motes
    for (let i = 0; i < motes.high; i++) {
      if (motes.alive[i] === 0) continue
      const x = motes.x[i]!
      const y = motes.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue
      const frac = motes.life[i]! / motes.maxLife[i]!
      const shape = motes.shape[i]!
      // 링은 커지며 사라지고, 나머지는 작아지며 사라진다
      const size = shape === Shape.Ring ? motes.size[i]! * (2 - frac) : motes.size[i]! * frac
      b.push(
        x, y, size, motes.rot[i]!,
        motes.r[i]! * frac, motes.g[i]! * frac, motes.b[i]! * frac, frac,
        shape,
      )
    }

    // 플레이어 — 마지막에 그려서 무슨 일이 있어도 자기 캐릭터는 보이게
    const p = this.player
    if (p.alive) {
      const inv = p.invuln > 0 ? 0.45 + Math.sin(t * 40) * 0.3 : 1
      b.push(p.x, p.y, 30, -t * 0.9, 0.9 * inv, 1.5 * inv, 2.8 * inv, 1, Shape.Ring)
      b.push(p.x, p.y, 15, t * 2.2, 2.6 * inv, 2.2 * inv, 3.4 * inv, 1, Shape.Orb)
    }

    renderer.end(t, p.hurtFlash)
  }
}
