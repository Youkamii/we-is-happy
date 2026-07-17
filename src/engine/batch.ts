/**
 * 인스턴싱 스프라이트 배치.
 *
 * 한 번의 드로우콜로 수만 개를 그린다. 인스턴스 하나당 9 float(36바이트)이고,
 * push() 는 프레임마다 수만 번 불리는 hot path 라 할당·분기가 없어야 한다.
 */
import { createProgram, GLError, type GL, type Program } from './gl'
import { ATLAS_COLS, type Atlas } from './shapes'

/** 인스턴스당 float 개수: posX, posY, size, rot, r, g, b, a, shape */
const STRIDE = 9
const STRIDE_BYTES = STRIDE * 4

export interface View {
  /** 월드 좌표 기준 카메라 중심 */
  x: number
  y: number
  /** 월드 → 클립 스케일 (종횡비 보정 포함) */
  sx: number
  sy: number
}

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_posSizeRot;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_shape;

uniform vec4 u_view;  // camX, camY, scaleX, scaleY
uniform float u_cols;

out vec2 v_uv;
out vec4 v_color;

void main() {
  float s = a_posSizeRot.z;
  float rot = a_posSizeRot.w;
  float c = cos(rot), sn = sin(rot);
  vec2 local = vec2(a_corner.x * c - a_corner.y * sn,
                    a_corner.x * sn + a_corner.y * c) * s;
  vec2 world = a_posSizeRot.xy + local;
  gl_Position = vec4((world - u_view.xy) * u_view.zw, 0.0, 1.0);

  float col = mod(a_shape, u_cols);
  float row = floor(a_shape / u_cols);
  v_uv = (vec2(col, row) + (a_corner * 0.5 + 0.5)) / u_cols;
  v_color = a_color;
}`

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_atlas;
out vec4 fragColor;

void main() {
  float mask = texture(u_atlas, v_uv).a;
  float a = mask * v_color.a;
  // 프리멀티플라이드 가법 합성. 이 게임의 모든 것은 빛이므로 알파 블렌딩은 쓰지 않는다.
  fragColor = vec4(v_color.rgb * a, a);
}`

export class SpriteBatch {
  private readonly gl: GL
  private readonly prog: Program
  private readonly vao: WebGLVertexArrayObject
  private readonly instanceVBO: WebGLBuffer
  private readonly data: Float32Array
  private readonly capacity: number
  private readonly atlas: Atlas
  private count = 0
  private view: View = { x: 0, y: 0, sx: 1, sy: 1 }
  private begun = false

  /** 이번 프레임에 용량 초과로 강제 flush 된 횟수. 0이 아니면 capacity 를 늘려야 한다. */
  overflows = 0

  /**
   * additive=false 면 프리멀티 알파 합성(어둡게 할 수 있다) — 그림자 패스 전용.
   * 본 배치는 가법(모든 것이 빛)이라 검은 쿼드가 불가능해서, 접지 그림자는
   * cosmos 와 본 배치 사이에 이 모드로 한 번 깔린다.
   */
  constructor(gl: GL, atlas: Atlas, capacity = 65536, private readonly additive = true) {
    this.gl = gl
    this.atlas = atlas
    this.capacity = capacity
    this.data = new Float32Array(capacity * STRIDE)
    this.prog = createProgram(gl, VS, FS, 'sprite-batch')

    const vao = gl.createVertexArray()
    const quadVBO = gl.createBuffer()
    const instVBO = gl.createBuffer()
    if (!vao || !quadVBO || !instVBO) throw new GLError('배치 버퍼 생성 실패')
    this.vao = vao
    this.instanceVBO = instVBO

    gl.bindVertexArray(vao)

    // 코너: TRIANGLE_STRIP 으로 도는 단위 quad
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    )
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, instVBO)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)

    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE_BYTES, 0)
    gl.vertexAttribDivisor(1, 1)

    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE_BYTES, 16)
    gl.vertexAttribDivisor(2, 1)

    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE_BYTES, 32)
    gl.vertexAttribDivisor(3, 1)

    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  begin(view: View): void {
    this.view = view
    this.count = 0
    this.overflows = 0
    this.begun = true
  }

  /**
   * hot path. 인자를 풀어 쓴 건 의도적이다 — 객체를 만들면 프레임당 수만 개가 GC 로 간다.
   * rgb 는 1.0 을 넘겨도 된다 (HDR). bloom 이 그 초과분을 먹고 빛난다.
   */
  push(
    x: number, y: number, size: number, rot: number,
    r: number, g: number, b: number, a: number,
    shape: number,
  ): void {
    if (this.count >= this.capacity) {
      // 버리지 않고 즉시 뱉는다. 드로우콜이 하나 늘 뿐 그림은 온전하다.
      this.flush()
      this.overflows++
    }
    const i = this.count * STRIDE
    const d = this.data
    d[i] = x
    d[i + 1] = y
    d[i + 2] = size
    d[i + 3] = rot
    d[i + 4] = r
    d[i + 5] = g
    d[i + 6] = b
    d[i + 7] = a
    d[i + 8] = shape
    this.count++
  }

  /** 쌓인 인스턴스를 GPU 로 보내고 그린다. */
  flush(): void {
    if (!this.begun) throw new GLError('begin() 없이 flush()')
    if (this.count === 0) return
    const gl = this.gl

    gl.useProgram(this.prog.handle)
    gl.uniform4f(this.prog.uniforms['u_view']!, this.view.x, this.view.y, this.view.sx, this.view.sy)
    gl.uniform1f(this.prog.uniforms['u_cols']!, ATLAS_COLS)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.tex)
    gl.uniform1i(this.prog.uniforms['u_atlas']!, 0)

    gl.enable(gl.BLEND)
    if (this.additive) gl.blendFunc(gl.ONE, gl.ONE)
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO)
    // subarray 를 만들지 않고 범위 업로드한다 (프레임당 할당 0).
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.bindVertexArray(null)

    this.count = 0
  }

  end(): void {
    this.flush()
    this.begun = false
  }

  get pending(): number {
    return this.count
  }
}
