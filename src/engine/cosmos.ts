/**
 * 심우주 배경 — 성운 + 시차 별밭.
 *
 * 순수 검정 배경은 우주가 아니라 공백이다. 별이 흐르고 성운이 도는 게 보여야
 * 내가 어딘가를 가로지르고 있다는 감각이 생긴다.
 *
 * 풀스크린 셰이더 1패스. 에셋 0 원칙 유지 — 별도, 성운도 전부 노이즈에서 나온다.
 * **순수 연출이다**: 시뮬레이션·결정론에 영향이 없다.
 */
import { createFullscreenTriangle, createProgram, type GL, type Program } from './gl'

const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_cam;      // 월드 좌표 카메라 중심
uniform vec2 u_halfSize; // 화면 절반이 덮는 월드 크기
uniform float u_time;
uniform float u_aspect;
uniform vec3 u_tintA;    // 성운 색 A (막마다 바뀐다)
uniform vec3 u_tintB;    // 성운 색 B
uniform float u_intensity; // 0..1 — 후반일수록 성운이 타오른다

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  vec3 a = fract(vec3(p.xyx) * vec3(123.34, 234.34, 345.65));
  a += dot(a, a + 34.45);
  return fract(vec2(a.x * a.y, a.y * a.z));
}

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
    mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x),
    u.y);
}

float fbm(vec2 p, int oct) {
  float v = 0.0, a = 0.5;
  // 회전을 섞으면 옥타브가 격자를 따라 정렬되는 걸 막는다 (축 정렬 무늬 방지)
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    v += a * valueNoise(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}

/**
 * 별 한 겹. 격자 셀마다 별 하나를 두고 셀 안에서 위치를 흔든다.
 *
 * p 는 이미 "셀 단위"로 들어온다 — 여기서 또 곱하면 셀이 화면보다 커져서
 * 별이 몇 개 없는 뿌연 솜뭉치가 된다(실측). 반경도 셀 크기에 비례해야 점으로 보인다.
 */
float starLayer(vec2 p, float twinkleSeed, float sharp) {
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  vec2 rnd = hash22(cell + twinkleSeed) - 0.5;
  // 셀의 일부만 별을 갖는다 — 전부 있으면 격자가 보인다
  float exists = step(0.62, hash21(cell * 1.37 + twinkleSeed));
  float d = length(f - rnd * 0.72);
  // 반짝임: 별마다 다른 위상
  float tw = 0.6 + 0.4 * sin(u_time * (1.1 + rnd.x * 2.4) + rnd.y * 40.0);
  float core = smoothstep(sharp, 0.0, d) * tw;
  float glow = smoothstep(sharp * 5.0, 0.0, d) * 0.2 * tw;
  return (core + glow) * exists;
}

void main() {
  // 화면 좌표 → 월드 좌표. 카메라가 움직이면 배경도 따라 흐른다.
  vec2 world = u_cam + v_uv * u_halfSize;

  vec3 col = vec3(0.006, 0.008, 0.018);

  // ── 성운: 아주 느리게 도는 fbm 두 겹.
  //
  // 좌표 스케일이 이 셰이더의 전부다. 월드 반경이 2600 이라 world*0.0009 로 잡으면
  // fbm 좌표가 0~2 범위 = 노이즈 셀 한두 개 안에 갇혀서 화면 전체가 균일한 값이 되고,
  // 성운이 통째로 안 보인다(실측). 화면 크기 기준으로 잡고 월드 위치는 시차로만
  // 더해야 "지나간다"는 감각이 생기면서 구조도 보인다.
  vec2 nUv = v_uv * vec2(u_aspect, 1.0) * 1.6 + u_cam * 0.00055;
  float n1 = fbm(nUv + vec2(u_time * 0.008, u_time * 0.005), 5);
  float n2 = fbm(nUv * 1.9 + vec2(-u_time * 0.011, u_time * 0.007) + 31.7, 4);
  // fbm 은 평균 0.5 근처에 몰린다. 두 층을 그냥 곱하고 pow 를 세게 걸면 결과가
  // 거의 0이라 성운이 아예 안 보인다(실측). 하나를 주 밀도로 쓰고 다른 하나로
  // 구멍을 뚫는 방식이 필라멘트를 만들면서 밝기를 유지한다.
  // 배경은 배경이어야 한다. 성운을 밝게 잡았더니 지형과 적을 덮어서 정작 피해야 할
  // 것이 안 보였다 — bloom 이 이 위에 또 얹히므로 여기 값은 아주 낮아야 한다.
  float density = smoothstep(0.42, 0.78, n1);
  float holes = smoothstep(0.28, 0.62, n2);
  float neb = density * (0.35 + holes * 0.65);
  vec3 nebCol = mix(u_tintA, u_tintB, clamp(n2 * 1.3, 0.0, 1.0));
  col += nebCol * neb * (0.16 + u_intensity * 0.34);

  // 성운 속 밝은 심(seam) — 필라멘트 가장자리가 빛난다
  float edge = pow(clamp(1.0 - abs(n1 - 0.58) * 11.0, 0.0, 1.0), 2.0);
  col += nebCol * edge * (0.09 + u_intensity * 0.2);

  // ── 별: 3겹 시차. 가까운 겹일수록 빠르게 흐른다(스케일이 크다 = 셀이 촘촘하다).
  float stars = 0.0;
  stars += starLayer(world * 0.022, 0.0, 0.045);   // 가깝다 — 빠르고 굵다
  stars += starLayer(world * 0.011, 7.3, 0.03) * 0.7;
  stars += starLayer(world * 0.006, 19.1, 0.022) * 0.45; // 멀다 — 느리고 잘다
  // 별빛은 살짝 푸르게, 성운 안에서는 가려진다
  col += vec3(0.8, 0.88, 1.0) * stars * (1.0 - neb * 0.35) * 1.3;

  // ── 비네트 대신 아주 옅은 중심 발광 (플레이어가 있는 곳)
  float r = length(v_uv * vec2(u_aspect, 1.0));
  col += nebCol * 0.02 * pow(clamp(1.0 - r * 0.6, 0.0, 1.0), 3.0);

  fragColor = vec4(col, 1.0);
}`

export class Cosmos {
  private readonly gl: GL
  private readonly prog: Program
  private readonly tri: WebGLVertexArrayObject

  /** 성운 색 — 막(Act)마다 바뀐다. HDR 이라 1을 넘겨도 된다. */
  tintA: [number, number, number] = [0.32, 0.14, 0.62]
  tintB: [number, number, number] = [0.06, 0.34, 0.5]
  /** 0..1 — 후반일수록 성운이 타오른다 */
  intensity = 0

  constructor(gl: GL) {
    this.gl = gl
    this.prog = createProgram(gl, VS, FS, 'cosmos')
    this.tri = createFullscreenTriangle(gl)
  }

  /** 씬 타깃이 바인딩된 상태에서 호출. 배경이므로 가장 먼저 그린다. */
  render(camX: number, camY: number, halfW: number, halfH: number, time: number): void {
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.useProgram(this.prog.handle)
    gl.uniform2f(this.prog.uniforms['u_cam']!, camX, camY)
    gl.uniform2f(this.prog.uniforms['u_halfSize']!, halfW, halfH)
    gl.uniform1f(this.prog.uniforms['u_time']!, time)
    gl.uniform1f(this.prog.uniforms['u_aspect']!, halfW / halfH)
    gl.uniform3f(this.prog.uniforms['u_tintA']!, this.tintA[0], this.tintA[1], this.tintA[2])
    gl.uniform3f(this.prog.uniforms['u_tintB']!, this.tintB[0], this.tintB[1], this.tintB[2])
    gl.uniform1f(this.prog.uniforms['u_intensity']!, this.intensity)
    gl.bindVertexArray(this.tri)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  /** 두 색 사이를 부드럽게 옮긴다 (막 전환용). t 는 0..1. */
  lerpTint(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    t: number,
  ): void {
    this.tintA[0] += (a[0] - this.tintA[0]) * t
    this.tintA[1] += (a[1] - this.tintA[1]) * t
    this.tintA[2] += (a[2] - this.tintA[2]) * t
    this.tintB[0] += (b[0] - this.tintB[0]) * t
    this.tintB[1] += (b[1] - this.tintB[1]) * t
    this.tintB[2] += (b[2] - this.tintB[2]) * t
  }
}
