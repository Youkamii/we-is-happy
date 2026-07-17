/**
 * 게임 루프 통합.
 *
 * 고정 타임스텝으로 시뮬레이션을 돌린다. 가변 dt 를 쓰면 프레임률에 따라
 * 밸런스가 달라지고, 협동에서 두 대의 결과가 갈린다.
 */
import {
  ACT_BEATS, ACT_INTRO_SECONDS, ACT_SECONDS, ACTS, BEATS, BOSS_AT, DISK_IN, DISK_OUT,
  FLOW_MAX, PACTS, RUN_SECONDS, actIndexAt, actProgressAt, diskBandAt, type ActDef,
} from './acts'
import type { SpriteBatch } from '../engine/batch'
import type { SfxName } from '../engine/audio'
import { Camera } from '../engine/camera'
import { SpatialHash } from '../engine/grid'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Rng } from '../engine/rng'
import {
  ACCENT, DROP_BASE, EVENT, FIELD_BASE, FOE_BASE, FX_BASE, PLAYER_BASE, SHAPE_SPARSE, SHOT_BASE,
  TERRAIN_BASE, conserve,
} from '../engine/palette'
import { Shape } from '../engine/shapes'
import { burst, shockwave, smoke, spray, updateMotes } from './fx'
import { drawHealthRing, drawOffscreenMarker, drawXpArc } from './hud3d'
import {
  AFFIX_COLORS, Affix, BOSS_SCALE, FOE_STATS, foeRotation, holeClampScale, spawnCluster,
  spawnFormation, spawnRing, updateFoes,
} from './foes'
import { Boss, BossState } from './boss'
import { Loadout, type Choice } from './loadout'
import { xpForLevel } from './player'
import { Player } from './player'
import { CELL, Terrain } from './terrain'
import { Drop, Drops, Fields, Foe, Foes, Motes, Shots, type FoeType } from './pools'
import {
  echoKill, Field, isEvolvedShot, STARTER_WEAPONS, tickWeapon, W, WEAPONS,
  type FireCtx, type WeaponSlot,
} from './weapons'

export const WORLD_R = 2600
export { RUN_SECONDS } from './acts'

// ── 블랙홀 ────────────────────────────────────────────────────────────────
// (밖에서 쓰는 건 game.holeR() 하나다 — 상수 export 는 죽은 API 가 된다)
/** 사건의 지평선 기본 반지름. 세계 중심의 블랙홀 — 이 게임의 무대이자 시계다. */
const HOLE_BASE_R = 150
/** 막마다 지평선이 자란다 (5막 370px) — 런이 길어질수록 놀이터가 줄어든다. */
const HOLE_GROW = 55
/** 시작점 — 블랙홀이 중심을 차지했으므로 플레이어는 궤도에서 출발한다. */
const START_DIST = 1050
/** 지평선 위(d=holeR)에서의 중력. 이동속도(238)의 55% — 탈출은 항상 가능하다. */
const HOLE_PULL_PLAYER = 130
/** 적이 받는 중력. 최저 속도(88)보다 낮아 평시엔 스스로 걷는 적이 안 삼켜진다. */
const HOLE_PULL_FOE = 58
/** 드랍이 받는 중력(가속) — 주인 없는 XP 는 나선으로 흘러가고, 끝내 삼켜진다. */
const HOLE_PULL_DROP = 320

const MAX_FOES = 20000
const MAX_SHOTS = 4000
const MAX_MOTES = 24000
const MAX_DROPS = 3000
/** 주워지지 않은 XP 가 사라지기까지. 풀 포화를 막는 유일한 장치다. */
const DROP_LIFE = 26
const MAX_FIELDS = 512

/** 시뮬레이션 고정 스텝 (초). 1/60. */
const STEP = 1 / 60
/**
 * 한 프레임에 따라잡을 수 있는 최대 스텝 수. 탭 복귀 시 죽음의 나선을 막는다.
 *
 * **프레임률 하한의 여유분이기도 하다.** 5 였을 때 12fps(프레임당 5스텝 필요)에서
 * 여유가 정확히 0이라, 레벨업 브레이크로 밀린 스텝을 영영 못 따라잡고 밀림이 쌓여
 * 재동기화가 시뮬레이션 시간을 통째로 버렸다 — 12fps 플레이어만 몰래 시간이 건너뛴다.
 * 8이면 12fps 에서 프레임당 3스텝의 여유가 있다.
 */
const MAX_STEPS = 8

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
  readonly fields = new Fields(MAX_FIELDS)
  readonly camera = new Camera()
  readonly loadout = new Loadout()
  readonly hash = new SpatialHash(-WORLD_R, -WORLD_R, WORLD_R * 2, WORLD_R * 2, 52, MAX_FOES)
  readonly terrain = new Terrain(WORLD_R)

  rng = new Rng(1)
  /** 누적 실시간(초). 여기서 총 스텝 수를 유도한다 — 뺄셈 누적은 프레임률에 종속된다. */
  private timeAcc = 0
  /**
   * 지금까지 실행한 시뮬레이션 스텝 수.
   *
   * 공개인 이유: **결정론 계약이 스텝 기준이기 때문이다.** "같은 시간"이 아니라
   * "같은 스텝 수"라야 비교가 성립한다 — update() 는 dt 크기만큼 스텝을 묶어서
   * 돌므로, 벽시계로 멈추면 3스텝 프레임이 최대 2스텝 넘어간다(실측: 적 423 vs 417).
   * 협동 lockstep 도 스텝을 세지 시간을 안 센다.
   */
  stepsDone = 0
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
  /** 한 스텝에 블랙홀이 삼킨 적 — deadBuf 와 달리 보상 없이 소멸한다 */
  private readonly eatenBuf = new Int32Array(2048)
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
   * 지금 처리 중인 폭발의 세대. 반향 필드가 터질 때 그 필드의 gen 을 여기 실어,
   * 그 폭발로 죽은 적이 낳는 새 반향이 gen+1 을 물려받게 한다.
   *
   * **호출 스택으로는 못 센다.** 반향 폭발은 필드 만료 후 다음 프레임에 새 스택으로
   * 일어나므로 깊이는 항상 0~1 이었고, 그래서 상한이 발동한 적이 없었다.
   */
  private echoGen = 0
  /** 반향 슬롯 캐시. 매 킬마다 find() 로 찾으면 hot path 에서 낭비다. */
  private echoSlot: WeaponSlot | null = null
  /** 현재 막 (0-based) */
  act = 0
  /** 막 전환 연출 남은 시간 */
  actIntro = 0
  /** 이번 막 보스가 이미 나왔는가 */
  private bossSpawned = false
  /** 보스 — 패턴 상태기계. 한 번에 하나뿐이라 객체를 써도 hot path 를 안 건드린다. */
  readonly boss = new Boss()

  phase: PhaseType = Phase.Playing
  elapsed = 0
  seed = 1
  /** 순수 연출용 시간 — 일시정지 중에도 흐른다 */
  visualTime = 0
  /**
   * 렌더 전용 장부 — 시뮬레이션·결정론과 무관하다.
   * fxLumPrev: 지난 프레임 fx 가 **요구한**(감광을 곱하기 전) 화면 평균 광량.
   *   감광 전 수요를 재므로 감광 결과에 되먹지 않는다 — 진동 없이 수렴한다.
   * flashPrev: 지난 프레임 동시에 켜져 있던 명중 플래시 수. 광역기가 500마리를
   *   동시에 치면 플래시 500개가 동시 점화된다 — 개당 밝기로는 못 막는 축이다.
   */
  private fxLumPrev = 0
  private flashPrev = 0
  private fxAcc = 0
  /** 지난 프레임 화면에 그려진 적 수 — 군체 밀도 감광용 (렌더 전용) */
  private foesPrev = 0
  /** 레벨업 대기 중인 선택지. UI 가 이걸 읽어 그린다. */
  pendingChoices: Choice[] = []
  /** 레벨업이 한 번에 여러 번 터졌을 때 밀린 횟수 */
  private pendingLevels = 0
  /** 살아 있는 성흔(진공) 수 — 동시에 1개만. 흔치 않아야 사건이 된다. */
  private vacuumOut = 0
  /**
   * 다음 성흔 주사위 시각. **킬마다 굴리면 안 된다** — 킬 경로에 rng 소비를 하나
   * 끼웠더니 난수 스트림 전체가 밀려 봇 계측이 통째로 재섞였다(가시 시작이 46s 에
   * 죽는 회귀를 earlygame.test 가 즉시 잡았다). 60초부터 45초 간격의 시각 기반
   * 주사위(p=0.08)면 판당 기대 ~1.5개에, 첫 60초의 스트림은 한 비트도 안 변한다.
   */
  private nextVacuumRoll = 60
  /** 다음 압박 비트 시각. 균일한 스폰만으론 몇 분이면 루즈해진다 — acts.ts BEATS 참고. */
  private nextBeatAt = 38
  /**
   * 위기의 자비 쿨다운 — 1막에서 체력 32% 아래로 싸우는 중이면 킬이 확정 회복을
   * 떨군다(12초에 한 번). 확률(0.006)은 정확히 필요한 순간에 안 온다 — 실측:
   * hp 16으로 10초를 버티고 280킬을 했는데 회복 0, 두 번째 물결에 사망.
   * 무기 1~2개 시절의 위기는 실력이 아니라 뽑기라, 튜토리얼 막에서만 바닥을 깐다.
   */
  private nextMercy = 0
  /**
   * 다음 파편 광맥 응결 시각. 포식이 흩뿌린 물질이 원반 대역에 XP 무리로 맺힌다 —
   * "강하할 이유"의 실체. 시간 기반 주사위(성흔과 같은 규율 — 킬 경로에 rng 를
   * 끼우면 스트림이 통째로 밀린다). 포식이 끝나면 곧바로 한 번 재보급된다.
   */
  private nextShardAt = 50
  /** 방금 발동한 비트 이름 — main 이 읽어 작은 배너로 띄운다 (연출 전용) */
  beatName = ''
  beatIntro = 0
  /** 막의 계약 — 세계 쪽 배율 (플레이어 쪽은 loadout.pactMods). acts.ts PACTS 참고. */
  private pactXp = 1
  private pactFoeHp = 1
  private pactSpawn = 1
  private pactFoeSpeed = 1
  private pactHeal = 1
  /** 레벨업 다시 뽑기 — 막마다 1회. 죽은 드래프트 구제용. */
  rerollLeft = 1
  /**
   * 심장박동 시계 — 박(beat) 단위 누적. 블랙홀의 맥이자 게임의 메트로놈:
   * 무기 발사(16분음)·중력 펄스(마디 첫 박)·포식(8마디째)·BGM 이 전부 여기 물린다.
   * BPM 이 막마다 올라도 **누적**이라 위상이 끊기지 않는다. rng 소비 0 — 결정론 안전.
   */
  beatClock = 0
  /** 이번 스텝이 16분음 경계인가 — 무기 발사 창 (FireCtx, weapons.tickWeapon 이 읽는다) */
  beatFire = false
  private feedingNow = false
  private feedWarned = false
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

  /** 사건의 지평선 반지름 — 막이 오를수록 블랙홀이 자란다. */
  holeR(): number {
    return HOLE_BASE_R + this.act * HOLE_GROW
  }

  /** 스폰·성흔이 피해야 할 반경 (지평선 + 여유) */
  private holeGuard(): number {
    return this.holeR() + 90
  }

  /**
   * 포식 — 8마디마다 한 마디(4박) 동안 블랙홀이 크게 들이쉰다. 중력이 치솟아
   * (holeSurge 3.8배) 지평선 근처의 적·XP 가 우수수 빨려든다.
   * bar >= 16 게이트와 % 8 == 7 이 겹쳐 **첫 포식은 bar 23 — 88bpm 에서 62.7초**다
   * (rhythm.test 가 시각표를 잠근다). 첫 수업(15초)과 조작 학습 구간을 침범하지 않는다.
   */
  feeding(): boolean {
    const bar = Math.floor(this.beatClock / 4)
    return bar >= 16 && bar % 8 === 7
  }

  /** 포식 예고 — 직전 마디의 후반 2박. 광자 고리가 조이고 저음이 운다. */
  feedWarn(): boolean {
    const bar = Math.floor(this.beatClock / 4)
    return bar >= 15 && bar % 8 === 6 && this.beatClock % 4 >= 2
  }

  /**
   * 이번 스텝의 중력 배율 — 심장박동이 곧 중력이다.
   * 마디 첫 박(0.5박)마다 "쿵" 하고 조이고(2.6배), 포식 마디는 3.8배.
   * 여기 하나로 플레이어·적·드랍이 함께 숨쉰다.
   */
  private holeSurge(): number {
    // 5.2로 뒀더니 포식이 지평선 3배 반경을 8마디마다 공짜 청소해 후반 밀도가
    // 무너졌다(봇 완주 3/6 → 4/6, 평균 킬 13만 → 20만). 3.8이면 잔챙이만 쓸리고
    // 굵은 것은 끌려오기만 한다 — 스펙터클은 남고 청소는 준다.
    if (this.feeding()) return 3.8
    if (this.beatClock % 4 < 0.5) return 2.6
    return 1
  }

  /** 심장박동 상태 전이 — 포식 예고·시작의 소리와 배너 (1회성 이벤트 발행) */
  private tickHeartbeat(): void {
    if (this.feedWarn() && !this.feedWarned) {
      this.feedWarned = true
      this.sfx('boom')
      this.beatName = '포식'
      this.beatIntro = 2.0
    }
    const f = this.feeding()
    if (f && !this.feedingNow) {
      this.sfx('boom')
      this.camera.shake(8, 6)
    }
    if (!f && this.feedingNow) {
      // 포식이 끝났다 — 삼킨 물질이 원반에 파편으로 맺힌다. 재보급이 강하 사이클의
      // 박자다: 포식 전에 캐고, 나와서 버티고, 끝나면 다시 들어간다.
      this.nextShardAt = Math.min(this.nextShardAt, this.elapsed + 1.5)
    }
    this.feedingNow = f
    if (!f && !this.feedWarn()) this.feedWarned = false
  }

  /**
   * 파편 광맥 — 원반 대역에 XP 무리가 응결된다 (판의 "저기 캐러 가자").
   * 총량은 잔해와 같은 원칙: 그 시점 한 레벨의 22%를 10개로 나눠 담는다.
   */
  private tickShards(): void {
    if (this.elapsed < this.nextShardAt) return
    this.nextShardAt = this.elapsed + 21 + this.rng.next() * 9
    const hr = this.holeR()
    const a = this.rng.next() * Math.PI * 2
    const r = hr * (DISK_IN + 0.3 + this.rng.next() * (DISK_OUT - DISK_IN - 0.6))
    const cx = Math.cos(a) * r
    const cy = Math.sin(a) * r
    const value = (xpForLevel(this.player.level) * 0.22) / 10
    for (let k = 0; k < 10; k++) {
      const sa = this.rng.next() * Math.PI * 2
      const sd = this.rng.next() * 64
      this.drops.spawn(cx + Math.cos(sa) * sd, cy + Math.sin(sa) * sd, 0, 0, value, Drop.Xp)
    }
    // 응결의 섬광 — 멀리서도 "저기 맺혔다"가 보여야 강하가 결정이 된다
    shockwave(this.motes, cx, cy, 200, 1.5, 1.2, 0.4, 0.9)
    this.sfx('pickup')
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
    this.timeAcc = 0
    this.stepsDone = 0
    this.spawnTimer = 0
    this.elapsed = 0
    this.phase = Phase.Playing
    this.pendingChoices = []
    this.pendingLevels = 0
    this.vacuumOut = 0
    this.nextVacuumRoll = 60
    this.nextBeatAt = 38
    this.nextMercy = 0
    this.nextShardAt = 50
    this.beatName = ''
    this.beatIntro = 0
    this.pactXp = 1
    this.pactFoeHp = 1
    this.pactSpawn = 1
    this.pactFoeSpeed = 1
    this.pactHeal = 1
    this.rerollLeft = 1
    this.beatClock = 0
    this.beatFire = false
    this.feedingNow = false
    this.feedWarned = false
    this.fxLumPrev = 0
    this.flashPrev = 0
    this.fxAcc = 0
    this.foesPrev = 0
    this.act = 0
    this.actIntro = ACT_INTRO_SECONDS
    this.bossSpawned = false
    this.boss.reset()
    this.echoGen = 0
    this.echoSlot = null
    // 지형은 시드에서 나온다. 같은 시드 = 같은 맵.
    // 중심은 블랙홀 몫으로 비운다 — 5막 지평선(370) + 여유. 시작점은 궤도 위.
    // 원반 대역(1막 안쪽 경계 ~ 5막 바깥 경계)은 조류의 강 — 벽 희박, 잔해 2배.
    const holeMax = HOLE_BASE_R + HOLE_GROW * (ACTS.length - 1)
    this.terrain.generate(
      seed, WORLD_R, 0, START_DIST, holeMax + 210,
      HOLE_BASE_R * DISK_IN, holeMax * DISK_OUT,
    )
    this.player.x = 0
    this.player.y = START_DIST
    // 시작 무기는 시드로 정한다 — 매판 다른 빌드로 출발한다.
    // 스스로 죽일 수 있는 무기만 (반향·정지로 시작하면 영원히 0킬이다)
    this.loadout.reset(STARTER_WEAPONS[this.rng.int(STARTER_WEAPONS.length)]!)
    this.echoSlot = this.loadout.findWeapon(W.Echo) ?? null
    this.loadout.recomputeStats(this.player)
    this.player.hp = this.player.stats.maxHp
    this.camera.x = 0
    this.camera.y = START_DIST
    this.camera.viewHeight = 820
  }

  /** 레벨업 선택 확정. UI 가 부른다. */
  choose(choice: Choice): void {
    this.loadout.apply(choice, this.player)
    this.echoSlot = this.loadout.findWeapon(W.Echo) ?? null
    if (choice.kind === 'pact') {
      // 세계 쪽 배율 — 플레이어 쪽은 loadout.apply 가 이미 얹었다
      const d = PACTS[choice.index]!
      this.pactXp *= d.xp
      this.pactFoeHp *= d.foeHp
      this.pactSpawn *= d.spawn
      this.pactFoeSpeed *= d.foeSpeed
      this.pactHeal *= d.heal
      this.sfx('evolve')
      shockwave(this.motes, this.player.x, this.player.y, 340, EVENT * 0.9, 0.32, 0.4, 1.0)
      this.camera.shake(10, 8)
    }
    if (choice.kind === 'evolve') {
      // 진화는 이 게임에서 가장 귀한 순간이라 유일하게 EVENT 밝기를 쓴다. 1초 미만.
      this.sfx('evolve')
      const k = EVENT
      shockwave(this.motes, this.player.x, this.player.y, 220, choice.r * k, choice.g * k, choice.b * k, 0.9)
      burst(this.motes, this.player.x, this.player.y, 60, choice.r * k, choice.g * k, choice.b * k, 460, 1.0, 8, Shape.Star)
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

    // **총 시간에서 스텝 수를 유도한다. 뺄셈으로 누적하지 않는다.**
    //
    // 예전엔 `acc += dt` 하고 `acc -= STEP` 을 반복했다. 그러면 1/60 을 2700번 빼는 것과
    // 2/60 을 1350번 빼는 것의 부동소수점 누적 오차가 달라서 **총 스텝 수가 1 어긋난다**.
    // 45초를 돌리면 30fps 와 60fps 의 적 수가 133 vs 129 로 갈렸다(테스트가 잡았다).
    //
    // wantSteps 를 총 경과 시간에서 floor 로 뽑으면 오차가 누적되지 않는다 —
    // 2700×(1/60) 이든 1350×(2/60) 이든 합은 45.0 이고 floor 는 같다.
    this.timeAcc += Math.min(frameDt, 0.25)
    const wantSteps = Math.floor(this.timeAcc / STEP)
    let steps = 0
    while (this.stepsDone < wantSteps && steps < MAX_STEPS) {
      this.step(input, STEP)
      this.stepsDone++
      steps++
      // **phase 가 바뀌면 즉시 멈춘다.** 이게 없으면 프레임률이 시뮬레이션을 바꾼다:
      // 한 프레임이 33ms 를 넘으면 2스텝을 도는데, 서브스텝 1에서 레벨업이 떠도
      // 서브스텝 2가 그대로 더 돌면서 rng 를 더 먹는다(사격 seed·크리 판정·스폰).
      // 결과: 같은 데일리 시드인데 30fps 와 144fps 에게 다른 선택지가 뜬다.
      // 144Hz 는 프레임당 1스텝이라 절대 초과하지 않고 30Hz 는 매 프레임 초과하므로,
      // 시드별 최고 기록이 프레임률 경쟁이 된다. 죽음/승리도 5번 중복 실행됐다.
      //
      // 밀린 스텝은 **버리지 않는다**. stepsDone 이 남아 있으므로 레벨업을 고른 뒤
      // 다음 프레임이 그만큼 더 돈다 — 총 스텝 수가 프레임률과 무관해진다.
      if (this.phase !== Phase.Playing) break
    }
    // 따라잡기를 포기하는 경우(탭 복귀 등)엔 시계를 맞춰 준다.
    // 안 그러면 stepsDone 이 영원히 뒤처져서 죽음의 나선이 된다.
    if (steps === MAX_STEPS && wantSteps - this.stepsDone > MAX_STEPS * 4) {
      this.stepsDone = wantSteps
      this.timeAcc = this.stepsDone * STEP
    }

    this.camera.follow(this.player.x, this.player.y, frameDt, 7.5)
    this.camera.update(frameDt)
  }

  private step(input: Input, dt: number): void {
    this.elapsed += dt

    // ── 심장박동. 16분음 경계 검출이 무기 발사 창(beatFire)이 된다.
    // 8분음으로 시작했더니 초반 무기 1개의 "지속 압력"이 "펄스+공백"이 되어
    // 공백마다 접촉을 허용했다(earlygame 3종 사망). 16분음이면 공백이 절반인데
    // 정렬감은 산다 — 리듬의 몸통은 어차피 킥과 마디 중력 펄스다.
    const prevClock = this.beatClock
    this.beatClock += dt * (ACTS[this.act]!.bpm / 60)
    this.beatFire = Math.floor(this.beatClock * 4) !== Math.floor(prevClock * 4)
    this.tickHeartbeat()

    this.player.update(input.move, dt, WORLD_R)
    // 지형은 플레이어를 막는다 (적은 갉아먹고 지나간다)
    if (this.terrain.resolveCircle(this.player.x, this.player.y, this.player.radius, this.hit2)) {
      this.player.x = this.hit2[0]!
      this.player.y = this.hit2[1]!
    }

    // ── 블랙홀: 플레이어. **거리 제곱** 반비례 — 시작 궤도(1050)에선 사실상 0이고
    // 지평선 2배 거리부터 몸으로 느껴지며, 지평선 안은 이동속도의 74%(상한 1.35)로
    // 필사적이다. 지수 1로 뒀더니 무입력 방치가 27.7초 만에 지평선에 닿았다
    // (beats 테스트가 잡았다) — 표류는 양념이지 운명이면 안 된다.
    // 무적 주기마다 물린다. 떨어지면 죽는 게 아니라 **비싸다** — 탈출은 항상 가능하다.
    const hr = this.holeR()
    const surge = this.holeSurge()
    {
      const p = this.player
      const pd = Math.hypot(p.x, p.y) || 1
      const rel = hr / pd
      // 절대 상한: 이동속도의 82%. 포식 서지(3.8배)가 곱해지면 흡입이 667px/s 까지
      // 치솟아 지평선 1.44배 안이 **탈출 불가**였다(적대 리뷰가 수학으로 증명) —
      // "떨어지면 비싸다, 그러나 탈출은 항상 가능하다"는 이 게임의 계약이다.
      const g = Math.min(
        HOLE_PULL_PLAYER * Math.min(1.35, rel * rel) * surge,
        p.stats.speed * 0.82,
      ) * dt
      p.x -= (p.x / pd) * g
      p.y -= (p.y / pd) * g
      // ── 조류: 강착원반은 흐른다 — 나를 포함해서. 접선(반시계) 기류에 실려
      // 궤도를 돈다. 타면 서핑이고 거스르면 기어간다 — 이동의 재발명이 여기다.
      // 속도(vx)가 아니라 위치에 더한다: 조작 반응(즉시 감쇠 블렌드)을 안 건드린다.
      const band = diskBandAt(pd, hr)
      if (band > 0) {
        const f = FLOW_MAX * band * dt
        // 접선 벡터를 먼저 굳힌다 — x 를 갱신한 값으로 y 접선을 계산하면 나선이 샌다
        const tx = -p.y / pd
        const ty = p.x / pd
        p.x += tx * f
        p.y += ty * f
      }
      if (pd < hr && p.hurt(16)) {
        this.camera.shake(10, 9)
        this.sfx('hurt')
      }
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
        bossIdx: this.boss.idx,
        speedMul: this.pactFoeSpeed,
        holeR: hr,
        holePull: HOLE_PULL_FOE * surge,
        eatenOut: this.eatenBuf,
      },
      this.player.radius,
    )

    // 화상으로 쓰러진 적만 거둔다. 전체를 훑으면 후반에 매 스텝 2만 번이 그냥 낭비된다.
    for (let k = 0; k < res.deadCount; k++) this.killFoe(this.deadBuf[k]!)

    // 블랙홀이 삼킨 적 — **보상 없이** 소멸한다. 적을 지평선으로 밀어 넣는 건
    // 공짜 청소지 사냥이 아니다(XP 를 주면 최적 플레이가 "다 밀어 넣기"가 된다).
    for (let k = 0; k < res.eatenCount; k++) {
      const j = this.eatenBuf[k]!
      const ex = this.foes.x[j]!
      const ey = this.foes.y[j]!
      spray(this.motes, ex, ey, -ex, -ey, 0.7, 2, 0.9, 0.5, 1.3, 260, 0.35, 3)
      this.foes.kill(j)
    }

    // 접촉 피해 — **한 방의 크기**다. 무적 프레임(0.4초)마다 한 번 들어간다.
    //
    // 포위당하면 더 아프다: 닿은 수가 8이면 2배. 합산하지 않는 이유는 잔챙이 20마리가
    // Eye 보다 아파지면 종족 설계가 무너지기 때문이다.
    //   Mote 1마리: 6 / 0.4s = 15 DPS
    //   Mote 8+:    12 / 0.4s = 30 DPS
    //   Eye 8+:     52 / 0.4s = 130 DPS  → Lv57 체력 570 이면 4.4초
    if (res.contactDamage > 0) {
      const crowd = 1 + Math.min(res.contactCount, 8) / 8
      if (this.player.hurt(res.contactDamage * crowd)) {
        // 피격 반동 — 문 것들을 한 뼘(~30px) 밀어낸다. **움직이는 자의 것이다.**
        //
        // 무적이 끝나는 순간 같은 무리에게 그대로 다시 물리면 포위가 즉사 나선이
        // 된다: 공백이 긴 시작 무기 5종(광선·신문·호·위성·혜성)이 봇 계측에서
        // 전부 22~40s 에 여기서 죽었다. 밀어내는 한 뼘이 "맞았지만 빠져나갈 수
        // 있다"를 만든다 — 무기별 버프 대신 보편 장치 하나로 복권을 없앤다.
        //
        // 정지 상태엔 안 준다. 무조건 줬더니 **가만히 서서 완주가 됐다**(테스트가
        // 잡았다) — 반동은 빠져나가려는 움직임을 살리는 장치지, 제자리 요새의
        // 보호막이 아니다.
        if (Math.hypot(this.player.vx, this.player.vy) > 40) {
          // 340→390, 120→132: 심장박동 양자화로 발사 사이 공백이 그리드에 물리자
          // 초반 무기 1개 구간의 포위 이탈 여유가 줄었다(불씨 시드 48.9s 사망).
          // 반동은 그 복권을 해소하려고 도입한 보편 장치다 — 한 눈금 더 준다.
          this.pushFoes(this.player.x, this.player.y, 132, 390)
        }
        this.camera.shake(9, 12)
        this.sfx('hurt')
      }
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
    this.tickBeats(dt)
    this.tickVacuum()
    this.tickShards()

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
    //
    // 첫 15초는 더 완만하다. 조작을 배우기도 전에 포위당하면 아무도 두 번 안 한다 —
    // 접촉 피해를 진짜로 고치자 봇이 12~23초에 죽었고, 그건 난이도가 아니라 시작
    // 자체를 막는 것이다. 튜토리얼이 없는 게임이라 첫 15초가 곧 튜토리얼이다.
    //
    // 바닥 0.5·램프 15s. 처음(0.25·25s)엔 같은 관찰 하나에 완화를 두 겹(여기 + 1막
    // rate 절반)으로 쌓아서 t=25s 누적 적 수가 이전의 1/3이었다 — 봇이 죽은 건
    // 밀도가 아니라 접촉 피해가 진짜가 된 것 때문인데, 밀도만 두 번 깎은 셈이다.
    // 실측(t=10s 화면 적 30~46마리)에서 "군체가 밀려온다"는 그림 자체가 사라졌다.
    const warmup = Math.min(1, 0.5 + (this.elapsed / 15) * 0.5)
    // 포식 중엔 1.6배 — 블랙홀이 들이쉬면 그만큼 새로 밀려온다. 포식이 삼킨
    // 밀도를 되채워야 "주기적 공짜 청소"가 안 된다 (rng 스트림엔 영향 없다:
    // 예산 누적만 빨라질 뿐 주사위 순서는 그대로다).
    const feedMul = this.feeding() ? 1.6 : 1
    const rate = (18 + inAct * 46) * act.rate * (1 + overall * 1.4) * warmup * this.pactSpawn * feedMul
    this.spawnTimer += dt * rate

    // 체력: 막 배율에 막 안 진행분을 얹는다 (+ 계약)
    const hpScale = act.hp * (1 + inAct * 0.55) * this.pactFoeHp
    const rand = this.randFn

    while (this.spawnTimer >= 1) {
      this.spawnTimer -= 1
      if (this.foes.count >= MAX_FOES - 32) {
        // 풀이 찼으면 예산도 버린다. 이월시키면 대량 처치로 풀이 비는 순간
        // 한 스텝에 수천 마리가 재충전되는 1프레임 스파이크가 생긴다 (#9).
        this.spawnTimer = 0
        break
      }

      const type = this.rollFoeType(act)

      // 화면 가장자리 바로 밖에서 나타나게. 더 멀면 걸어오는 데만 10초가 걸려
      // 초반이 텅 비고, 더 가까우면 눈앞에 튀어나와 불공정하다.
      // 플레이어가 원반 대역 안이면 링을 좁힌다(520~800) — 조류가 추적을 나선으로
      // 휘게 해 도달이 늦고(실측: 대역의 봇이 40초간 킬 7), fold 도 잦다.
      // 강물에서 싸우기로 했으면 강물 위아래에서 빨리 밀려와야 그게 성립한다.
      // 첫 45초는 제외 — 무기 1개 시절의 근접 스폰은 압박이 아니라 처형이다.
      const pBand = diskBandAt(Math.hypot(this.player.x, this.player.y), this.holeR())
      const tight = pBand > 0.25 && this.elapsed > 45
      const rMin = tight ? 520 : 620
      const rMax = tight ? 800 : 900
      if (type === Foe.Mote) {
        // 잔챙이는 무리로 — 이게 "군체"의 그림을 만든다
        const size = 5 + this.rng.int(6)
        this.spawnTimer -= size - 1 // 무리 하나가 예산 size 만큼을 쓴다
        spawnCluster(
          this.foes, type, this.player.x, this.player.y,
          rMin, rMax - 20, hpScale, size, 66, rand, WORLD_R, this.holeGuard(),
        )
      } else {
        const i = spawnRing(
          this.foes, type, this.player.x, this.player.y,
          rMin, rMax, hpScale, rand, WORLD_R, this.holeGuard(),
        )
        // 엘리트 어픽스 — 2막부터 Hex·Eye 의 18%. 군중 속 "저놈부터"라는 단기 목표.
        if (
          i >= 0 && this.act >= 1 && (type === Foe.Hex || type === Foe.Eye) &&
          this.rng.next() < 0.18
        ) {
          this.foes.affix[i] = 1 + this.rng.int(4)
        }
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
      // **살아 있는 보스는 그대로 둔다.** 예전엔 여기서 reset() 을 불러서, 20초 안에
      // 못 잡은 보스가 고아가 됐다 — 5,355hp 짜리가 왕관도 체력바도 마커도 없이
      // 평범한 Hex(46hp) 모습으로 돌아다녔다. 플레이어는 "왜 안 죽지"만 겪는다.
      // 이번 막 보스는 아직 안 나왔으므로 bossSpawned 만 되돌리면 된다.
      if (this.boss.idx < 0) this.boss.reset()
      // 막이 바뀌는 순간이 곧 이정표다 — 화면과 소리가 같이 알려야 한다
      shockwave(this.motes, this.player.x, this.player.y, 420, EVENT * 0.7, EVENT * 0.6, 0.8, 1.4)
      this.camera.shake(10, 5)
      this.sfx('levelup')
      // 막의 계약 — 새 막은 조건을 걸고 시작한다. 거절은 없다: 계약이 곧 막이다.
      // 셋 다 득실이 함께라 "내 빌드에 맞는 위험 고르기"가 된다 (acts.ts PACTS).
      this.pendingChoices = this.rollPacts()
      this.pendingLevels += 1
      this.phase = Phase.LevelUp
      this.rerollLeft = 1 // 리롤도 막마다 충전
    }

    // 막 끝 보스. 남은 20초는 잡고 정리할 여유다.
    if (!this.bossSpawned && actProgressAt(this.elapsed) * ACT_SECONDS >= BOSS_AT) {
      this.bossSpawned = true
      this.spawnBoss()
    }

    this.tickBoss(dt)
  }

  /**
   * 보스 패턴 한 틱.
   *
   * updateFoes 가 이미 보스를 "플레이어를 향해 걷는 잔챙이"로 움직였다. 여기서
   * 그 위에 덮어쓴다 — 별도 AI 루프를 만들면 hot path 에 분기가 늘고, 보스는
   * 하나뿐이라 그럴 값어치가 없다.
   */
  private tickBoss(dt: number): void {
    const boss = this.boss
    if (boss.idx < 0) return
    const j = boss.idx
    const foes = this.foes
    // **도장으로 확인한다. alive 만 보면 안 된다.**
    // step() 순서가 `updateShots(보스 사망) → spawn → tickActs` 이고 acquire() 가 LIFO 라,
    // 보스가 죽은 같은 스텝의 spawn 이 그 슬롯을 잡졸에게 넘긴다. alive 만 보면 1을 읽고
    // 통과해서 잡졸 하나가 보스 정체성을 통째로 상속한다 — 크기 3.4배, 왕관, 돌진
    // 962px/s, 소환, 수축장 피해까지. (적대 리뷰가 잡았다.)
    if (foes.alive[j] === 0 || foes.stamp[j] !== boss.stamp) {
      boss.reset()
      return
    }

    const bx = foes.x[j]!
    const by = foes.y[j]!
    const hpFrac = foes.hp[j]! / boss.maxHp
    const prevState = boss.state
    const entered = boss.tick(dt, this.rng, hpFrac)

    // 상태 전이 순간에만 하는 일. **실행은 예고가 끝난 뒤에 온다** —
    // 소환·수축의 몸통은 이전 상태가 끝나는 여기서 처리한다.
    if (entered !== null) {
      if (prevState === BossState.Summon) {
        // 잔챙이 살포 — 보스에게만 매달리면 둘러싸인다.
        // 전엔 상태 **진입 즉시** 뿌려서, 예고 인장이 소환 뒤에 자라는 역순이었다.
        const n = 6 + this.act * 3
        for (let k = 0; k < n; k++) {
          spawnRing(
            foes, Foe.Husk, bx, by, 60, 190,
            ACTS[this.act]!.hp * 0.6, this.randFn, WORLD_R, this.holeGuard(),
          )
        }
        shockwave(this.motes, bx, by, 220, 1.6, 0.6, 0.2, 0.6)
        this.sfx('evolve')
      } else if (prevState === BossState.Collapse) {
        // 수축의 끝 — 중심에서 터진다("터진다"는 주석의 약속을 코드로).
        // 링이 지나가기 전에 밖으로 나갔으면 0이다.
        shockwave(this.motes, boss.ringX, boss.ringY, 170, 1.7, 0.45, 0.2, 0.6)
        const pd = Math.hypot(this.player.x - boss.ringX, this.player.y - boss.ringY)
        if (pd < 150 && this.player.hurt(26)) {
          this.camera.shake(11, 9)
          this.sfx('hurt')
        }
      }
      switch (entered) {
        case BossState.Aim: {
          // 조준을 확정한다. 이 시점의 플레이어 위치로 — 그래서 예고 중에
          // 옆으로 비키면 피할 수 있다. 계속 따라오면 그건 예고가 아니다.
          const dx = this.player.x - bx
          const dy = this.player.y - by
          const d = Math.hypot(dx, dy) || 1
          boss.dirX = dx / d
          boss.dirY = dy / d
          this.sfx('bolt')
          break
        }
        case BossState.Charge:
          this.camera.shake(7, 10)
          this.sfx('nova')
          break
        case BossState.Stagger:
          // 빈틈에 들어섰다는 걸 알려야 딜 기회로 읽힌다
          shockwave(this.motes, bx, by, 150, 1.4, 1.2, 0.4, 0.5)
          this.sfx('kill')
          break
        case BossState.Summon:
          // 예고만 — 인장이 1.4초 차오른다. 잔챙이는 상태가 끝날 때(위) 나온다.
          this.sfx('evolve')
          break
        case BossState.Collapse:
          // 수축장: 지금 플레이어가 선 자리를 중심으로 링이 좁혀와 **중심에서 터진다**.
          // 링이 지나가기 전에 밖으로 나가야 산다.
          boss.ringX = this.player.x
          boss.ringY = this.player.y
          boss.ringR = 520
          this.sfx('nova')
          break
      }
    }

    // 상태가 **유지되는 동안** 하는 일
    switch (boss.state) {
      case BossState.Charge: {
        // updateFoes 의 추격을 덮어쓴다 — 돌진은 조준한 직선으로만 간다
        const sp = FOE_STATS[foes.type[j]!]!.speed * boss.speedScale()
        foes.vx[j] = boss.dirX * sp
        foes.vy[j] = boss.dirY * sp
        // 지나간 자리에 흔적
        burst(this.motes, bx, by, 2, 1.6, 0.5, 0.2, 90, 0.24, 5)
        break
      }
      case BossState.Aim:
      case BossState.Stagger: {
        // 멈춘다. 예고는 읽을 시간이고 빈틈은 딜 기회다.
        foes.vx[j] = 0
        foes.vy[j] = 0
        break
      }
      case BossState.Collapse: {
        // **링 안쪽이 위험하다. 밖이 안전하다. 단, 유예 뒤부터.**
        //
        // 두 번 틀린 자리다. ① 링 테두리(±34)에만 피해 — 링이 70에서 멈춰서 중심
        // 정지가 절대 안전, 도주가 처벌이었다(의도와 정반대, 적대 리뷰가 잡았다).
        // ② 안쪽 전체를 즉시 위험으로 — 링이 플레이어 발밑에서 시작하니 최고속 즉시
        // 도주로도 탈출 1.16초, **완벽한 반응에 ~33 피해가 확정**됐다(계약 위반).
        //
        // 지금: 유예(COLLAPSE_GRACE 1.5s) 동안은 조여들기만 한다 → 그 뒤 안쪽 전체가
        // 아프다 → 끝에 중심이 터진다(전이 처리에서). 즉시 뛰면 0방, 서 있으면 3방+폭발.
        //
        // 수축 중엔 거의 제자리다 — speedScale(0.3)을 실제로 태운다. 이 케이스가
        // 링만 처리하고 배율을 안 태워서, 0.3은 사장되고 보스가 전속으로 걸어왔었다.
        const sc = boss.speedScale()
        foes.vx[j]! *= sc
        foes.vy[j]! *= sc
        boss.ringR = Math.max(0, boss.ringR - 210 * dt)
        const pd = Math.hypot(this.player.x - boss.ringX, this.player.y - boss.ringY)
        if (boss.collapseArmed() && pd < boss.ringR && this.player.hurt(11)) {
          this.camera.shake(9, 10)
          this.sfx('hurt')
        }
        break
      }
      default: {
        const sc = boss.speedScale()
        if (sc !== 1) {
          foes.vx[j]! *= sc
          foes.vy[j]! *= sc
        }
      }
    }
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
   * 공개인 이유: 콘솔 디버그 API 이기도 하다 (docs 의 EMBERTIDE.game.spawnBoss()).
   */
  spawnBoss(): void {
    const act = ACTS[this.act]!
    const hp = act.hp * 260 * (1 + this.act * 0.85)
    const i = spawnRing(
      this.foes, act.boss, this.player.x, this.player.y,
      700, 820, hp / (FOE_STATS[act.boss]!.hp || 1), this.randFn, WORLD_R, this.holeGuard(),
    )
    if (i < 0) {
      // 풀이 가득 차 실패했다. bossSpawned 를 되돌려 다음 스텝에 재시도한다 —
      // 안 그러면 그 막은 보스 없이 조용히 끝난다.
      this.bossSpawned = false
      return
    }
    this.boss.spawn(i, this.foes.hp[i]!, this.foes.stamp[i]!)
    // 보스는 화면에서 즉시 구분돼야 한다
    shockwave(this.motes, this.foes.x[i]!, this.foes.y[i]!, 260, EVENT * 0.8, 0.4, 0.6, 1.2)
    burst(this.motes, this.foes.x[i]!, this.foes.y[i]!, 34, EVENT * 0.8, 0.5, 0.7, 400, 1.0, 9, Shape.Crown)
    this.camera.shake(18, 6)
    this.sfx('evolve')
  }

  /** 계약 3택 — 서로 다른 계약 셋. 막 전환에서만 쓰이므로 할당이 있어도 싸다. */
  private rollPacts(): Choice[] {
    const picked: number[] = []
    while (picked.length < 3) {
      const id = this.rng.int(PACTS.length)
      if (!picked.includes(id)) picked.push(id)
    }
    return picked.map((id) => {
      const d = PACTS[id]!
      return {
        kind: 'pact' as const, index: id, title: d.name, desc: d.desc, level: 0,
        r: 1.7, g: 0.42, b: 0.5, hint: '계약 — 되돌릴 수 없다',
      }
    })
  }

  /** 레벨업 다시 뽑기 — 막마다 1회. UI 가 부른다 (계약엔 안 쓴다). */
  reroll(): void {
    if (this.rerollLeft <= 0 || this.phase !== Phase.LevelUp) return
    this.rerollLeft--
    this.pendingChoices = this.loadout.roll(this.rng, 3, this.player.stats.awaken)
  }

  /**
   * 압박 비트 — 26~40초마다 이름 붙은 전투 상황 하나가 한 방향에서 밀려온다.
   *
   * 균일한 스폰 흐름은 "안전한 원 그리기"로 수렴해 몇 분이면 자동사냥 구경이 된다
   * (실플레이: "루즈하다"). 비트는 예고(오는 방향의 파문 + 배너) → 대응(자리 잡기)
   * → 해소(몰살 = XP 뭉치)의 짧은 arc 를 만든다. 보스와는 겹치지 않는다 —
   * 고비 둘이 포개지면 읽을 수 없는 사고가 된다.
   */
  private tickBeats(dt: number): void {
    if (this.beatIntro > 0) this.beatIntro = Math.max(0, this.beatIntro - dt)
    if (this.elapsed < this.nextBeatAt) return
    // 마지막 25초는 피날레(5막 보스)의 시간이다
    if (this.elapsed > RUN_SECONDS - 25) return
    if (this.boss.idx >= 0) {
      this.nextBeatAt = this.elapsed + 10
      return
    }
    const table = ACT_BEATS[this.act]!
    const beat = BEATS[table[this.rng.int(table.length)]!]!
    const bearing = this.rng.next() * Math.PI * 2
    const hpScale = ACTS[this.act]!.hp * (1 + actProgressAt(this.elapsed) * 0.55) * beat.hpMul
    // 1막 비트는 72%만 — "1막은 배우는 시간". 무기 1~2개 시점에 진형 전량과
    // 배경 스폰이 포개지면(실측 근접 260마리) 배움이 아니라 복권이 된다.
    const count = this.act === 0 ? Math.round(beat.count * 0.72) : beat.count
    spawnFormation(
      this.foes, beat.type, beat.form, count,
      this.player.x, this.player.y, bearing, hpScale, this.randFn, WORLD_R, this.holeGuard(),
    )
    // 예고: 오는 방향에 파문 — "어디서"가 보여야 자리 잡기가 결정이 된다
    const hx = this.player.x + Math.cos(bearing) * 540
    const hy = this.player.y + Math.sin(bearing) * 540
    shockwave(this.motes, hx, hy, 300, 1.5, 0.55, 0.25, 1.0)
    this.camera.shake(5, 10)
    this.sfx('bolt')
    this.beatName = beat.name
    this.beatIntro = 2.2
    this.nextBeatAt = this.elapsed + 26 + this.rng.next() * 14
  }

  /**
   * 성흔(진공) 등장 판정 — 60초부터 45초마다 주사위 하나(p=0.08, 판당 기대 ~1.5개).
   * 화면 가장자리쯤(380~620px)에 떨어져 "주우러 갈까"가 선택이 된다.
   * 먹으면 맵의 모든 경험치가 날아온다 (updateDrops 의 Vacuum 분기).
   */
  private tickVacuum(): void {
    if (this.elapsed < this.nextVacuumRoll) return
    this.nextVacuumRoll += 45
    const roll = this.rng.next()
    if (roll >= 0.08 || this.vacuumOut !== 0) return
    const a = this.rng.next() * Math.PI * 2
    const d = 380 + this.rng.next() * 240
    let x = this.player.x + Math.cos(a) * d
    let y = this.player.y + Math.sin(a) * d
    // 월드 밖이면 반대편으로 접는다 (스폰 링과 같은 규칙)
    if (Math.hypot(x, y) > WORLD_R * 0.9) {
      x = this.player.x - Math.cos(a) * d
      y = this.player.y - Math.sin(a) * d
    }
    // 블랙홀 안이면 바깥으로 민다 — 성흔이 태어나자마자 삼켜지면 억울하다 (rand 무소비)
    {
      const s = holeClampScale(x, y, this.holeGuard() + 60)
      x *= s
      y *= s
      // 원점 1px 이내 롤은 배율로 못 살린다(0×s=0) — 성흔은 판당 한둘뿐인 소실
      // 불가 자산이라 결정적 위치로 강제한다 (확률 ~1e-9 지만 대가가 크다)
      if (Math.hypot(x, y) < this.holeR()) {
        x = 0
        y = this.holeGuard() + 60
      }
    }
    if (this.drops.spawn(x, y, 0, 0, 0, Drop.Vacuum) >= 0) this.vacuumOut = 1
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
        120, WORLD_R * 0.92, 8, this.randFn, WORLD_R, this.holeGuard(),
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
      // 보스는 보이는 만큼 맞아야 한다 (렌더 3.4배)
      const br = j === this.boss.idx ? BOSS_SCALE : 1
      const rr = r + FOE_STATS[this.foes.type[j]!]!.radius * br
      if (dx * dx + dy * dy > rr * rr) continue
      out[m++] = j
    }
    return m
  }

  shake(amount: number, decay = 9): void {
    this.camera.shake(amount, decay)
  }

  /**
   * 지속 효과체를 놓는다.
   *
   * evolved 를 인자로 받는다. 예전엔 kind → 무기 → 슬롯 역조회 표(FIELD_OWNER)로
   * 복원했는데, **호출자 4곳이 전부 slot 을 손에 쥐고 있었다** — 정보를 버린 뒤 표를
   * 만들어 되찾는 꼴이었다(적대 리뷰가 잡았다). 표·선형 스캔·매 호출 클로저가 함께 사라졌다.
   */
  placeField(
    kind: number, x: number, y: number, radius: number, power: number, life: number,
    evolved: boolean, gen = 0,
  ): void {
    this.fields.spawn(kind, x, y, radius, power, life, evolved, this.rng.next(), gen)
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
          smoke(this.motes, wx, wy, 2, 0.3, 0.24, 0.2, 10)
          this.reapCache(wx, wy)
        }
      }
    }
  }

  /**
   * 지형이 부서진 자리에 잔해가 있었으면 보상을 터뜨린다.
   *
   * 지형을 부수는 경로가 여러 개(탄·혜성·적)라, 각자 확인하게 하면 언젠가 빠뜨린다.
   * Terrain.brokeCache 플래그를 여기서 한 번만 소비한다.
   */
  private reapCache(x: number, y: number): void {
    if (!this.terrain.brokeCache) return
    this.terrain.brokeCache = false
    // 크게 주되 **한 레벨을 넘지 않는다.**
    //
    // 두 번 틀렸다. ① 26+act*14 → 봇이 58개를 파고도 Lv 23. 있으나 마나였다.
    // ② 레벨 비례로 고쳤는데 **value 가 오브 1개당 값인 걸 잊고 7개를 뿌렸다** —
    //    Lv 10 에서 잔해 하나가 728 XP 인데 그 레벨 요구치는 38이었다. 19레벨이 한 번에
    //    터진다. 주석에 적어 둔 "한 레벨의 30~40%" 라는 자기 기준을 20배 넘겼고,
    //    인용한 곡선(9·1.115^N)조차 실제(7·1.115^N + 2N)와 달랐다(적대 리뷰가 잡았다).
    //
    // 이제 xpForLevel 을 직접 불러 그 시점 한 레벨의 55% 를 7개로 나눠 담는다.
    // 파러 갈 이유는 되되 한 번에 여러 레벨이 터지지는 않는다.
    // 한 레벨의 32%. 55% 였을 때 잔해를 135개 판 판이 Lv 83 이 됐다 —
    // "파러 갈 이유"는 되되 레벨 곡선을 밀어버리면 안 된다.
    const value = (xpForLevel(this.player.level) * 0.32) / 7
    // 풀이 가득 차면 구슬이 안 나온다. 그러면 판 대가가 연출뿐이라 **직접 준다** —
    // 잔해는 파는 데 시간과 위험이 들었으므로 조용히 증발시키면 안 된다.
    let placed = 0
    for (let k = 0; k < 7; k++) {
      const a = this.rng.next() * Math.PI * 2
      const sp = 60 + this.rng.next() * 140
      if (this.drops.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, value, Drop.Xp) >= 0) placed++
    }
    if (placed < 7) {
      const lost = (7 - placed) * value
      this.pendingLevels += this.player.gainXp(lost * this.pactXp)
      if (this.pendingLevels > 0 && this.phase === Phase.Playing) {
        this.phase = Phase.LevelUp
        this.loadout.recomputeStats(this.player)
        this.pendingChoices = this.loadout.roll(this.rng, 3, this.player.stats.awaken)
      }
    }
    // 회복도 하나. 잔해가 곧 보급이라 "파러 갈 이유"가 XP 하나로는 약하다.
    if (this.drops.spawn(x, y, 0, 0, 28, Drop.Heal) < 0) this.player.heal(28)
    shockwave(this.motes, x, y, 120, EVENT * 0.6, EVENT * 0.5, 0.4, 0.7)
    burst(this.motes, x, y, 16, 1.6, 1.4, 0.5, 260, 0.7, 6, Shape.Star)
    this.camera.shake(6, 12)
    this.sfx('levelup')
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
          // 이 반향이 죽인 적은 다음 세대 반향을 낳는다 — 세대가 필드에 실려야
          // 스택을 넘어 살아남는다.
          this.explode(x, y, r, power, 0.6, 2.0, 2.6, f.gen[i]! + 1)
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
   * 보스 예고 렌더.
   *
   * 패턴은 **보여야** 패턴이다. 안 보이면 무작위 사고고, 그러면 플레이어는
   * 배울 게 없어서 15분에 5번 다 똑같이 당한다.
   */
  private drawBossTells(
    b: SpriteBatch, x: number, y: number, size: number, t: number,
  ): void {
    const boss = this.boss
    const tel = boss.telegraph()

    switch (boss.state) {
      case BossState.Aim: {
        // 돌진 경로를 바닥에 깐다. 차오를수록 밝아진다 — 언제 튀는지 읽힌다.
        const len = 900
        const k = ACCENT * tel
        for (let s = 0; s < 22; s++) {
          const f = s / 22
          b.push(
            x + boss.dirX * len * f, y + boss.dirY * len * f,
            size * 0.5 * (1 - f * 0.5), Math.atan2(boss.dirY, boss.dirX),
            k, k * 0.28, 0.1, 1, Shape.Spark,
          )
        }
        break
      }
      case BossState.Charge: {
        // 돌진 중엔 앞이 타오른다
        b.push(
          x + boss.dirX * size, y + boss.dirY * size, size * 1.2,
          Math.atan2(boss.dirY, boss.dirX), ACCENT * 1.4, 0.7, 0.2, 1, Shape.Comet,
        )
        break
      }
      case BossState.Stagger: {
        // 빈틈 — 초록으로 "지금 때려라"
        const p = 0.7 + Math.sin(t * 12) * 0.3
        b.push(x, y, size * 1.9, -t * 2, 0.2 * p, ACCENT * p, 0.4 * p, 1, Shape.Ring)
        break
      }
      case BossState.Summon: {
        const p = ACCENT * tel
        b.push(x, y, size * (1.4 + tel * 1.2), t * 4, p, p * 0.4, 0.15, 1, Shape.Sigil)
        break
      }
      case BossState.Collapse: {
        // 좁혀오는 링. 이게 안 보이면 그냥 알 수 없는 피해다.
        // 유예 동안은 어둡게(경고), 물기 시작하면 밝게 — "지금부터 아프다"가 읽혀야 한다.
        const R = boss.ringR
        const seg = 56
        const bite = boss.collapseArmed() ? 1 : 0.45
        for (let s = 0; s < seg; s++) {
          const a = (s / seg) * Math.PI * 2
          b.push(
            boss.ringX + Math.cos(a) * R, boss.ringY + Math.sin(a) * R,
            13, a, ACCENT * bite, 0.3 * bite, 0.16 * bite, 1, Shape.Orb,
          )
        }
        break
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
    gen = 0,
  ): void {
    const n = this.foesInRadius(x, y, radius, this.blastBuf)
    // 이 폭발이 몇 세대인지 알려 준다 — 여기서 죽은 적이 반향을 낳으면 gen+1 을 받는다.
    // 예전엔 여기서 echoDepth 를 ++/-- 했는데, 그건 "반향 연쇄 깊이"가 아니라
    // "임의의 폭발 안인가"를 재고 있었다. 그래서 미진화 반향은 혜성·신문·특이점으로
    // 죽인 적에서 **절대 안 터졌고**(maxDepth 0 인데 depth 1), 진화 반향의 상한은
    // 한 번도 발동하지 않았다.
    const prevGen = this.echoGen
    this.echoGen = gen
    for (let k = 0; k < n; k++) {
      const j = this.blastBuf[k]!
      if (this.foes.alive[j] === 0) continue
      const dx = this.foes.x[j]! - x
      const dy = this.foes.y[j]! - y
      const d = Math.hypot(dx, dy) || 1
      this.damageFoe(j, damage, dx / d, dy / d)
    }
    this.echoGen = prevGen
    shockwave(this.motes, x, y, radius, cr, cg, cb, 0.4)
    burst(this.motes, x, y, 6, cr, cg, cb, radius * 2.4, 0.35, 4)
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
          smoke(this.motes, x, y, broke ? 3 : 1, 0.3, 0.24, 0.2, broke ? 12 : 7)
          if (broke) {
            this.camera.shake(1.6, 20)
            this.reapCache(x, y)
          }
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
        const rr = r + stat.radius * (j === this.boss.idx ? BOSS_SCALE : 1)
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
          spray(this.motes, x, y, -shots.vx[i]!, -shots.vy[i]!, 1.6, 2, FX_BASE * 1.4, FX_BASE, FX_BASE * 0.4, 170, 0.16, 2.6)
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
    // 보스 빈틈은 딜 기회다 — 피한 보상이 없으면 패턴을 읽을 이유가 없다
    if (j === this.boss.idx) dmg *= this.boss.damageScale()
    // 수정 어픽스 — 단단한 대신 보상이 크다 (killFoe 참고)
    if (foes.affix[j] === Affix.Prism) dmg *= 0.6
    if (this.rng.next() < s.critChance) dmg *= s.critMult

    foes.hp[j]! -= dmg
    foes.flash[j] = 0.09
    this.player.damageDealt += dmg
    this.sfx('hit')

    // 넉백 — 무게가 무거울수록 덜 밀린다. 장벽 어픽스는 아예 안 밀린다.
    if (foes.affix[j] !== Affix.Bulwark) {
      const stat = FOE_STATS[foes.type[j]!]!
      const kb = 240 * s.knockback * stat.weight
      const len = Math.hypot(fromVx, fromVy) || 1
      foes.pushX[j]! += (fromVx / len) * kb
      foes.pushY[j]! += (fromVy / len) * kb
    }

    if (foes.hp[j]! <= 0) this.killFoe(j)
  }

  private killFoe(j: number): void {
    const foes = this.foes
    const stat = FOE_STATS[foes.type[j]!]!
    const x = foes.x[j]!
    const y = foes.y[j]!
    const isBossKill = j === this.boss.idx && foes.stamp[j] === this.boss.stamp
    const affix = foes.affix[j]!

    // 화면에 2만 마리가 죽는 후반에 파티클을 그대로 뿌리면 풀이 순식간에 마른다.
    // 큰 적일수록 많이, 잔챙이는 적게.
    const big = stat.radius > 16
    // 후반엔 초당 수백 마리가 죽는다. 개당 파티클이 많으면 화면이 파티클로 뒤덮여
    // 정작 적이 안 보인다 — 잔챙이는 조각 몇 개면 충분하다.
    const n = big ? 9 : 3
    const k = FX_BASE
    burst(this.motes, x, y, n, stat.r * k, stat.g * k, stat.b * k, 190, 0.26, 3.4)
    if (big) shockwave(this.motes, x, y, stat.radius * 2.2, stat.r * k, stat.g * k, stat.b * k, 0.3)
    this.sfx(big ? 'bigKill' : 'kill')

    // 보스는 체력이 4~40배인데 XP 는 잡졸과 같았다 — 최적 플레이가 "보스 무시"였다
    // (적대 리뷰가 잡았다). 잡은 값어치가 있어야 고비가 된다.
    //
    // **총량이 한 레벨의 55%다. 오브당이 아니다.** 8로 나누지 않았을 때 보스 하나가
    // 한 레벨의 440%를 줬다 — reapCache 가 주석으로 반성한 그 착각(오브당 값 vs 총량)이
    // 여기서 그대로 재발해 있었다. "잡을 값어치"는 주되 "한 레벨을 넘지 않는다"는
    // 잔해의 원칙을 보스도 지킨다.
    if (isBossKill) {
      const chunk = (xpForLevel(this.player.level) * 0.55) / 8
      for (let k = 0; k < 8; k++) {
        const a = this.rng.next() * Math.PI * 2
        const sp = 90 + this.rng.next() * 180
        if (this.drops.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, chunk, Drop.Xp) < 0) {
          this.pendingLevels += this.player.gainXp(chunk * this.pactXp)
        }
      }
      this.drops.spawn(x, y, 0, 0, 60, Drop.Heal)
    } else {
      // 경제 반전 — 가치는 원반에 있다. 외곽 킬은 헐값(0.55배), 원반 대역 킬은
      // 최대 1.6배. 같은 적이라도 **어디서 잡느냐**가 소득이다: 안전한 외곽에서
      // 버티는 플레이는 가난해지고, 조류 속에서 싸우는 플레이가 부자가 된다.
      // 1막은 램프(외곽 0.85) — 시작점이 외곽이라 풀 반전이면 첫 수업(15초)이 굶는다.
      const floor = this.act === 0 ? 0.85 : 0.55
      const zoneMul = floor + diskBandAt(Math.hypot(x, y), this.holeR()) * (1.6 - floor)
      this.drops.spawn(
        x, y,
        (this.rng.next() - 0.5) * 60, (this.rng.next() - 0.5) * 60,
        // 어픽스는 단단한 만큼 값지다 — "저놈부터"의 보상
        (affix !== Affix.None ? stat.xp * 2.5 : stat.xp) * zoneMul, Drop.Xp,
      )
    }
    // 회복은 드물어야 긴장이 산다 (탐식 계약은 이걸 반으로 줄인다).
    // 1막만 1.8배 — 무기 1~2개 시절엔 회복 수단 자체가 뽑기라 바닥이 얇다.
    const healP = 0.006 * (this.act === 0 ? 1.8 : 1) * this.pactHeal
    if (this.rng.next() < healP) this.drops.spawn(x, y, 0, 0, 22, Drop.Heal)
    // 위기의 자비 — 확률은 정확히 필요한 순간에 안 온다 (필드 주석). rng 무소비.
    if (
      this.act === 0 && this.elapsed >= this.nextMercy &&
      this.player.hp < this.player.stats.maxHp * 0.32
    ) {
      this.nextMercy = this.elapsed + 12
      this.drops.spawn(x, y, 0, 0, 26, Drop.Heal)
    }

    foes.kill(j)
    this.player.kills++

    // 어픽스 정산 — 분열은 죽음이 곧 새 위협이고, 처치엔 확정 회복이 남는다
    if (affix === Affix.Brood) {
      const mhp = FOE_STATS[Foe.Mote]!.hp * ACTS[this.act]!.hp
      for (let k = 0; k < 6; k++) {
        const a = this.rng.next() * Math.PI * 2
        this.foes.spawn(x + Math.cos(a) * 28, y + Math.sin(a) * 28, Foe.Mote, mhp, this.rng.next())
      }
    }
    if (affix !== Affix.None) this.drops.spawn(x, y, 0, 0, 24, Drop.Heal)

    // 반향 — 내가 부순 자리에서 소리가 되돌아온다.
    // 슬롯은 캐시한다. 매 킬(후반 초당 수백)마다 find() 로 클로저를 만들고 6칸을
    // 스캔하면 hot path 에서 그냥 낭비다.
    if (this.echoSlot) echoKill(this.echoSlot, this, x, y, this.echoGen)
  }

  // ── 드랍 ─────────────────────────────────────────────────────────────

  private updateDrops(dt: number): void {
    const drops = this.drops
    const p = this.player
    const magnet = p.stats.magnet
    const magnet2 = magnet * magnet
    const pickup2 = (p.radius + 12) * (p.radius + 12)
    const hr = this.holeR()
    const surge = this.holeSurge()
    let leveled = 0

    for (let i = 0; i < drops.high; i++) {
      if (drops.alive[i] === 0) continue
      drops.age[i]! += dt

      // ── 블랙홀: 주인 없는 드랍은 나선을 그리며 중심으로 흘러가고, 끝내 삼켜진다.
      // "줍지 않으면 블랙홀이 먹는다" — 수확 타이밍이 결정이 되는 경제 압박.
      // 자석에 걸린 것(pulled)은 플레이어가 이기고, 성흔은 닻이라 흐르지 않는다.
      // 막 램프: 1막은 튜토리얼이라 거의 안 흐른다(earlygame 계약 — 첫 수업 15초).
      // 5막은 세게 흐른다 — 후반일수록 수확을 미루는 값이 비싸진다.
      if (drops.pulled[i] === 0 && drops.type[i] !== Drop.Vacuum) {
        const hx = drops.x[i]!
        const hy = drops.y[i]!
        const hd = Math.hypot(hx, hy) || 1
        if (hd < hr * 0.94) {
          drops.kill(i)
          continue
        }
        const ramp = 0.3 + this.act * 0.175
        const g = ((HOLE_PULL_DROP * hr * ramp) / hd) * surge * dt
        // 접선 성분이 나선을 만든다 — 직선 낙하는 블랙홀처럼 안 보인다
        drops.vx[i]! += (-hx / hd) * g * 0.8 + (-hy / hd) * g * 0.55
        drops.vy[i]! += (-hy / hd) * g * 0.8 + (hx / hd) * g * 0.55
        // 원반 대역 안에서는 조류가 지배한다 — XP 가 강물처럼 궤도를 돈다.
        // drag(3.4)를 보상한 가속이라 종단 속도가 조류 유속과 같아진다.
        // 막 램프(중력과 동일): 1막 0.3배 — 풀 유속이면 초반의 드문 드랍이 자석 밖으로
        // 도주해 첫 수업이 굶는다(실측: 킬 7에 xp 1.6 정체, 첫 레벨업 42초).
        const dband = diskBandAt(hd, hr)
        if (dband > 0) {
          const df = FLOW_MAX * dband * ramp * 3.4 * dt
          drops.vx[i]! += (-hy / hd) * df
          drops.vy[i]! += (hx / hd) * df
        }
      }

      const dx = p.x - drops.x[i]!
      const dy = p.y - drops.y[i]!
      const d2 = dx * dx + dy * dy

      /**
       * **수명.** 예전엔 획득으로만 죽었고 수명이 없었다.
       *
       * 킬이 초당 184인데 풀은 3,000 이고, 자석 밖에서 죽은 구슬은 9px 굴러가 영원히
       * 남는다. 전체 킬의 2%만 사거리 밖에서 나도 포화다. 포화되면:
       *  - 적을 아무리 죽여도 구슬이 안 나온다 (플레이어 눈엔 그냥 버그)
       *  - **잔해를 파도 보상이 0이다** — spawn 이 -1 을 반환하는데 아무도 안 본다.
       *    10초 걸려 판 대가가 "연출만".
       *  - 킬 → XP 연결이 끊긴다. XP 곡선을 네 번 고친 진짜 원인이 여기였을 수 있다.
       * (적대 리뷰가 잡았다.)
       *
       * 자석에 걸린 것은 안 죽는다 — 이미 오고 있으니 뺏으면 그게 더 억울하다.
       */
      // 성흔은 수명이 없다 — 판당 한둘뿐인 것이 조용히 증발하면 억울하다
      if (drops.pulled[i] === 0 && drops.age[i]! > DROP_LIFE && drops.type[i] !== Drop.Vacuum) {
        drops.kill(i)
        continue
      }

      if (drops.pulled[i] === 0 && d2 < magnet2) drops.pulled[i] = 1

      if (drops.pulled[i]! >= 1) {
        // 가까울수록 빨라진다 — 빨려 들어가는 손맛.
        // 2 = 성흔이 부른 것. 맵 반대편(~2600px)에서도 몇 초 안에 닿아야
        // "전부 날아온다"가 사건으로 느껴진다.
        const d = Math.sqrt(d2) || 1
        const boost = drops.pulled[i] === 2 ? 5 : 1
        const pull = (340 + (1 - Math.min(1, d / magnet)) * 900) * boost
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
          leveled += p.gainXp(drops.value[i]! * this.pactXp)
          this.sfx('pickup')
        } else if (type === Drop.Heal) {
          p.heal(drops.value[i]!)
          shockwave(this.motes, p.x, p.y, 40, 0.25, 1.4, 0.6, 0.35)
        } else if (type === Drop.Vacuum) {
          // 성흔 발동 — 맵의 모든 경험치가 날아온다
          this.vacuumOut = 0
          for (let k = 0; k < drops.high; k++) {
            if (drops.alive[k] === 1 && drops.type[k] === Drop.Xp) drops.pulled[k] = 2
          }
          shockwave(this.motes, p.x, p.y, 920, EVENT * 0.9, EVENT * 0.6, EVENT * 1.1, 1.2)
          this.camera.shake(13, 7)
          this.sfx('evolve')
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
      shockwave(this.motes, p.x, p.y, 70, 1.6, 1.35, 0.5, 0.5)
      burst(this.motes, p.x, p.y, 18, 1.6, 1.3, 0.45, 300, 0.6, 5, Shape.Star)
      this.camera.shake(5, 14)
      this.sfx('levelup')
    }
  }

  private onDeath(): void {
    this.phase = Phase.Dead
    this.sfx('death')
    // 죽는 순간은 세리머니다 — 여기선 밝아도 된다 (게임이 끝났으니 가릴 것도 없다)
    burst(this.motes, this.player.x, this.player.y, 70, EVENT, 0.5, 0.3, 420, 1.2, 9)
    shockwave(this.motes, this.player.x, this.player.y, 180, EVENT, 0.4, 0.3, 0.9)
    this.camera.shake(26, 5)
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────

  /**
   * fx 계열 쿼드의 유일한 출구. 광량을 장부에 적고(감광 전 수요), 광량 보존
   * 감광(크기)과 이번 프레임 감광(dim)을 곱해 민다. 적·지형·드랍·플레이어 같은
   * **정보 계열은 여기를 지나지 않는다** — 정보는 항상 이펙트 위여야 하니까.
   */
  private pushFx(
    b: SpriteBatch, cullR: number,
    x: number, y: number, size: number, rot: number,
    r: number, g: number, bl: number, a: number, shape: number,
    dim: number,
  ): void {
    const sp = SHAPE_SPARSE[shape]!
    // 화면 평균 광량 수요: 밝기 × (쿼드 면적 / 화면 면적). 0.5625 = 0.75²(모양 내접 근사)
    const q = (size / cullR) * (size / cullR) * 0.5625
    const bright = (r > g ? (r > bl ? r : bl) : g > bl ? g : bl) * a
    this.fxAcc += bright * (sp === 1 ? 0.3 : 1) * q
    /**
     * 프레임 내 누진 브레이크 — 지난 프레임 장부만 보면 폭발이 터진 **그 프레임**은
     * 무방비다(1프레임 지연 스파이크, 실측 p95 1.36). 같은 프레임 안에서 누적 수요가
     * 무릎(0.4)을 넘는 순간부터 이후 쿼드를 제곱으로 조인다. 제곱 감쇠의 적분은
     * 수렴하므로 **fx 층 총량이 수학적으로 유계다**: 0.4 + 1/2.2 ≈ 0.85.
     * 수요가 무한대여도 그 위로 못 간다 — 화이트아웃이 산수로 불가능해진다.
     */
    const brake = 1 + Math.max(0, this.fxAcc - 0.4) * 2.2
    const c = conserve(size, sp) * dim / (brake * brake)
    b.push(x, y, size, rot, r * c, g * c, bl * c, a, shape)
  }

  render(renderer: Renderer): void {
    const cam = this.camera
    const view = cam.toView(renderer.width, renderer.height)
    const t = this.visualTime

    // 이펙트 자동 감광 — 세 겹이다. 개별 밝기는 palette 위계가 지키지만 가법 블렌딩은
    // **겹침 수 × 크기**로도 화면을 태운다(세 번째 실플레이 보고까지 온 문제).
    //  ① 개수 부하: 입자·탄이 붐빌수록 (기존)
    //  ② 광량 폐루프: 지난 프레임 fx 의 광량 **수요**(감광 전)가 예산을 넘으면 초과분만큼.
    //     수요 기준이라 감광 결과에 되먹지 않는다 — 진동 없이 수렴한다.
    //  ③ 플래시 부하: 동시에 켜진 명중 플래시 수 — 광역기 한 방이 500마리를 치면
    //     개당 밝기와 무관하게 500개가 동시 점화되는 축.
    // 크기 축은 pushFx 의 광량 보존(palette.conserve)이 정적으로 막는다.
    // 한산하면 화려하게, 혼잡하면 차분하게 — 정보(적·나·지형)는 항상 이펙트 위다.
    const fxLoad = Math.min(1, this.motes.count / 14000 + this.shots.count / 2800)
    // over 는 bloom(calm)에만 쓴다 — fx 쿼드 자체는 pushFx 의 프레임 내 브레이크가
    // 지연 없이 조이므로, 여기서 또 곱하면 이중 처벌로 이펙트가 실종된다.
    const over = Math.max(0, this.fxLumPrev - 0.45)
    const fxDim = 1 - 0.5 * fxLoad
    const hitDim = Math.min(1, 48 / Math.max(1, this.flashPrev))
    // 군체 밀도 감광 — 최악 프레임 계측에서 화면을 태운 건 이펙트가 아니라 **적 몸
    // 그 자체**였다(Hex 몸 1.08 vs fx 전체 0.25). 가법 블렌딩에서는 몸도 빛이라
    // 밀집이 곧 백색이다. "전부 밝으면 아무것도 안 밝다"를 군체에도 적용한다 —
    // 수가 많을수록 기준선을 낮춘다. 종족 구분은 hue 가 하므로 판독은 산다.
    const foeDim = Math.min(1, 520 / Math.max(1, this.foesPrev))
    let drawnFoes = 0
    this.fxAcc = 0
    let flashCount = 0

    // 성운 색은 막을 따라 서서히 옮겨간다. 갑자기 바뀌면 이질적이라
    // 3막쯤에서 "언제 이렇게 붉어졌지"가 되는 게 목표다.
    const act = ACTS[this.act]!
    renderer.cosmos.lerpTint(act.tintA, act.tintB, 0.02)
    renderer.cosmos.intensity = Math.min(1, this.elapsed / RUN_SECONDS + this.act * 0.05)
    // 블랙홀은 배경 패스(cosmos)가 그린다 — 무블렌드 쓰기라 어둡게 할 수 있는
    // 유일한 층이고, 렌즈 왜곡·원반·광자 고리까지 셰이더 한 방이다.
    renderer.cosmos.holeR = this.holeR()
    // 심장박동을 광자 고리·원반에 싣는다. 박마다 얕게, 마디 첫 박에 깊게 —
    // 화면이 소리 없이도 박자를 가르친다 (무기 발사가 이 박자에 물려 있다).
    const beatEnv = Math.exp(-(this.beatClock % 1) * 4.5)
    const barPos = this.beatClock % 4
    const barEnv = barPos < 1 ? Math.exp(-barPos * 3) : 0
    renderer.cosmos.beat = beatEnv * 0.35 + barEnv * 0.65
    renderer.cosmos.feed = this.feeding() ? 1 : this.feedWarn() ? 0.45 : 0

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
        // 지형은 **절대 번지지 않는다**. 구조만 읽히면 된다 — 여기가 밝으면
        // 화면의 30%가 통째로 발광체가 된다.
        // 지형은 **절대 번지지 않고 채도도 없다**. 색이 있으면 적과 섞인다 —
        // 실제로 보라 지형과 보라 탱커가 구분이 안 됐다. 채도 있는 색은 적의 것이다.
        const v = TERRAIN_BASE * (0.5 + frac * 0.5)
        const tint = ter.tint[ci]! * 0.03
        b.push(wx, wy, CELL * 0.74, 0, v * 0.3, v * 0.3, v * 0.34, 1, Shape.Hex)
        b.push(
          wx, wy, CELL * 0.6, 0,
          (v + tint) * lit, (v + tint) * lit, (v * 1.1 + tint) * lit, 1,
          frac < 0.45 ? Shape.Crack : Shape.Hex,
        )
        // 잔해 표식 — **보여야 갈 이유가 된다**. 지형은 무채색이므로 여기만
        // 금색이면 멀리서도 "저기 뭔가 있다"가 읽힌다.
        if (ter.cache[ci] === 1) {
          const g2 = 0.55 + Math.sin(t * 3 + ci) * 0.25
          b.push(wx, wy, CELL * 0.34, t * 1.2, g2 * 1.5, g2 * 1.2, g2 * 0.2, 1, Shape.Star)
        }
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
        // 경계는 벽이지 조명이 아니다
        b.push(x, y, 34, a, 0.5 * pulse, 0.1 * pulse, 0.16 * pulse, 1, Shape.Orb)
      }
    }

    // 조류 가시화 — 원반은 흐르는 강이다. 입자 띠가 궤도를 돈다 (렌더 전용·결정적:
    // 반경은 황금비 산포 고정, 각속도는 시뮬과 같은 식 유속/반경 — 보이는 흐름이
    // 곧 물리다). pushFx 경유라 광량 예산·보존 감광을 그대로 받는다.
    {
      const hr2 = this.holeR()
      for (let k = 0; k < 128; k++) {
        const fr = hr2 * (DISK_IN + (DISK_OUT - DISK_IN) * ((k * 0.61803) % 1))
        const fb = diskBandAt(fr, hr2)
        if (fb <= 0.05) continue
        const ang = k * 2.399963 + t * ((FLOW_MAX * fb) / fr)
        const fx0 = Math.cos(ang) * fr
        const fy0 = Math.sin(ang) * fr
        const fdx = fx0 - cx
        const fdy = fy0 - cy
        if (fdx * fdx + fdy * fdy > cullR2) continue
        this.pushFx(
          b, cullR, fx0, fy0, 26 + fb * 22, ang + Math.PI * 0.5,
          0.5 * fb, 0.36 * fb, 0.18 * fb, 0.5, Shape.Spark, fxDim,
        )
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
        b.push(x, y, 7 * bob, t * 2, DROP_BASE * 0.25, DROP_BASE * 1.1, DROP_BASE * 1.35, 1, Shape.Orb)
      } else if (type === Drop.Heal) {
        // 회복은 드무니까 눈에 띄어도 된다
        b.push(x, y, 12 * bob, t * 1.4, 0.3, 1.5, 0.7, 1, Shape.Star)
      } else if (type === Drop.Vacuum) {
        // 성흔 — 판당 한둘뿐. 희귀한 것만 이 밝기를 쓸 자격이 있다 (EVENT 규칙).
        const pulse = 1 + Math.sin(t * 5 + drops.age[i]!) * 0.25
        b.push(x, y, 24 * pulse, -t * 0.8, 0.9, 0.35, 1.5, 1, Shape.Halo)
        b.push(x, y, 14 * bob, t * 2.2, EVENT * 0.85, 0.45, EVENT, 1, Shape.Sigil)
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

      const isBoss = i === this.boss.idx
      const stat = FOE_STATS[foes.type[i]!]!
      const flash = foes.flash[i]!
      // 맞은 순간 밝아진다. 이거 하나로 타격감이 사는데, 배율이 크면 후반에
      // 초당 수천 번 터져서 화면이 하얘진다 — ACCENT 안에서만 놀고, 붐비면 더 줄인다.
      // hitDim: 광역기가 수백 마리를 **동시에** 칠 때는 동시 점화 수 자체를 조인다.
      if (flash > 0) flashCount++
      // 배율 3.5 → 2.4: hitDim 은 지난 프레임 기준이라 광역기 일제 명중의 **첫**
      // 프레임은 무방비다 — 베이스 자체가 그 한 프레임을 버틸 수 있어야 한다.
      const hit = flash > 0 ? 1 + flash * (ACCENT * 2.4) * fxDim * hitDim : 1
      const hpFrac = foes.hp[i]! / foes.maxHp[i]!
      // 피가 닳으면 어두워진다 — 체력바 없이 상태를 읽게
      const dim = 0.45 + hpFrac * 0.55
      // 불타는 적은 주황으로 물든다. 장작불 빌드가 화면에 보여야 재미가 있다.
      const fire = foes.burn[i]! > 0 ? 1 : 0
      const size = isBoss ? stat.radius * BOSS_SCALE : stat.radius
      const affix = foes.affix[i]!
      // 유사 3D: 큰 것에만 접지 그림자 — 잔챙이 2만에 다 깔면 바닥이 그림자로 찬다.
      if (isBoss || stat.radius >= 16 || affix > 0) {
        renderer.shadows.push(x, y - size * 0.45, size * 1.02, 0, 0, 0, 0.045, 0.42, Shape.Orb)
      }
      // 대시 중인 Husk 는 살짝 떠오른다 — 도약이 평면 미끄러짐으로 안 보이게 (렌더 전용)
      let drawY = y
      if (foes.type[i] === Foe.Husk) {
        const dashSp = Math.hypot(foes.vx[i]!, foes.vy[i]!)
        if (dashSp > 260) drawY = y + Math.min(9, (dashSp - 260) * 0.045)
      }
      drawnFoes++
      // 보스는 하나뿐이라 밝아도 안전하다. 잡졸은 기준선을 지키고, 붐비면 함께 낮춘다.
      const lum = (isBoss ? ACCENT : FOE_BASE * foeDim) * hit * dim
      b.push(
        x, drawY, size, foeRotation(foes, i, t),
        (stat.r + fire * 0.85) * lum,
        (stat.g + fire * 0.3) * lum,
        stat.b * (1 - fire * 0.55) * lum,
        1,
        stat.shape,
      )
      // 어픽스 링 — 종류가 색으로 즉시 읽혀야 "저놈부터"가 된다
      if (affix > 0) {
        const ac = AFFIX_COLORS[affix]!
        b.push(x, drawY, size * 1.5, t * 1.7, ac[0]! * dim, ac[1]! * dim, ac[2]! * dim, 1, Shape.Ring)
      }
      // 보스는 화면에서 즉시 구분돼야 한다 — 왕관과 도는 광륜
      if (isBoss) {
        b.push(x, y, size * 1.5, t * 0.7, 1.6, 0.9, 0.28, 1, Shape.Halo)
        b.push(x, y + size * 1.3, size * 0.7, Math.sin(t * 2) * 0.12, 1.9, 1.4, 0.5, 1, Shape.Crown)
        this.drawBossTells(b, x, y, size, t)
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
      // 진화탄만 1.0 을 넘긴다 — "진화했다"를 화면으로 알리는 유일한 수단이라
      // 특권을 여기 몰아준다. 단 탄막이 붐비면 특권도 줄인다 — 수백 발이 동시에
      // 번지면 특권이 아니라 공해다.
      const k = evo ? ACCENT * (1 - 0.4 * fxLoad) : SHOT_BASE
      const cr = def.r * k
      const cg = def.g * k
      const cb = def.b * k
      const rad = shots.radius[i]!
      // 잔상은 공통, 본체는 무기가 정한 모양. WeaponDef.shape 를 아무도 안 읽어서
      // 무기 6종의 탄이 전부 똑같은 구슬이었다.
      // 잔상은 fx(감광 대상), 본체는 정보 쪽이지만 범위 스탯으로 커지므로
      // 광량 보존(크기 감광)은 태운다 — 거대 혜성 하나가 화면 한 켠을 태우면 안 된다.
      this.pushFx(b, cullR, x, y, rad * 2.5, rot, cr * 0.5, cg * 0.5, cb * 0.5, 1, Shape.Spark, fxDim)
      this.pushFx(b, cullR, x, y, rad * 1.25, rot, cr, cg, cb, 1, def.shape, 1)
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
      this.pushFx(
        b, cullR, x, y, size, motes.rot[i]!,
        motes.r[i]! * frac, motes.g[i]! * frac, motes.b[i]! * frac, frac,
        shape, fxDim,
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
          const k = FIELD_BASE
          this.pushFx(b, cullR, x, y, r * 0.55 * pulse, spin, k * 1.1, k * 0.35, k * 2.2, 1, Shape.Singularity, fxDim)
          this.pushFx(b, cullR, x, y, r * 0.95, -spin * 0.5, k * 0.5, k * 0.15, k * 1.1, 1, Shape.Vortex, fxDim)
          if (evo) {
            // 삼킨 만큼 밝아진다 — 곧 터진다는 신호. 이건 경고라 밝아도 된다.
            const charge = Math.min(1, f.charge[i]! * 0.02)
            this.pushFx(b, cullR, x, y, r * 0.4 * (1 + charge), spin * 2, ACCENT * charge, 0.4 * charge, ACCENT * 1.2 * charge, 1, Shape.Nova, fxDim)
          }
          break
        }
        case Field.Sigil: {
          // 문양은 바닥에 새겨진 것이라 옅어야 한다 — 밝게 그렸더니 화면 중앙이
          // 흰 링으로 덮여서 적이 안 보였다.
          const a = FIELD_BASE * (0.5 + frac * 0.5)
          this.pushFx(b, cullR, x, y, r * 1.1, seed * 6.283 + t * 0.4, a * 1.5, a * 1.25, a * 0.3, 1, Shape.Sigil, fxDim)
          if (evo) this.pushFx(b, cullR, x, y, r * 0.5, -t * 1.2, a * 1.7, a * 1.4, a * 0.35, 1, Shape.Rune, fxDim)
          break
        }
        case Field.Still: {
          // 정지장은 시간이 멎은 느낌이라 아주 천천히 돈다
          const a = FIELD_BASE * (0.6 + frac * 0.6)
          this.pushFx(b, cullR, x, y, r * 1.05, t * 0.25 + seed, a * 0.3, a * 0.9, a * 1.9, 1, Shape.Halo, fxDim)
          this.pushFx(b, cullR, x, y, r * 0.7, -t * 0.18, a * 0.2, a * 0.6, a * 1.5, 1, Shape.Ring, fxDim)
          break
        }
        case Field.Echo: {
          const grow = 2 - frac
          this.pushFx(b, cullR, x, y, r * grow, seed * 6.283, FIELD_BASE * 0.5 * frac, FIELD_BASE * 1.6 * frac, FIELD_BASE * 2.0 * frac, 1, Shape.Rift, fxDim)
          break
        }
      }
    }

    // 플레이어 — 마지막에 그려서 무슨 일이 있어도 자기 캐릭터는 보이게.
    // 꺼져가는 별의 마지막 불씨: 씨앗 코어 + 도는 광륜.
    const p = this.player
    if (p.alive) {
      const inv = p.invuln > 0 ? 0.45 + Math.sin(t * 40) * 0.3 : 1
      // 화면에서 제일 밝다. 하나뿐이라 안전하고, **내가 어디 있는지는 절대 잃으면 안 된다** —
      // 적 2,000마리 사이에서 묻히면 그 순간 게임을 할 수 없다.
      // 광륜(느린 회전) + 씨앗 코어(빠른 역회전) + 십자 섬광. 셋 다 다른 속도로 돌아서
      // 정적인 적 무리 속에서 유일하게 "살아 있는" 것으로 읽힌다.
      // 유사 3D: 이동 중 살짝 떠오르고(hop), 그림자는 지면에 남는다 — 접지감의 핵심
      const hop = Math.abs(p.vx) + Math.abs(p.vy) > 20 ? Math.abs(Math.sin(t * 11)) * 5 : 0
      renderer.shadows.push(p.x, p.y - 13, 30, 0, 0, 0, 0.05, 0.5, Shape.Orb)
      const py = p.y + hop
      // 광륜이 심장박동에 맞춰 살짝 부푼다 — 내 몸이 메트로놈이다
      b.push(p.x, py, 42 * (1 + 0.12 * barEnv), t * 0.5, 0.5 * inv, 0.85 * inv, 1.7 * inv, 1, Shape.Halo)
      b.push(p.x, py, 26, -t * 1.4, PLAYER_BASE * inv, PLAYER_BASE * 0.85 * inv, PLAYER_BASE * 1.2 * inv, 1, Shape.Seed)
      b.push(p.x, py, 15, t * 3.1, PLAYER_BASE * 1.3 * inv, PLAYER_BASE * 1.3 * inv, PLAYER_BASE * 1.3 * inv, 1, Shape.Nova)

      // 목숨과 관련된 건 전부 몸에 붙인다 — 시선이 이미 거기 있으니까.
      // 좌상단 8px "HP 49%" 는 후반에 아무도 안 읽는다.
      drawHealthRing(b, p.x, py, p.hp / p.stats.maxHp, t)
      drawXpArc(b, p.x, py, p.xp / p.xpNeeded)

      // 화면 밖 보스 — 어디서 오는지 모르면 "갑자기 죽었다"가 된다
      if (this.boss.idx >= 0 && foes.alive[this.boss.idx] === 1) {
        drawOffscreenMarker(
          b, cam.x, cam.y, 1 / view.sx, 1 / view.sy,
          foes.x[this.boss.idx]!, foes.y[this.boss.idx]!,
          ACCENT, 0.5, 0.2, t,
        )
      }
    }

    // 체력 30% 아래부터 화면이 조여든다. 숫자를 읽지 않아도 "죽는다"가 느껴져야 한다.
    const hpFrac = p.alive ? p.hp / p.stats.maxHp : 0
    const danger = p.alive ? Math.max(0, 1 - hpFrac / 0.3) : 0
    // 다음 프레임의 감광이 먹을 장부 마감. bloom(calm)도 광량 초과분만큼 함께 죽인다 —
    // 씬이 이미 밝은데 bloom 이 그 위에 또 얹히면 감광이 헛돈다.
    this.fxLumPrev = this.fxAcc
    this.flashPrev = flashCount
    this.foesPrev = drawnFoes
    renderer.end(t, p.hurtFlash, danger, Math.min(1 - 0.6 * fxLoad, 1 / (1 + over * 2.4)))
  }
}
