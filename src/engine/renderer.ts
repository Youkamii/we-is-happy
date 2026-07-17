/**
 * 렌더 파이프라인 조립.
 *
 * 씬을 HDR 타깃에 그리고 → bloom 체인 → 톤매핑해서 화면에 뱉는다.
 * 게임 코드는 renderer.batch.push() 만 알면 된다.
 */
import { SpriteBatch, type View } from './batch'
import { BloomPass } from './bloom'
import { Cosmos } from './cosmos'
import {
  createRenderTarget,
  detectFloatTargets,
  resizeRenderTarget,
  type GL,
  type RenderTarget,
} from './gl'
import { bakeAtlas, type Atlas } from './shapes'

/**
 * 고해상도 디스플레이에서 물리 픽셀을 그대로 쓰면 4K에서 프래그먼트가 4배로 늘어
 * bloom 이 GPU 를 잡아먹는다. 선명함은 유지하면서 상한을 둔다.
 */
const MAX_DPR = 1.5

export class Renderer {
  readonly gl: GL
  readonly batch: SpriteBatch
  /**
   * 접지 그림자 전용 배치(프리멀티 알파 — 어둡게 할 수 있다).
   * cosmos 와 본 배치 사이에 깔린다. 본 배치는 가법이라 검은 쿼드가 불가능하다.
   */
  readonly shadows: SpriteBatch
  readonly bloom: BloomPass
  readonly cosmos: Cosmos
  readonly atlas: Atlas
  readonly hdr: boolean

  private scene: RenderTarget
  private readonly canvas: HTMLCanvasElement
  private readonly fmt: { internal: number; format: number; type: number }

  /** 드로잉 버퍼 크기(물리 픽셀) */
  width = 1
  height = 1

  constructor(canvas: HTMLCanvasElement, gl: GL) {
    this.canvas = canvas
    this.gl = gl

    const caps = detectFloatTargets(gl)
    this.hdr = caps.half
    this.fmt = this.hdr
      ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }

    this.atlas = bakeAtlas(gl)
    this.batch = new SpriteBatch(gl, this.atlas, 65536)
    this.shadows = new SpriteBatch(gl, this.atlas, 4096, false)
    this.bloom = new BloomPass(gl, this.hdr)
    this.cosmos = new Cosmos(gl)

    this.scene = createRenderTarget(
      gl, 1, 1, this.fmt.internal, this.fmt.format, this.fmt.type, gl.LINEAR,
    )
    this.resize()
  }

  /** CSS 크기 → 드로잉 버퍼 동기화. 매 프레임 불러도 싸다(변할 때만 일한다). */
  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (w === this.width && h === this.height) return false

    this.canvas.width = w
    this.canvas.height = h
    this.width = w
    this.height = h
    resizeRenderTarget(this.gl, this.scene, w, h, this.fmt.internal, this.fmt.format, this.fmt.type)
    this.bloom.resize(w, h)
    return true
  }

  /**
   * 씬 타깃을 열고 배경(성운·별)을 깐 뒤 배치를 연다.
   * cosmos 가 화면 전체를 덮으므로 clear 가 필요 없다.
   */
  begin(view: View, time: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo)
    gl.viewport(0, 0, this.width, this.height)
    // view.sx/sy 는 1/halfW, 1/halfH 다 — 역수를 취해 월드 반경을 되찾는다
    this.cosmos.render(view.x, view.y, 1 / view.sx, 1 / view.sy, time)
    this.shadows.begin(view)
    this.batch.begin(view)
  }

  /**
   * 배치를 뱉고 포스트 체인을 태워 화면에 올린다.
   * calm(0..1] 은 이번 프레임 bloom 강도 배율 — 화면이 이펙트로 붐빌수록 게임이
   * 낮춰 보낸다. settings.strength 를 직접 만지지 않는 이유: 콘솔 튜닝 값을
   * 매 프레임 덮어쓰면 안 되기 때문 (docs 의 실시간 조절 API).
   */
  end(time: number, hurt = 0, danger = 0, calm = 1): void {
    // 그림자가 먼저 깔리고, 그 위에 빛(가법 배치)이 쌓인다
    this.shadows.end()
    this.batch.end()
    this.bloom.render(this.scene.tex, this.width, this.height, time, hurt, danger, calm)
  }

  // aspect 게터가 있었지만 호출부 0이라 지웠다 (#9).
}
