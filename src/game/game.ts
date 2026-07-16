/**
 * 게임 루프 통합.
 *
 * 고정 타임스텝으로 시뮬레이션을 돌린다. 가변 dt 를 쓰면 프레임률에 따라
 * 밸런스가 달라지고, 협동에서 두 대의 결과가 갈린다.
 */
import {
  ACT_INTRO_SECONDS, ACT_SECONDS, ACTS, BOSS_AT, RUN_SECONDS, actIndexAt, actProgressAt,
  type ActDef,
} from './acts'
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
import { Drop, Drops, Fields, Foe, Foes, Motes, Shots, type FoeType } from './pools'
import {
  echoKill, Field, isEvolvedShot, STARTER_WEAPONS, tickWeapon, W, WEAPONS, type FireCtx,
} from './weapons'

export const WORLD_R = 2600
export { RUN_SECONDS } from './acts'

const MAX_FOES = 20000
const MAX_SHOTS = 4000
const MAX_MOTES = 24000
const MAX_DROPS = 3000
const MAX_FIELDS = 512

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

/** Field 종류 → 그걸 만든 무기. 진화 여부를 되찾을 때 쓴다. */
const FIELD_OWNER: readonly number[] = [W.Well, W.Sigil, W.Still, W.Echo]

export class Game implements FireCtx {
  readonly player = new Player()
  readonly foes = new Foes(MAX_FOES)
  readonly shots = new Shots(MAX_SHOTS)
  readonly motes = new Motes(MAX_MOTES)
  readonly drops = new Drops(MAX_DROPS)
  readonly fields = new Fields(MAX_FIELDS)
  readonly camera = new Camera()
  readonly loadout = new Loadout()
  readonly hash = new SpatialHash(-WORLD_R, -WORLD_R, WORLD_R * 2, WORLD_R * 2, 52, MAX_FOES)
  readonly terrain = new Terrain(WORLD_R)

  rng = new Rng(1)
  private acc = 0
  private spawnTimer = 0
  /**
   * "이 탄이 이 적을 이미 때렸다"는 표시. 값은 탄의 고유 stamp(Shots 가 발급).
   *
   * 예전엔 스텝마다 새 stamp 를 발급했는데, 그러면 스텝 간 재타격을 전혀 막지 못한다.
   * 탄 속도 640px/s = 스텝당 10.7px 이고 Eye 반경이 27이라, 관통탄 하나가 같은 적을
   * 7스텝 연속으로 때려서 pierce 를 혼자 다 소진했다 — "관통"이 "단일 대상 3연타"로
   * 동작하고 있었다.
   */
  private readonly foeStamp = new Int32Array(MAX_FOES)
  /**
   * 공간 질의 스크래치. 크기가 곧 사거리 상한이다 —
   * SpatialHash.query 는 cap 에 닿으면 **말없이** 자르고, 셀을 좌하단부터 훑으므로
   * 잘리는 쪽은 항상 우상단이다. 512 였을 때 신성(개화 8레벨 → 반경 598, 576셀)이
   * 화면엔 거대한 링을 그리면서 실제로는 왼쪽 아래 적만 때렸다.
   */
  private readonly queryBuf = new Int32Array(4096)
  /** 한 스텝에 화상으로 죽는 적을 담는 버퍼 */
  private readonly deadBuf = new Int32Array(2048)
  /** 불이 옮겨붙을 후보. queryBuf 와 반드시 별개여야 한다 (ignite 주석 참고). */
  private readonly spreadBuf = new Int32Array(256)
  /**
   * 폭발 대상. spreadBuf 와 별개여야 한다 — 필드가 spreadBuf 로 순회하는 중에
   * explode 를 부르고, explode 가 죽인 적이 반향을 낳아 또 필드를 만든다.
   */
  private readonly blastBuf = new Int32Array(2048)
  /** 필드 순회 전용. 필드가 explode 를 부르고 explode 가 또 필드를 만드므로 격리한다. */
  private readonly fieldBuf = new Int32Array(2048)
  /** 스폰 함수에 넘길 난수원. 매 스폰마다 클로저를 새로 만들지 않으려고 붙잡아 둔다. */
  private readonly randFn = (): number => this.rng.next()
  /** 지형 충돌 결과를 받는 스크래치 */
  private readonly hit2 = new Float32Array(2)
  /**
   * 반향 연쇄 깊이. 반향이 죽인 적이 또 반향을 낳으므로 상한이 없으면
   * 후반 초당 수백 킬에서 무한 연쇄가 되어 프레임이 죽는다.
   */
  private echoDepth = 0
  /** 현재 막 (0-based) */
  act = 0
  /** 막 전환 연출 남은 시간 */
  actIntro = 0
  /** 이번 막 보스가 이미 나왔는가 */
  private bossSpawned = false
  /** 보스 엔티티 인덱스 (-1 = 없음). HUD 체력바가 읽는다. */
  bossIdx = -1
  bossMaxHp = 0

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
    this.fields.clear()
    this.foeStamp.fill(0)
    this.acc = 0
    this.spawnTimer = 0
    this.elapsed = 0
    this.phase = Phase.Playing
    this.pendingChoices = []
    this.pendingLevels = 0
    this.act = 0
    this.actIntro = ACT_INTRO_SECONDS
    this.bossSpawned = false
    this.bossIdx = -1
    this.echoDepth = 0
    // 지형은 시드에서 나온다. 같은 시드 = 같은 맵.
    this.terrain.generate(seed, WORLD_R, 1)
    // 시작 무기는 시드로 정한다 — 매판 다른 빌드로 출발한다.
    // 스스로 죽일 수 있는 무기만 (반향·정지로 시작하면 영원히 0킬이다)
    this.loadout.reset(STARTER_WEAPONS[this.rng.int(STARTER_WEAPONS.length)]!)
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
      this.pendingChoices = this.loadout.roll(this.rng, 3, this.player.stats.awaken)
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
      // **phase 가 바뀌면 즉시 멈춘다.** 이게 없으면 프레임률이 시뮬레이션을 바꾼다:
      // 한 프레임이 33ms 를 넘으면 2스텝을 도는데, 서브스텝 1에서 레벨업이 떠도
      // 서브스텝 2가 그대로 더 돌면서 rng 를 더 먹는다(사격 seed·크리 판정·스폰).
      // 결과: 같은 데일리 시드인데 30fps 와 144fps 에게 다른 선택지가 뜬다.
      // 144Hz 는 프레임당 1스텝이라 절대 초과하지 않고 30Hz 는 매 프레임 초과하므로,
      // 시드별 최고 기록이 프레임률 경쟁이 된다. 죽음/승리도 5번 중복 실행됐다.
      //
      // acc 는 **버리지 않는다**. 여기서 0으로 밀면 2스텝 프레임만 남은 시간을 잃어
      // 총 스텝 수가 또 프레임률에 종속된다. 남겨 두면 레벨업을 고른 뒤 다음
      // 프레임이 그만큼 더 돌아 결국 같은 스텝 수로 수렴한다.
      if (this.phase !== Phase.Playing) break
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
    this.updateFields(dt)
    this.updateShots(dt)
    this.updateDrops(dt)
    updateMotes(this.motes, dt)
    this.spawn(dt)

    this.tickActs(dt)

    if (this.elapsed >= RUN_SECONDS) {
      this.phase = Phase.Won
      this.sfx('win')
    }
  }

  // ── 스폰 ─────────────────────────────────────────────────────────────

  /**
   * 15분 곡선. 막마다 성격이 다르고, 막 안에서도 갈수록 조여든다.
   * 규칙은 전부 acts.ts 데이터에 있다 — 밸런싱이 코드 수정이 되면 안 된다.
   */
  private spawn(dt: number): void {
    const act = ACTS[this.act]!
    const inAct = actProgressAt(this.elapsed)
    const overall = this.elapsed / RUN_SECONDS

    // 초당 스폰 예산. 막 배율 × (막 안 진행에 따른 조임) × (런 전체 가속)
    const rate = (18 + inAct * 46) * act.rate * (1 + overall * 1.4)
    this.spawnTimer += dt * rate

    // 체력: 막 배율에 막 안 진행분을 얹는다
    const hpScale = act.hp * (1 + inAct * 0.55)
    const rand = this.randFn

    while (this.spawnTimer >= 1) {
      this.spawnTimer -= 1
      if (this.foes.count >= MAX_FOES - 32) break

      const type = this.rollFoeType(act)

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
   * 막 진행. 전환·보스 소환을 여기서 본다.
   * 성운 색 전이는 렌더 쪽(순수 연출)이라 여기선 상태만 바꾼다.
   */
  private tickActs(dt: number): void {
    if (this.actIntro > 0) this.actIntro = Math.max(0, this.actIntro - dt)

    const nowAct = actIndexAt(this.elapsed)
    if (nowAct !== this.act) {
      this.act = nowAct
      this.actIntro = ACT_INTRO_SECONDS
      this.bossSpawned = false
      this.bossIdx = -1
      // 막이 바뀌는 순간이 곧 이정표다 — 화면과 소리가 같이 알려야 한다
      shockwave(this.motes, this.player.x, this.player.y, 420, 2.4, 2.0, 0.9, 1.4)
      this.camera.shake(10, 5)
      this.sfx('levelup')
    }

    // 막 끝 보스. 남은 20초는 잡고 정리할 여유다.
    if (!this.bossSpawned && actProgressAt(this.elapsed) * ACT_SECONDS >= BOSS_AT) {
      this.bossSpawned = true
      this.spawnBoss()
    }

    // 보스가 죽었으면 표시를 지운다
    if (this.bossIdx >= 0 && this.foes.alive[this.bossIdx] === 0) this.bossIdx = -1
  }

  /** 막의 가중치 표에서 종족 하나. */
  private rollFoeType(act: ActDef): FoeType {
    let total = 0
    for (const e of act.weights) total += e.w
    let r = this.rng.next() * total
    for (const e of act.weights) {
      r -= e.w
      if (r < 0) return e.type
    }
    return Foe.Mote
  }

  /**
   * 막 끝 보스. 잔챙이만 15분이면 지루하다 — 막마다 "이번 고비"가 있어야 한다.
   * 보스는 같은 종족의 거대·고체력 개체다(별도 AI 를 만들면 hot loop 에 분기가 는다).
   */
  private spawnBoss(): void {
    const act = ACTS[this.act]!
    const hp = act.hp * 260 * (1 + this.act * 0.85)
    const i = spawnRing(
      this.foes, act.boss, this.player.x, this.player.y,
      700, 820, hp / (FOE_STATS[act.boss]!.hp || 1), this.randFn, WORLD_R,
    )
    if (i < 0) return
    this.bossIdx = i
    this.bossMaxHp = this.foes.hp[i]!
    // 보스는 화면에서 즉시 구분돼야 한다
    shockwave(this.motes, this.foes.x[i]!, this.foes.y[i]!, 260, 2.8, 0.4, 0.6, 1.2)
    burst(this.motes, this.foes.x[i]!, this.foes.y[i]!, 50, 2.8, 0.5, 0.7, 400, 1.0, 10, Shape.Crown)
    this.camera.shake(18, 6)
    this.sfx('evolve')
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

  placeField(kind: number, x: number, y: number, radius: number, power: number, life: number): void {
    const slot = this.loadout.weapons.find((w) => FIELD_OWNER[kind] === w.def)
    this.fields.spawn(kind, x, y, radius, power, life, slot?.evolved ?? false, this.rng.next())
  }

  pushFoes(x: number, y: number, radius: number, force: number): void {
    const n = this.foesInRadius(x, y, radius, this.blastBuf)
    for (let k = 0; k < n; k++) {
      const j = this.blastBuf[k]!
      if (this.foes.alive[j] === 0) continue
      const dx = this.foes.x[j]! - x
      const dy = this.foes.y[j]! - y
      const d = Math.hypot(dx, dy) || 1
      const stat = FOE_STATS[this.foes.type[j]!]!
      // 거리에 반비례 — 우물 가까이가 제일 세다
      const f = force * (1 - d / radius) * stat.weight
      this.foes.pushX[j]! += (dx / d) * f
      this.foes.pushY[j]! += (dy / d) * f
    }
  }

  breakTerrain(x: number, y: number, radius: number, power: number): void {
    const t = this.terrain
    const cx0 = t.cellX(x - radius)
    const cx1 = t.cellX(x + radius)
    const cy0 = t.cellY(y - radius)
    const cy1 = t.cellY(y + radius)
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!t.inBounds(cx, cy)) continue
        const wx = t.originX + cx * CELL + CELL * 0.5
        const wy = t.originY + cy * CELL + CELL * 0.5
        const dx = wx - x
        const dy = wy - y
        if (dx * dx + dy * dy > radius * radius) continue
        if (t.damageCell(cx, cy, power, this.elapsed)) {
          smoke(this.motes, wx, wy, 3, 1.5, 1.1, 0.85, 10)
        }
      }
    }
  }

  // ── 지속 효과체 ──────────────────────────────────────────────────────

  /**
   * 중력정·신문·정지장·반향 한 틱.
   * 필드는 512개 상한이라 이 루프 자체는 싸다 — 비싼 건 각 필드의 반경 질의다.
   */
  private updateFields(dt: number): void {
    const f = this.fields
    for (let i = 0; i < f.high; i++) {
      if (f.alive[i] === 0) continue
      const life = f.life[i]! - dt
      const x = f.x[i]!
      const y = f.y[i]!
      const r = f.radius[i]!
      const power = f.power[i]!
      const evolved = f.evolved[i] === 1
      const kind = f.kind[i]!

      if (life <= 0) {
        f.life[i] = 0
        // 사라질 때 터지는 것들
        if (kind === Field.Well && evolved) {
          // 특이점 붕괴 — 삼킨 만큼 아프다
          const blast = power * (2.5 + f.charge[i]! * 0.02)
          this.explode(x, y, r * 1.5, blast, 1.6, 0.35, 2.9)
          this.sfx('bigKill')
          this.camera.shake(16, 8)
        } else if (kind === Field.Echo) {
          this.explode(x, y, r, power, 0.6, 2.0, 2.6)
        }
        f.kill(i)
        continue
      }
      f.life[i] = life

      switch (kind) {
        case Field.Well: {
          // 끌어당기고 갉는다
          this.pushFoes(x, y, r, -520 * dt * 60)
          const n = this.foesInRadius(x, y, r, this.fieldBuf)
          for (let k = 0; k < n; k++) {
            const j = this.fieldBuf[k]!
            if (this.foes.alive[j] === 0) continue
            this.damageFoe(j, power * dt, 0, 0)
            f.charge[i]! += dt
          }
          break
        }
        case Field.Sigil: {
          // 밟으면 터진다 — 적이 하나라도 안에 들어오면 발동
          const n = this.foesInRadius(x, y, r * 0.6, this.fieldBuf)
          if (n > 0) {
            this.explode(x, y, r, power, 2.2, 1.9, 0.4)
            this.sfx('kill')
            f.kill(i)
          }
          break
        }
        case Field.Still: {
          // 시간을 늦춘다. Foes.slow 를 되살리는 자리 —
          // 적대 리뷰가 "영원히 1인 상수"라고 지적했던 그 필드다.
          const n = this.foesInRadius(x, y, r, this.fieldBuf)
          for (let k = 0; k < n; k++) {
            const j = this.fieldBuf[k]!
            if (this.foes.alive[j] === 0) continue
            this.foes.slow[j] = evolved ? 0.12 : 0.3
            // 영겁: 멈춘 것은 더 아프게 부서진다
            if (evolved) this.foes.frail[j] = power
          }
          break
        }
      }
    }
  }

  /**
   * 반경 폭발 — 여러 무기가 공유하는 입구.
   *
   * 여기서 죽은 적이 반향을 낳고 그 반향이 또 explode 를 부른다(재귀).
   * echoDepth 를 올려 두지 않으면 echoKill 의 상한이 무의미해진다 —
   * 필드 순회 중 spreadBuf 를 재사용하는 것도 이 재귀 때문에 위험하므로
   * 인덱스를 먼저 복사한 뒤 때린다.
   */
  private explode(
    x: number, y: number, radius: number, damage: number,
    cr: number, cg: number, cb: number,
  ): void {
    const n = this.foesInRadius(x, y, radius, this.blastBuf)
    this.echoDepth++
    for (let k = 0; k < n; k++) {
      const j = this.blastBuf[k]!
      if (this.foes.alive[j] === 0) continue
      const dx = this.foes.x[j]! - x
      const dy = this.foes.y[j]! - y
      const d = Math.hypot(dx, dy) || 1
      this.damageFoe(j, damage, dx / d, dy / d)
    }
    this.echoDepth--
    shockwave(this.motes, x, y, radius, cr, cg, cb, 0.4)
    burst(this.motes, x, y, 10, cr, cg, cb, radius * 2.4, 0.4, 5)
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

      const w = shots.weapon[i]!
      const isComet = (w & 127) === W.Comet

      // 지형: 내 공격도 벽을 판다. 엄폐물은 나에게도 벽이라는 뜻이고,
      // 그래서 "여길 뚫을까 돌아갈까"가 선택이 된다.
      // 혜성만 예외 — 무거운 것은 벽을 뚫고 지나간다(그게 이 무기의 정체성이다).
      if (this.terrain.solidAt(x, y)) {
        if (isComet) {
          this.breakTerrain(x, y, shots.radius[i]! * 1.6, 40)
        } else {
          const broke = this.terrain.damageAt(x, y, shots.damage[i]! * 1.6, this.elapsed)
          smoke(this.motes, x, y, broke ? 5 : 2, 1.5, 1.1, 0.85, broke ? 12 : 7)
          if (broke) this.camera.shake(1.6, 20)
          shots.kill(i)
          continue
        }
      }

      // 명중 판정 — stamp 는 탄이 태어날 때 받은 고유값이다.
      // 스텝마다 새로 발급하면 스텝 간 재타격을 못 막는다.
      const stamp = shots.stamp[i]!
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

        if (isEvolvedShot(w) && (w & 127) === W.Ember) {
          this.ignite(j, shots.damage[i]! * 0.42)
        }

        // 혜성은 명중하면 터진다 — 관통이 99라 죽지 않으므로 여기서 끝낸다
        if (isComet) {
          const s2 = this.player.stats
          const br = shots.radius[i]! * 5.5 * s2.blast
          this.explode(x, y, br, shots.damage[i]! * 1.4, 2.6, 1.3, 0.5)
          this.breakTerrain(x, y, br * 0.6, 60)
          this.camera.shake(9, 10)
          this.sfx('bigKill')
          shots.kill(i)
          break
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

    // **foesInRadius 를 쓰면 안 된다.** 그건 this.queryBuf 를 스크래치로 쓰는데,
    // 이 함수는 updateShots 가 바로 그 queryBuf 를 순회하는 도중에 불린다.
    // 덮어쓰면 관통탄의 남은 명중 후보가 조용히 사라져서, 진화 불씨의 관통이
    // 무작위로 절반쯤 먹통이 된다. 자기 버퍼로 직접 훑는다.
    const fx = foes.x[j]!
    const fy = foes.y[j]!
    const R = 62
    const n = this.hash.query(fx, fy, R, this.spreadBuf)
    for (let k = 0; k < n; k++) {
      const m = this.spreadBuf[k]!
      if (m === j || foes.alive[m] === 0 || foes.burn[m]! > 0) continue
      const dx = foes.x[m]! - fx
      const dy = foes.y[m]! - fy
      if (dx * dx + dy * dy > R * R) continue
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
    let dmg = damage * foes.frail[j]!
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
    // 반향 — 내가 부순 자리에서 소리가 되돌아온다
    const echo = this.loadout.findWeapon(W.Echo)
    if (echo) echoKill(echo, this, x, y, this.echoDepth)
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
      // 레벨 자체가 기초 스탯을 올린다 — 선택과 무관한 성장 축이라 여기서 재계산한다
      this.loadout.recomputeStats(p)
      this.pendingChoices = this.loadout.roll(this.rng, 3, p.stats.awaken)
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
    const t = this.visualTime

    // 성운 색은 막을 따라 서서히 옮겨간다. 갑자기 바뀌면 이질적이라
    // 3막쯤에서 "언제 이렇게 붉어졌지"가 되는 게 목표다.
    const act = ACTS[this.act]!
    renderer.cosmos.lerpTint(act.tintA, act.tintB, 0.02)
    renderer.cosmos.intensity = Math.min(1, this.elapsed / RUN_SECONDS + this.act * 0.05)

    renderer.begin(view, t)

    const b = renderer.batch
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

      const isBoss = i === this.bossIdx
      const stat = FOE_STATS[foes.type[i]!]!
      const flash = foes.flash[i]!
      // 맞은 순간 하얗게 뜬다. 이거 하나로 타격감이 산다.
      const hit = flash > 0 ? 1 + flash * 26 : 1
      const hpFrac = foes.hp[i]! / foes.maxHp[i]!
      // 피가 닳으면 어두워진다 — 체력바 없이 상태를 읽게
      const dim = 0.45 + hpFrac * 0.55
      // 불타는 적은 주황으로 물든다. 장작불 빌드가 화면에 보여야 재미가 있다.
      const fire = foes.burn[i]! > 0 ? 1 : 0
      const size = isBoss ? stat.radius * 3.4 : stat.radius
      b.push(
        x, y, size, foeRotation(foes, i, t),
        (stat.r + fire * 1.7) * hit * dim,
        (stat.g + fire * 0.55) * hit * dim,
        (stat.b * (1 - fire * 0.55)) * hit * dim,
        1,
        stat.shape,
      )
      // 보스는 화면에서 즉시 구분돼야 한다 — 왕관과 도는 광륜
      if (isBoss) {
        b.push(x, y, size * 1.5, t * 0.7, 2.6, 1.6, 0.5, 1, Shape.Halo)
        b.push(x, y + size * 1.3, size * 0.7, Math.sin(t * 2) * 0.12, 2.9, 2.2, 0.8, 1, Shape.Crown)
      }
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
      // 잔상은 공통, 본체는 무기가 정한 모양. WeaponDef.shape 를 아무도 안 읽어서
      // 무기 6종의 탄이 전부 똑같은 구슬이었다.
      b.push(x, y, rad * 2.5, rot, cr * 0.8, cg * 0.8, cb * 0.8, 1, Shape.Spark)
      b.push(x, y, rad * 1.25, rot, cr + 0.6, cg + 0.6, cb + 0.6, 1, def.shape)
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

    // 지속 효과체 — 적 위, 플레이어 아래
    const f = this.fields
    for (let i = 0; i < f.high; i++) {
      if (f.alive[i] === 0) continue
      const x = f.x[i]!
      const y = f.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue
      const r = f.radius[i]!
      const frac = f.life[i]! / f.maxLife[i]!
      const evo = f.evolved[i] === 1
      const seed = f.seed[i]!

      switch (f.kind[i]!) {
        case Field.Well: {
          // 특이점은 가운데가 비어 보여야 한다 — Singularity 모양이 그 일을 한다
          const spin = t * (evo ? 3.4 : 1.8) + seed * 6.283
          const pulse = 1 + Math.sin(t * 7 + seed * 10) * 0.06
          b.push(x, y, r * 0.55 * pulse, spin, 1.5, 0.5, 3.0, 1, Shape.Singularity)
          b.push(x, y, r * 0.95, -spin * 0.5, 0.7, 0.2, 1.5, 1, Shape.Vortex)
          if (evo) {
            // 삼킨 만큼 밝아진다 — 곧 터진다는 신호
            const charge = Math.min(1, f.charge[i]! * 0.02)
            b.push(x, y, r * 0.4 * (1 + charge), spin * 2, 2.8 * charge, 0.6 * charge, 3.4 * charge, 1, Shape.Nova)
          }
          break
        }
        case Field.Sigil: {
          // 문양은 바닥에 새겨진 것이라 옅어야 한다 — 밝게 그렸더니 화면 중앙이
          // 흰 링으로 덮여서 적이 안 보였다.
          const a = (0.2 + frac * 0.4) * 0.7
          b.push(x, y, r * 1.1, seed * 6.283 + t * 0.4, 1.5 * a, 1.3 * a, 0.35 * a, 1, Shape.Sigil)
          if (evo) b.push(x, y, r * 0.5, -t * 1.2, 1.7 * a, 1.4 * a, 0.4 * a, 1, Shape.Rune)
          break
        }
        case Field.Still: {
          // 정지장은 시간이 멎은 느낌이라 아주 천천히 돈다
          const a = 0.3 + frac * 0.5
          b.push(x, y, r * 1.05, t * 0.25 + seed, 0.5 * a, 1.4 * a, 2.9 * a, 1, Shape.Halo)
          b.push(x, y, r * 0.7, -t * 0.18, 0.3 * a, 0.9 * a, 2.2 * a, 1, Shape.Ring)
          break
        }
        case Field.Echo: {
          const grow = 2 - frac
          b.push(x, y, r * grow, seed * 6.283, 0.6 * frac, 2.0 * frac, 2.6 * frac, 1, Shape.Rift)
          break
        }
      }
    }

    // 플레이어 — 마지막에 그려서 무슨 일이 있어도 자기 캐릭터는 보이게.
    // 꺼져가는 별의 마지막 불씨: 씨앗 코어 + 도는 광륜.
    const p = this.player
    if (p.alive) {
      const inv = p.invuln > 0 ? 0.45 + Math.sin(t * 40) * 0.3 : 1
      b.push(p.x, p.y, 34, t * 0.5, 0.7 * inv, 1.2 * inv, 2.4 * inv, 1, Shape.Halo)
      b.push(p.x, p.y, 20, -t * 1.4, 2.9 * inv, 2.3 * inv, 3.4 * inv, 1, Shape.Seed)
    }

    renderer.end(t, p.hurtFlash)
  }
}
