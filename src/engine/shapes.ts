/**
 * 절차적 스프라이트 아틀라스.
 *
 * 이 게임에는 이미지 파일이 하나도 없다. 모든 모양은 부팅 때 SDF 셰이더로 한 번 구워서
 * 아틀라스 텍스처에 넣고, 이후 렌더는 텍스처 샘플 1회로 끝난다.
 * (프래그먼트에서 모양별로 분기하면 워프가 갈라져 수만 인스턴스에서 비싸진다.)
 */
import { createFullscreenTriangle, createProgram, GLError, type GL } from './gl'

export const ATLAS_COLS = 6
export const CELL_PX = 128
export const ATLAS_SIZE = ATLAS_COLS * CELL_PX // 768

/** 아틀라스 셀 인덱스. 렌더러의 shape 값이 곧 이것이다. */
export const Shape = {
  // ── 기본 ──
  Orb: 0, // 부드러운 발광 구 — 투사체, 픽업, 불씨
  Ring: 1, // 링 — 오라, 충격파, 폭발 테두리
  Mote: 2, // 다이아 — 잔챙이 군체
  Husk: 3, // 삼각 — 돌진체 (진행 방향으로 회전)
  Spark: 4, // 길쭉한 섬광 — 파티클, 잔상
  Hex: 5, // 육각 — 정예/탱커
  // ── 별·빛 ──
  Star: 6, // 5각 별 — 레벨업, 희귀 픽업
  Blade: 7, // 초승달 — 근접 휘두르기
  Bolt: 8, // 번개 조각 — 체인 라이트닝
  Smoke: 9, // 뭉게진 노이즈 구름 — 잔해, 연기
  Crack: 10, // 갈라진 균열 — 지형 파괴 파편
  Eye: 11, // 동공 — 보스/엘리트
  // ── 우주·신격 ──
  Singularity: 12, // 특이점 — 중력정. 가운데가 검고 테두리가 타오른다
  Comet: 13, // 혜성 — 머리 + 꼬리
  Nova: 14, // 초신성 — 8방향 광선 폭발
  Halo: 15, // 광륜 — 이중 링. 신격의 표식
  Rune: 16, // 신문(神紋) — 삼각 + 내부 문양
  Prism: 17, // 프리즘 — 굴절 결정
  Vortex: 18, // 소용돌이 — 나선 팔
  Sigil: 19, // 인장 — 원 + 내접 삼각 + 눈금
  Rift: 20, // 균열 — 공간이 찢어진 틈
  Crown: 21, // 왕관 — 보스/승천 표식
  Seed: 22, // 별의 씨앗 — 플레이어 코어
  Wing: 23, // 날개 — 승천 연출
} as const
export type ShapeId = (typeof Shape)[keyof typeof Shape]

const BAKE_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// 각 셀 안에서 p 는 -1..1. 셀 경계에 번짐이 새지 않도록 안쪽까지만 그린다.
const BAKE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_cols;

const float PI = 3.14159265359;

float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdEquilateral(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

float sdRhombus(vec2 p, vec2 b) {
  p = abs(p);
  float h = clamp((-2.0 * (p.x * b.x - p.y * b.y) + b.x * b.x - b.y * b.y) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}

float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

float sdStar(vec2 p, float r, float rf) {
  const int n = 5;
  float m = float(n) + rf;
  float an = PI / float(n);
  float en = PI / m;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// 값 노이즈 — 연기/균열의 불규칙함용. 결정적이어야 하므로 시간 입력 없음.
float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
    mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * valueNoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

// SDF -> 알파. w 는 안티에일리어싱 폭(셀 픽셀 기준).
float fill(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

/** 극좌표 각도 기준 n갈래 반복 — 광선·나선용 */
float rays(vec2 p, float n, float sharp) {
  float a = atan(p.y, p.x);
  return pow(abs(cos(a * n * 0.5)), sharp);
}

float shapeAlpha(int id, vec2 p, float w) {
  // Orb: 코어 + 넓은 헤일로. 이 게임에서 제일 많이 쓰이므로 가장 공들인다.
  if (id == 0) {
    float core = fill(sdCircle(p, 0.34), w);
    float halo = pow(clamp(1.0 - length(p) / 0.86, 0.0, 1.0), 2.2);
    return clamp(core + halo * 0.85, 0.0, 1.0);
  }
  // Ring
  if (id == 1) {
    float d = abs(sdCircle(p, 0.66)) - 0.075;
    float edge = fill(d, w);
    float inner = pow(clamp(1.0 - abs(length(p) - 0.66) / 0.3, 0.0, 1.0), 3.0);
    return clamp(edge + inner * 0.4, 0.0, 1.0);
  }
  // Mote: 마름모 + 은은한 글로우
  if (id == 2) {
    float d = sdRhombus(p, vec2(0.42, 0.68));
    float body = fill(d, w);
    float glow = pow(clamp(1.0 - length(p) / 0.9, 0.0, 1.0), 3.0);
    return clamp(body + glow * 0.5, 0.0, 1.0);
  }
  // Husk: 진행 방향(+X)을 향한 삼각형. 회전은 인스턴스가 준다.
  if (id == 3) {
    vec2 q = vec2(-p.y, p.x);
    float d = sdEquilateral(q, 0.5);
    float body = fill(d, w);
    float rim = fill(abs(d) - 0.05, w) * 0.7;
    return clamp(body * 0.75 + rim, 0.0, 1.0);
  }
  // Spark: 가로로 길쭉한 섬광
  if (id == 4) {
    float d = sdSegment(p, vec2(-0.6, 0.0), vec2(0.6, 0.0)) - 0.06;
    float body = fill(d, w);
    float glow = pow(clamp(1.0 - length(p * vec2(0.7, 2.4)), 0.0, 1.0), 2.0);
    return clamp(body + glow * 0.6, 0.0, 1.0);
  }
  // Hex: 속이 빈 육각 + 코어
  if (id == 5) {
    float d = sdHexagon(p, 0.62);
    float shell = fill(abs(d) - 0.08, w);
    float core = fill(sdHexagon(p, 0.28), w) * 0.55;
    return clamp(shell + core, 0.0, 1.0);
  }
  // Star
  if (id == 6) {
    float d = sdStar(p, 0.68, 2.2);
    float body = fill(d, w);
    float glow = pow(clamp(1.0 - length(p) / 0.9, 0.0, 1.0), 2.5);
    return clamp(body + glow * 0.55, 0.0, 1.0);
  }
  // Blade: 큰 원에서 작은 원을 빼서 만든 초승달
  if (id == 7) {
    float a = sdCircle(p - vec2(-0.06, 0.0), 0.7);
    float b = sdCircle(p - vec2(0.24, 0.0), 0.62);
    float d = max(a, -b);
    float body = fill(d, w);
    float rim = fill(abs(d) - 0.03, w) * 0.8;
    return clamp(body * 0.7 + rim, 0.0, 1.0);
  }
  // Bolt: 지그재그 번개
  if (id == 8) {
    vec2 pts[5] = vec2[5](
      vec2(-0.62, 0.55), vec2(-0.12, 0.16), vec2(-0.3, 0.0),
      vec2(0.28, -0.2), vec2(0.6, -0.6));
    float d = 1e9;
    for (int i = 0; i < 4; i++) d = min(d, sdSegment(p, pts[i], pts[i + 1]));
    d -= 0.055;
    float body = fill(d, w);
    float glow = fill(d - 0.12, w) * 0.45;
    return clamp(body + glow, 0.0, 1.0);
  }
  // Smoke: fbm 로 뭉갠 구름
  if (id == 9) {
    float n = fbm(p * 2.6 + 11.3);
    float d = sdCircle(p, 0.52 + (n - 0.5) * 0.42);
    float body = fill(d, w * 2.5);
    float falloff = pow(clamp(1.0 - length(p) / 0.92, 0.0, 1.0), 1.6);
    return clamp(body * falloff, 0.0, 1.0);
  }
  // Crack: 불규칙한 파편 조각
  if (id == 10) {
    float n = fbm(p * 4.0 + 3.7);
    float d = sdBox(p, vec2(0.34, 0.26) + (n - 0.5) * 0.3);
    return fill(d, w * 1.5) * 0.95;
  }
  // Eye: 흰자 + 동공
  if (id == 11) {
    float outer = fill(sdCircle(p, 0.62), w);
    float rim = fill(abs(sdCircle(p, 0.62)) - 0.06, w);
    float pupil = fill(sdRhombus(p, vec2(0.16, 0.44)), w);
    return clamp(outer * 0.25 + rim * 0.9 + pupil, 0.0, 1.0);
  }

  // ── 우주·신격 ──

  // Singularity: 가운데가 **비어 있고**(빛을 삼킨다) 사건의 지평선만 타오른다.
  if (id == 12) {
    float r = length(p);
    float disk = fill(abs(r - 0.5) - 0.1, w);          // 강착원반
    float halo = pow(clamp(1.0 - abs(r - 0.5) / 0.42, 0.0, 1.0), 2.0) * 0.6;
    float hole = 1.0 - fill(sdCircle(p, 0.34), w * 1.5); // 중심을 도려낸다
    return clamp((disk + halo) * hole, 0.0, 1.0);
  }
  // Comet: 머리(+X쪽) + 뒤로 늘어지는 꼬리
  if (id == 13) {
    float head = fill(sdCircle(p - vec2(0.34, 0.0), 0.22), w);
    float headGlow = pow(clamp(1.0 - length(p - vec2(0.34, 0.0)) / 0.5, 0.0, 1.0), 2.0);
    // 꼬리: -X 로 갈수록 얇아지고 흐려진다
    float t = clamp((0.34 - p.x) / 0.95, 0.0, 1.0);
    float width = 0.2 * (1.0 - t) + 0.02;
    float tail = (1.0 - smoothstep(0.0, width, abs(p.y))) * (1.0 - t) * step(p.x, 0.34);
    return clamp(head + headGlow * 0.7 + tail * 0.75, 0.0, 1.0);
  }
  // Nova: 8방향 광선 + 뜨거운 코어
  if (id == 14) {
    float r = length(p);
    float core = fill(sdCircle(p, 0.16), w);
    float coreGlow = pow(clamp(1.0 - r / 0.4, 0.0, 1.0), 2.0);
    float ray = rays(p, 8.0, 12.0) * pow(clamp(1.0 - r / 0.95, 0.0, 1.0), 1.4);
    return clamp(core + coreGlow * 0.8 + ray * 0.9, 0.0, 1.0);
  }
  // Halo: 이중 링. 신격의 표식이라 얇고 정확해야 한다.
  if (id == 15) {
    float outer = fill(abs(sdCircle(p, 0.78)) - 0.035, w);
    float inner = fill(abs(sdCircle(p, 0.58)) - 0.055, w);
    float glow = pow(clamp(1.0 - abs(length(p) - 0.68) / 0.34, 0.0, 1.0), 3.0);
    return clamp(outer + inner + glow * 0.45, 0.0, 1.0);
  }
  // Rune: 삼각 테두리 + 내부 가로 눈금 (신문자)
  if (id == 16) {
    float tri = sdEquilateral(p, 0.62);
    float edge = fill(abs(tri) - 0.045, w);
    float bars = 0.0;
    for (int i = 0; i < 3; i++) {
      float y = -0.24 + float(i) * 0.2;
      bars += fill(sdSegment(p, vec2(-0.2, y), vec2(0.2, y)) - 0.028, w);
    }
    bars *= 1.0 - fill(tri + 0.08, w * 2.0) * 0.0; // 삼각 안쪽에만
    return clamp(edge + bars * 0.75, 0.0, 1.0);
  }
  // Prism: 마름모 결정 + 내부 분광선
  if (id == 17) {
    float d = sdRhombus(p, vec2(0.5, 0.78));
    float edge = fill(abs(d) - 0.04, w);
    float body = fill(d, w) * 0.28;
    float split = fill(sdSegment(p, vec2(0.0, -0.6), vec2(0.0, 0.6)) - 0.02, w) * 0.6;
    return clamp(edge + body + split, 0.0, 1.0);
  }
  // Vortex: 로그 나선 팔 3개
  if (id == 18) {
    float r = length(p);
    float a = atan(p.y, p.x);
    // 반경에 따라 각도가 감기면 나선이 된다
    float spiral = sin(a * 3.0 - log(max(r, 0.04)) * 5.0);
    float arms = pow(clamp(spiral * 0.5 + 0.5, 0.0, 1.0), 3.0);
    float falloff = pow(clamp(1.0 - r / 0.9, 0.0, 1.0), 1.2) * smoothstep(0.05, 0.2, r);
    float core = pow(clamp(1.0 - r / 0.22, 0.0, 1.0), 2.0);
    return clamp(arms * falloff + core, 0.0, 1.0);
  }
  // Sigil: 원 + 내접 삼각 + 바깥 눈금 12개
  if (id == 19) {
    float ring = fill(abs(sdCircle(p, 0.62)) - 0.035, w);
    float tri = fill(abs(sdEquilateral(p, 0.44)) - 0.03, w);
    float ticks = 0.0;
    float a = atan(p.y, p.x);
    float r = length(p);
    float tick = pow(abs(cos(a * 6.0)), 30.0);
    ticks = tick * (1.0 - smoothstep(0.66, 0.86, r)) * step(0.66, r);
    return clamp(ring + tri * 0.8 + ticks, 0.0, 1.0);
  }
  // Rift: 세로로 찢어진 틈. 가운데가 밝고 가장자리가 너덜하다.
  if (id == 20) {
    float n = fbm(p * 3.2 + 7.1) - 0.5;
    float x = p.x + n * 0.22;
    float taper = 1.0 - abs(p.y) / 0.9;
    float width = 0.11 * max(taper, 0.0);
    float slit = 1.0 - smoothstep(0.0, max(width, 0.005), abs(x));
    float glow = (1.0 - smoothstep(0.0, 0.34, abs(x))) * max(taper, 0.0) * 0.4;
    return clamp((slit + glow) * step(abs(p.y), 0.9), 0.0, 1.0);
  }
  // Crown: 밑변 + 뾰족한 세 봉우리
  if (id == 21) {
    float band = fill(sdBox(p - vec2(0.0, -0.44), vec2(0.56, 0.1)), w);
    float spikes = 0.0;
    for (int i = 0; i < 3; i++) {
      float x = -0.36 + float(i) * 0.36;
      float h = (i == 1) ? 0.52 : 0.36;
      vec2 q = (p - vec2(x, -0.34)) / vec2(0.2, h);
      // 삼각: |x| + y < 1
      float tri = abs(q.x) + max(q.y, 0.0) - 1.0;
      spikes += fill(tri * 0.3, w);
    }
    float gems = fill(sdCircle(p - vec2(0.0, 0.24), 0.09), w);
    return clamp(band + spikes + gems, 0.0, 1.0);
  }
  // Seed: 플레이어 코어. 안쪽 씨앗 + 바깥 껍질 + 4방향 빛
  if (id == 22) {
    float r = length(p);
    float core = fill(sdCircle(p, 0.2), w);
    float shell = fill(abs(sdCircle(p, 0.52)) - 0.05, w);
    float ray = rays(p, 4.0, 22.0) * pow(clamp(1.0 - r / 0.92, 0.0, 1.0), 1.6);
    float glow = pow(clamp(1.0 - r / 0.7, 0.0, 1.0), 2.4) * 0.5;
    return clamp(core + shell * 0.85 + ray * 0.7 + glow, 0.0, 1.0);
  }
  // Wing: 한쪽 날개 (인스턴스가 좌우 반전해서 쓴다)
  if (id == 23) {
    // 큰 원에서 작은 원을 빼 깃 모양을 만들고 아래를 자른다
    float a = sdCircle(p - vec2(-0.1, -0.18), 0.82);
    float b = sdCircle(p - vec2(-0.42, -0.52), 0.78);
    float d = max(a, -b);
    d = max(d, -p.y - 0.2);
    float body = fill(d, w);
    float rim = fill(abs(d) - 0.03, w);
    // 깃털 결
    float lines = pow(abs(sin(atan(p.y + 0.18, p.x + 0.1) * 9.0)), 8.0) * body * 0.5;
    return clamp(body * 0.45 + rim * 0.9 + lines, 0.0, 1.0);
  }
  return 0.0;
}

void main() {
  vec2 cell = floor(v_uv * u_cols);
  int id = int(cell.y * u_cols + cell.x);
  vec2 local = fract(v_uv * u_cols) * 2.0 - 1.0; // 셀 안 좌표 -1..1
  float w = 2.0 * u_cols / 768.0 * 1.6;          // 대략 픽셀 1.6개 폭
  float a = shapeAlpha(id, local, w);
  // 셀 경계에서 번짐이 이웃 셀로 새지 않도록 잘라낸다.
  a *= 1.0 - smoothstep(0.9, 1.0, max(abs(local.x), abs(local.y)));
  fragColor = vec4(1.0, 1.0, 1.0, a);
}`

export interface Atlas {
  readonly tex: WebGLTexture
  readonly cols: number
}

/** 아틀라스를 한 번 굽는다. 부팅 때 1회만 호출. */
export function bakeAtlas(gl: GL): Atlas {
  const tex = gl.createTexture()
  if (!tex) throw new GLError('아틀라스 텍스처 생성 실패')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS_SIZE, ATLAS_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null,
  )
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const fbo = gl.createFramebuffer()
  if (!fbo) throw new GLError('아틀라스 FBO 생성 실패')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GLError('아틀라스 FBO 불완전')
  }

  const prog = createProgram(gl, BAKE_VS, BAKE_FS, 'atlas-bake')
  const tri = createFullscreenTriangle(gl)

  gl.viewport(0, 0, ATLAS_SIZE, ATLAS_SIZE)
  gl.disable(gl.BLEND)
  gl.useProgram(prog.handle)
  gl.uniform1f(prog.uniforms['u_cols']!, ATLAS_COLS)
  gl.bindVertexArray(tri)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fbo)
  gl.deleteProgram(prog.handle)
  gl.deleteVertexArray(tri)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return { tex, cols: ATLAS_COLS }
}
