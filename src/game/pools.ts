/**
 * 엔티티 저장소.
 *
 * 전부 SoA(Structure of Arrays)다. 적 2만 마리를 객체로 만들면 GC 가 매 프레임 멎는다.
 * 배열은 미리 잡고 재사용하며, 죽은 슬롯은 free 스택으로 돌려받는다.
 */

/** 죽은 슬롯을 재활용하는 고정 크기 풀의 공통 살림살이. */
class PoolBase {
  readonly capacity: number
  readonly alive: Uint8Array
  /** 지금까지 한 번이라도 쓴 슬롯의 상한. 순회는 여기까지만 돌면 된다. */
  high = 0
  private readonly free: Int32Array
  private freeTop = 0
  private liveCount = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.alive = new Uint8Array(capacity)
    this.free = new Int32Array(capacity)
  }

  /** 빈 슬롯 인덱스. 가득 찼으면 -1. */
  protected acquire(): number {
    let i: number
    if (this.freeTop > 0) {
      i = this.free[--this.freeTop]!
    } else if (this.high < this.capacity) {
      i = this.high++
    } else {
      return -1
    }
    this.alive[i] = 1
    this.liveCount++
    return i
  }

  kill(i: number): void {
    if (this.alive[i] === 0) return
    this.alive[i] = 0
    this.free[this.freeTop++] = i
    this.liveCount--
  }

  clear(): void {
    this.alive.fill(0)
    this.high = 0
    this.freeTop = 0
    this.liveCount = 0
  }

  get count(): number {
    return this.liveCount
  }
}

/** 적 종류. 인덱스가 곧 스탯 테이블 인덱스다. */
export const Foe = {
  Mote: 0, // 잔챙이. 느리고 약하고 많다.
  Husk: 1, // 돌진체. 빠르고 직선적.
  Hex: 2, // 탱커. 느리고 단단하다.
  Wisp: 3, // 궤도형. 플레이어 주위를 돈다.
  Eye: 4, // 엘리트. 드물고 아프다.
} as const
export type FoeType = (typeof Foe)[keyof typeof Foe]

export class Foes extends PoolBase {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly hp: Float32Array
  readonly maxHp: Float32Array
  readonly type: Uint8Array
  /** 피격 플래시 타이머 (초). 0보다 크면 하얗게 뜬다 — 이게 없으면 때리는 느낌이 안 난다. */
  readonly flash: Float32Array
  /** 넉백·상태이상으로 밀리는 속도. 자체 이동과 분리해야 밀린 뒤 제자리를 찾는다. */
  readonly pushX: Float32Array
  readonly pushY: Float32Array
  /** 화상 남은 시간과 초당 피해 */
  readonly burn: Float32Array
  readonly burnDps: Float32Array
  /**
   * 감속 배율 (1 = 정상). 정지장이 매 틱 덮어쓰고, 벗어나면 스스로 1로 돌아온다.
   * (예전에 이 필드가 있었지만 슬로우를 거는 무기가 없어 영원히 1이었다 — 적대 리뷰가
   *  "hot loop 안의 상수"라고 잡아 지웠고, W.Still 이 생기면서 되살아났다.)
   */
  readonly slow: Float32Array
  /** 피해 증폭 배율 (1 = 정상). 영겁(정지 진화)이 건다. */
  readonly frail: Float32Array
  readonly seed: Float32Array
  /**
   * 개체 고유 번호. **인덱스는 신원이 아니다** — acquire() 가 LIFO 라 죽은 슬롯을
   * 즉시 재사용하므로, 인덱스를 붙잡아 둔 쪽(보스 등)이 다음 스텝에 엉뚱한 개체를
   * 가리킬 수 있다. 실제로 잡졸이 보스 정체성을 상속하는 버그가 있었다.
   */
  readonly stamp: Int32Array
  private stampCounter = 1

  constructor(capacity: number) {
    super(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.vx = new Float32Array(capacity)
    this.vy = new Float32Array(capacity)
    this.hp = new Float32Array(capacity)
    this.maxHp = new Float32Array(capacity)
    this.type = new Uint8Array(capacity)
    this.flash = new Float32Array(capacity)
    this.pushX = new Float32Array(capacity)
    this.pushY = new Float32Array(capacity)
    this.burn = new Float32Array(capacity)
    this.burnDps = new Float32Array(capacity)
    this.slow = new Float32Array(capacity)
    this.frail = new Float32Array(capacity)
    this.seed = new Float32Array(capacity)
    this.stamp = new Int32Array(capacity)
  }

  spawn(x: number, y: number, type: FoeType, hp: number, seed: number): number {
    const i = this.acquire()
    if (i < 0) return -1
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = 0
    this.vy[i] = 0
    this.hp[i] = hp
    this.maxHp[i] = hp
    this.type[i] = type
    this.flash[i] = 0
    this.pushX[i] = 0
    this.pushY[i] = 0
    this.burn[i] = 0
    this.burnDps[i] = 0
    this.slow[i] = 1
    this.frail[i] = 1
    this.seed[i] = seed
    this.stamp[i] = this.stampCounter++
    return i
  }
}

export class Shots extends PoolBase {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly life: Float32Array
  readonly damage: Float32Array
  /** 남은 관통 횟수. 0이면 다음 명중에 사라진다. */
  readonly pierce: Float32Array
  readonly radius: Float32Array
  /** 이 탄을 쏜 무기 인덱스 — 색·모양·명중 효과가 여기서 갈린다. */
  readonly weapon: Uint8Array
  readonly seed: Float32Array
  /**
   * 탄마다 고유한 번호. 게임이 "이 탄이 이 적을 이미 때렸다"를 표시하는 데 쓴다.
   * 반드시 **탄 단위**여야 한다 — 스텝 단위로 발급하면 관통탄이 같은 적을 매 스텝
   * 다시 때려서 pierce 를 혼자 소진한다.
   */
  readonly stamp: Int32Array
  private stampCounter = 1

  constructor(capacity: number) {
    super(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.vx = new Float32Array(capacity)
    this.vy = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.damage = new Float32Array(capacity)
    this.pierce = new Float32Array(capacity)
    this.radius = new Float32Array(capacity)
    this.weapon = new Uint8Array(capacity)
    this.seed = new Float32Array(capacity)
    this.stamp = new Int32Array(capacity)
  }

  spawn(
    x: number, y: number, vx: number, vy: number,
    life: number, damage: number, pierce: number, radius: number,
    weapon: number, seed: number,
  ): number {
    const i = this.acquire()
    if (i < 0) return -1
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.damage[i] = damage
    this.pierce[i] = pierce
    this.radius[i] = radius
    this.weapon[i] = weapon
    this.seed[i] = seed
    // 0 은 "아직 아무도 안 때렸다"는 뜻으로 foeStamp 초기값과 겹치므로 1부터 센다.
    // 초당 4000×60 발을 쏴도 Int32 를 채우는 데 2.5시간이라 5분 런에선 오버플로 불가.
    this.stamp[i] = this.stampCounter++
    return i
  }
}

/** 파티클은 순수 연출이다. 시뮬레이션에 영향을 주면 안 된다(협동 동기화가 깨진다). */
export class Motes extends PoolBase {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly life: Float32Array
  readonly maxLife: Float32Array
  readonly size: Float32Array
  readonly r: Float32Array
  readonly g: Float32Array
  readonly b: Float32Array
  readonly shape: Uint8Array
  readonly spin: Float32Array
  readonly rot: Float32Array
  /** 감속 계수 (초당 남는 속도 비율) */
  readonly drag: Float32Array

  constructor(capacity: number) {
    super(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.vx = new Float32Array(capacity)
    this.vy = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity)
    this.size = new Float32Array(capacity)
    this.r = new Float32Array(capacity)
    this.g = new Float32Array(capacity)
    this.b = new Float32Array(capacity)
    this.shape = new Uint8Array(capacity)
    this.spin = new Float32Array(capacity)
    this.rot = new Float32Array(capacity)
    this.drag = new Float32Array(capacity)
  }

  spawn(
    x: number, y: number, vx: number, vy: number, life: number,
    size: number, r: number, g: number, b: number,
    shape: number, spin: number, rot: number, drag: number,
  ): number {
    const i = this.acquire()
    if (i < 0) return -1
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.maxLife[i] = life
    this.size[i] = size
    this.r[i] = r
    this.g[i] = g
    this.b[i] = b
    this.shape[i] = shape
    this.spin[i] = spin
    this.rot[i] = rot
    this.drag[i] = drag
    return i
  }
}

/**
 * 지속 효과체 — 중력정·신문·정지장·반향.
 *
 * 탄과 다른 풀인 이유: 이것들은 날아가지 않고 **자리에 남아** 매 틱 주변에 작용한다.
 * Shots 에 억지로 끼우면 "속도 0인 탄"이라는 거짓말이 되고, 거동 분기가 hot path 에 는다.
 */
export class Fields extends PoolBase {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly radius: Float32Array
  /** 효과 세기. 종류마다 의미가 다르다 (피해/초, 폭발 피해, 감속 배율). */
  readonly power: Float32Array
  readonly life: Float32Array
  readonly maxLife: Float32Array
  readonly kind: Uint8Array
  /** 중력정이 삼킨 양 — 특이점의 붕괴 판정에 쓴다 */
  readonly charge: Float32Array
  readonly seed: Float32Array
  /** 진화형인지 (거동이 갈린다) */
  readonly evolved: Uint8Array
  /**
   * 연쇄 세대. 반향이 반향을 낳을 때 1씩 오른다.
   *
   * **스택 깊이로는 못 센다.** 반향의 폭발은 필드가 만료된 뒤 다음 프레임에 새 스택으로
   * 일어나므로 호출 깊이는 항상 0~1 이었고, 그래서 상한(2+chain)이 **발동한 적이 없다**
   * (적대 리뷰가 잡았다 — 안전장치가 있다고 믿고 있었는데 없었다).
   * 세대는 필드에 실려야 스택을 넘어 살아남는다.
   */
  readonly gen: Uint8Array

  constructor(capacity: number) {
    super(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.radius = new Float32Array(capacity)
    this.power = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity)
    this.kind = new Uint8Array(capacity)
    this.charge = new Float32Array(capacity)
    this.seed = new Float32Array(capacity)
    this.evolved = new Uint8Array(capacity)
    this.gen = new Uint8Array(capacity)
  }

  spawn(
    kind: number, x: number, y: number,
    radius: number, power: number, life: number,
    evolved: boolean, seed: number, gen = 0,
  ): number {
    const i = this.acquire()
    if (i < 0) return -1
    this.kind[i] = kind
    this.x[i] = x
    this.y[i] = y
    this.radius[i] = radius
    this.power[i] = power
    this.life[i] = life
    this.maxLife[i] = life
    this.charge[i] = 0
    this.seed[i] = seed
    this.evolved[i] = evolved ? 1 : 0
    this.gen[i] = gen
    return i
  }
}

export const Drop = {
  Xp: 0,
  Heal: 1,
  /** 성흔 — 극히 드물게 떨어진다(판당 1~3개). 먹으면 맵의 모든 경험치가 날아온다. */
  Vacuum: 2,
} as const
export type DropType = (typeof Drop)[keyof typeof Drop]

export class Drops extends PoolBase {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly value: Float32Array
  readonly type: Uint8Array
  /** 자석에 걸린 상태 — 걸리면 플레이어에게 가속해서 날아온다 */
  readonly pulled: Uint8Array
  readonly age: Float32Array

  constructor(capacity: number) {
    super(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.vx = new Float32Array(capacity)
    this.vy = new Float32Array(capacity)
    this.value = new Float32Array(capacity)
    this.type = new Uint8Array(capacity)
    this.pulled = new Uint8Array(capacity)
    this.age = new Float32Array(capacity)
  }

  spawn(x: number, y: number, vx: number, vy: number, value: number, type: DropType): number {
    const i = this.acquire()
    if (i < 0) return -1
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.value[i] = value
    this.type[i] = type
    this.pulled[i] = 0
    this.age[i] = 0
    return i
  }
}
