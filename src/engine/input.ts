/**
 * 입력. 이 게임의 조작은 "이동"뿐이다 — 그래서 여기가 작아야 정상이다.
 *
 * 세 가지 입력이 같은 벡터로 수렴한다: 키보드 / 마우스 홀드 / 터치 드래그.
 * 무엇을 잡든 튜토리얼 없이 3초 안에 움직일 수 있어야 한다.
 */
export interface MoveVector {
  x: number
  y: number
}

export class Input {
  private readonly keys = new Set<string>()
  private pointerActive = false
  private pointerX = 0
  private pointerY = 0
  private touchOriginX = 0
  private touchOriginY = 0
  private touchMode = false
  private readonly canvas: HTMLCanvasElement

  readonly move: MoveVector = { x: 0, y: 0 }
  /** 수직(z) 이동 — 스페이스 +1(상승) / 시프트 -1(하강). 키보드 전용, 터치는 수평 유지 */
  lift = 0
  /** 이번 프레임에 새로 눌린 키 (엣지 검출) */
  private readonly pressed = new Set<string>()
  /** 이번 프레임에 새로 눌린 포인터 (엣지). 터치 재시작 등 키보드 없는 기기의 UI 용. */
  private pointerPressed = false

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    const k = e.key.toLowerCase()
    this.keys.add(k)
    this.pressed.add(k)
    // 방향키·스페이스가 페이지를 스크롤하는 걸 막는다.
    if (SCROLL_KEYS.has(k)) e.preventDefault()
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase())
  }

  private readonly onBlur = () => {
    // 창을 벗어나면 키가 눌린 채로 남아 캐릭터가 혼자 달린다.
    this.keys.clear()
    this.pointerActive = false
    this.touchMode = false
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    this.pointerActive = true
    this.pointerPressed = true
    this.touchMode = e.pointerType === 'touch'
    this.pointerX = e.clientX
    this.pointerY = e.clientY
    this.touchOriginX = e.clientX
    this.touchOriginY = e.clientY
    this.canvas.setPointerCapture(e.pointerId)
  }

  private readonly onPointerMove = (e: PointerEvent) => {
    this.pointerX = e.clientX
    this.pointerY = e.clientY
  }

  private readonly onPointerUp = (e: PointerEvent) => {
    this.pointerActive = false
    this.touchMode = false
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId)
    }
  }

  private readonly onContextMenu = (e: Event) => e.preventDefault()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown, { passive: false })
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('contextmenu', this.onContextMenu)
  }

  // dispose() 가 있었지만 이 앱은 부팅이 곧 수명이라 호출부가 없어 지웠다 (#9).

  /** 매 프레임 시작에 1회. 세 입력을 하나의 이동 벡터로 합친다. */
  update(): void {
    let x = 0
    let y = 0
    const k = this.keys
    if (k.has('a') || k.has('arrowleft')) x -= 1
    if (k.has('d') || k.has('arrowright')) x += 1
    // 화면 좌표는 아래가 +y 지만 월드는 위가 +y 다. 여기서 한 번만 뒤집는다.
    if (k.has('w') || k.has('arrowup')) y += 1
    if (k.has('s') || k.has('arrowdown')) y -= 1
    this.lift = (k.has(' ') ? 1 : 0) - (k.has('shift') ? 1 : 0)

    if (x === 0 && y === 0 && this.pointerActive) {
      let dx: number
      let dy: number
      if (this.touchMode) {
        // 터치: 처음 짚은 곳이 원점인 가상 스틱
        dx = this.pointerX - this.touchOriginX
        dy = this.pointerY - this.touchOriginY
        const dead = 12
        const len = Math.hypot(dx, dy)
        if (len < dead) {
          dx = 0
          dy = 0
        }
      } else {
        // 마우스: 화면 중앙(=플레이어)에서 커서 쪽으로
        const r = this.canvas.getBoundingClientRect()
        dx = this.pointerX - (r.left + r.width * 0.5)
        dy = this.pointerY - (r.top + r.height * 0.5)
        if (Math.hypot(dx, dy) < 18) {
          dx = 0
          dy = 0
        }
      }
      x = dx
      y = -dy
    }

    const len = Math.hypot(x, y)
    if (len > 1e-4) {
      this.move.x = x / len
      this.move.y = y / len
    } else {
      this.move.x = 0
      this.move.y = 0
    }
  }

  /** update() 이후에 호출. 엣지 검출 소비. */
  consumePressed(key: string): boolean {
    const has = this.pressed.has(key)
    if (has) this.pressed.delete(key)
    return has
  }

  /** 이번 프레임의 포인터 탭/클릭 (엣지). 터치 기기의 재시작이 이걸 쓴다. */
  consumePointerPressed(): boolean {
    const has = this.pointerPressed
    this.pointerPressed = false
    return has
  }

  /** 지금 아무 입력이든 들어오고 있는가 — 타이틀의 "아무 키나 눌러 시작"용. */
  get anyInput(): boolean {
    return this.pressed.size > 0 || this.pointerActive
  }

  /** 마우스 홀드 중인가 (터치 제외) — 3D 조준 비행용 */
  get pointerHeld(): boolean {
    return this.pointerActive && !this.touchMode
  }

  get pointerCX(): number {
    return this.pointerX
  }

  get pointerCY(): number {
    return this.pointerY
  }

  endFrame(): void {
    this.pressed.clear()
    this.pointerPressed = false
  }

  // isDown/moving 게터가 있었지만 호출부 0이라 지웠다 (#9).
}

const SCROLL_KEYS = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'pagedown', 'pageup', 'home', 'end',
])
