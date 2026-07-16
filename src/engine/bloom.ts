/**
 * HDR bloom + 톤매핑 포스트 체인.
 *
 * 다운샘플 체인 → 텐트 필터 업샘플(COD 방식). 단순 가우시안 두 번보다 훨씬 넓고
 * 부드럽게 번지면서 파이어플라이(단일 밝은 픽셀이 깜빡이는 것)가 덜 생긴다.
 * 이 게임 룩의 대부분이 여기서 나온다.
 */
import {
  createFullscreenTriangle,
  createProgram,
  createRenderTarget,
  type GL,
  type Program,
  type RenderTarget,
} from './gl'

const MIPS = 5

const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec3 u_curve;    // threshold-knee, knee*2, 0.25/knee
uniform float u_threshold;

void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float br = max(c.r, max(c.g, c.b));
  // 소프트 니 — 임계값 근처에서 딱 끊기지 않게
  float rq = clamp(br - u_curve.x, 0.0, u_curve.y);
  rq = rq * rq * u_curve.z;
  float contrib = max(rq, br - u_threshold) / max(br, 1e-5);
  fragColor = vec4(c * contrib, 1.0);
}`

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_texel;

// 13-tap 다운샘플. 박스 4-tap 보다 계단과 깜빡임이 훨씬 적다.
void main() {
  vec2 t = u_texel;
  vec3 a = texture(u_src, v_uv + t * vec2(-2, 2)).rgb;
  vec3 b = texture(u_src, v_uv + t * vec2( 0, 2)).rgb;
  vec3 c = texture(u_src, v_uv + t * vec2( 2, 2)).rgb;
  vec3 d = texture(u_src, v_uv + t * vec2(-2, 0)).rgb;
  vec3 e = texture(u_src, v_uv).rgb;
  vec3 f = texture(u_src, v_uv + t * vec2( 2, 0)).rgb;
  vec3 g = texture(u_src, v_uv + t * vec2(-2,-2)).rgb;
  vec3 h = texture(u_src, v_uv + t * vec2( 0,-2)).rgb;
  vec3 i = texture(u_src, v_uv + t * vec2( 2,-2)).rgb;
  vec3 j = texture(u_src, v_uv + t * vec2(-1, 1)).rgb;
  vec3 k = texture(u_src, v_uv + t * vec2( 1, 1)).rgb;
  vec3 l = texture(u_src, v_uv + t * vec2(-1,-1)).rgb;
  vec3 m = texture(u_src, v_uv + t * vec2( 1,-1)).rgb;

  vec3 res = e * 0.125;
  res += (a + c + g + i) * 0.03125;
  res += (b + d + f + h) * 0.0625;
  res += (j + k + l + m) * 0.125;
  fragColor = vec4(res, 1.0);
}`

const UP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_radius;

// 3x3 텐트 필터로 키워 올리며 더한다.
void main() {
  vec2 t = u_texel * u_radius;
  vec3 res = texture(u_src, v_uv + t * vec2(-1,  1)).rgb * 1.0;
  res += texture(u_src, v_uv + t * vec2( 0,  1)).rgb * 2.0;
  res += texture(u_src, v_uv + t * vec2( 1,  1)).rgb * 1.0;
  res += texture(u_src, v_uv + t * vec2(-1,  0)).rgb * 2.0;
  res += texture(u_src, v_uv).rgb * 4.0;
  res += texture(u_src, v_uv + t * vec2( 1,  0)).rgb * 2.0;
  res += texture(u_src, v_uv + t * vec2(-1, -1)).rgb * 1.0;
  res += texture(u_src, v_uv + t * vec2( 0, -1)).rgb * 2.0;
  res += texture(u_src, v_uv + t * vec2( 1, -1)).rgb * 1.0;
  fragColor = vec4(res * (1.0 / 16.0), 1.0);
}`

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomStrength;
uniform float u_time;
uniform float u_hurt;       // 피격 플래시 0..1
uniform float u_aberration;
uniform float u_grain;
uniform float u_vignette;

// ACES 필름 톤매퍼 근사 (Narkowicz 2015). HDR 을 눈에 맞게 눌러 준다.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = v_uv;
  vec2 fromCenter = uv - 0.5;
  float r2 = dot(fromCenter, fromCenter);

  // 색수차 — 화면 가장자리로 갈수록 채널이 어긋난다. 피격 시 더 심해진다.
  float ab = u_aberration * (0.4 + u_hurt * 1.4) * r2;
  vec3 scene;
  if (ab > 0.0001) {
    scene.r = texture(u_scene, uv - fromCenter * ab).r;
    scene.g = texture(u_scene, uv).g;
    scene.b = texture(u_scene, uv + fromCenter * ab).b;
  } else {
    scene = texture(u_scene, uv).rgb;
  }

  vec3 bloom = texture(u_bloom, uv).rgb;
  vec3 color = scene + bloom * u_bloomStrength;

  // 피격 시 붉게 물듦. 화면 전체를 덮으면 정작 피해야 할 적이 안 보이므로
  // 가장자리(비네트 쪽)만 강하게 물들이고 가운데는 살려 둔다.
  float hurtMask = u_hurt * (0.16 + smoothstep(0.02, 0.22, r2) * 0.46);
  color = mix(color, vec3(1.5, 0.1, 0.08), hurtMask);

  color = aces(color);

  // 비네트
  float vig = 1.0 - u_vignette * smoothstep(0.18, 0.85, r2);
  color *= vig;

  // 필름 그레인 — 어두운 부분에만. 평평한 검정이 디지털처럼 죽는 걸 막는다.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float g = (hash(uv * 1024.0 + fract(u_time) * 137.0) - 0.5) * u_grain;
  color += g * (1.0 - smoothstep(0.0, 0.6, lum));

  fragColor = vec4(max(color, 0.0), 1.0);
}`

export interface BloomSettings {
  threshold: number
  knee: number
  strength: number
  radius: number
  aberration: number
  grain: number
  vignette: number
}

export const DEFAULT_BLOOM: BloomSettings = {
  threshold: 0.72,
  knee: 0.45,
  strength: 1.15,
  radius: 1.0,
  aberration: 0.02,
  grain: 0.055,
  vignette: 0.62,
}

export class BloomPass {
  private readonly gl: GL
  private readonly tri: WebGLVertexArrayObject
  private readonly bright: Program
  private readonly down: Program
  private readonly up: Program
  private readonly composite: Program
  private mips: RenderTarget[] = []
  private readonly fmt: { internal: number; format: number; type: number }
  private width = 0
  private height = 0

  settings: BloomSettings = { ...DEFAULT_BLOOM }

  constructor(gl: GL, hdr: boolean) {
    this.gl = gl
    this.tri = createFullscreenTriangle(gl)
    this.bright = createProgram(gl, VS, BRIGHT_FS, 'bloom-bright')
    this.down = createProgram(gl, VS, DOWN_FS, 'bloom-down')
    this.up = createProgram(gl, VS, UP_FS, 'bloom-up')
    this.composite = createProgram(gl, VS, COMPOSITE_FS, 'bloom-composite')
    this.fmt = hdr
      ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return
    const gl = this.gl
    for (const rt of this.mips) {
      gl.deleteFramebuffer(rt.fbo)
      gl.deleteTexture(rt.tex)
    }
    this.mips = []
    let w = width
    let h = height
    for (let i = 0; i < MIPS; i++) {
      w = Math.max(1, w >> 1)
      h = Math.max(1, h >> 1)
      this.mips.push(
        createRenderTarget(gl, w, h, this.fmt.internal, this.fmt.format, this.fmt.type, gl.LINEAR),
      )
    }
    this.width = width
    this.height = height
  }

  private blit(rt: RenderTarget | null, viewW: number, viewH: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fbo : null)
    gl.viewport(0, 0, viewW, viewH)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /**
   * sceneTex(HDR) 를 받아 최종 화면(기본 프레임버퍼)에 합성한다.
   * hurt 는 0..1 피격 강도, time 은 그레인 애니메이션용.
   */
  render(sceneTex: WebGLTexture, screenW: number, screenH: number, time: number, hurt: number): void {
    const gl = this.gl
    const s = this.settings
    gl.disable(gl.BLEND)
    gl.bindVertexArray(this.tri)

    // 1) 밝은 부분만 뽑아 mip0 으로
    const m0 = this.mips[0]!
    gl.useProgram(this.bright.handle)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sceneTex)
    gl.uniform1i(this.bright.uniforms['u_src']!, 0)
    gl.uniform1f(this.bright.uniforms['u_threshold']!, s.threshold)
    gl.uniform3f(
      this.bright.uniforms['u_curve']!,
      s.threshold - s.knee,
      s.knee * 2.0,
      0.25 / Math.max(s.knee, 1e-4),
    )
    this.blit(m0, m0.width, m0.height)

    // 2) 다운샘플 체인
    gl.useProgram(this.down.handle)
    gl.uniform1i(this.down.uniforms['u_src']!, 0)
    for (let i = 1; i < this.mips.length; i++) {
      const src = this.mips[i - 1]!
      const dst = this.mips[i]!
      gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.uniform2f(this.down.uniforms['u_texel']!, 1 / src.width, 1 / src.height)
      this.blit(dst, dst.width, dst.height)
    }

    // 3) 텐트 업샘플 — 가법으로 아래 mip 에 누적
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(this.up.handle)
    gl.uniform1i(this.up.uniforms['u_src']!, 0)
    gl.uniform1f(this.up.uniforms['u_radius']!, s.radius)
    for (let i = this.mips.length - 1; i > 0; i--) {
      const src = this.mips[i]!
      const dst = this.mips[i - 1]!
      gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.uniform2f(this.up.uniforms['u_texel']!, 1 / src.width, 1 / src.height)
      this.blit(dst, dst.width, dst.height)
    }
    gl.disable(gl.BLEND)

    // 4) 최종 합성 → 화면
    gl.useProgram(this.composite.handle)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sceneTex)
    gl.uniform1i(this.composite.uniforms['u_scene']!, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, m0.tex)
    gl.uniform1i(this.composite.uniforms['u_bloom']!, 1)
    gl.uniform1f(this.composite.uniforms['u_bloomStrength']!, s.strength)
    gl.uniform1f(this.composite.uniforms['u_time']!, time)
    gl.uniform1f(this.composite.uniforms['u_hurt']!, hurt)
    gl.uniform1f(this.composite.uniforms['u_aberration']!, s.aberration)
    gl.uniform1f(this.composite.uniforms['u_grain']!, s.grain)
    gl.uniform1f(this.composite.uniforms['u_vignette']!, s.vignette)
    this.blit(null, screenW, screenH)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindVertexArray(null)
  }
}
