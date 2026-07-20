/**
 * 진짜 3D — three.js 원근 렌더러. ("제발 2D에서 벗어나라": 사용자, 2026-07-18)
 *
 * 시뮬레이션(voyage.ts)은 이미 완전한 3D 라서 여기서는 **보여주기만** 한다.
 * 좌표 매핑: 게임 (x, y, z) → three (x, z↑, y). 게임 z 가 위아래(스페이스/시프트)다.
 *
 * 조작: 이동 WASD(카메라 기준)·마우스 왼쪽, 카메라 회전 오른쪽 드래그, 줌 휠.
 * 검은 입: 검은 구체 + 광자 고리 + 도는 강착원반 + 화면공간 중력 렌즈(포스트).
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { hashSeed } from '../engine/rng'
import { HOLES, STAR_MAP, lyOf } from '../game/starmap'
import { GALAXIES } from '../game/galaxy'
import { BodyKind, SCELL, bhRadius, bodyRof, type Voyage } from '../game/voyage'

/** 행성 대기 림 색 — 대기 조성이 곧 색이다 */
const EARTH_ID = hashSeed('sol:지구')
const ATMOS = new Map<number, readonly [number, number, number]>([
  [EARTH_ID, [0.35, 0.65, 1.2]],
  [hashSeed('sol:금성'), [1.1, 0.95, 0.6]],
  [hashSeed('sol:화성'), [0.9, 0.5, 0.35]],
  [hashSeed('sol:천왕성'), [0.45, 1.0, 1.0]],
  [hashSeed('sol:해왕성'), [0.4, 0.6, 1.2]],
])

const MAX_INST = 2600
const MAX_GLOW = 160
const MAX_GAS = 240
const MAX_MARK = 120
/** 성운·은하 연기 군집 풀 — "가도 점 하나"의 수리: 성운은 구체가 아니라 구름이다 */
const MAX_NEB = 140
/** 게 펄서 — 등대 빔을 돌릴 유일한 심장 */
const PULSAR_ID = hashSeed('map:게 성운:펄서')

/** 중력 렌즈 — 화면 공간에서 지평선 둘레로 배경을 휜다 (슈바르츠실트 흉내) */
const LENS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uHole: { value: new THREE.Vector2(0.5, 0.5) },
    uR: { value: 0.05 },
    /** 왜곡(아인슈타인) 반경 — 몸(uR)과 분리: 질량이 커지면 이게 자란다 */
    uE: { value: 0.05 },
    uAspect: { value: 1.77 },
    uWaveC: { value: new THREE.Vector2(0.5, 0.5) },
    uWaveT: { value: 9 },
    uQuasar: { value: 0 },
    uTemp: { value: 1 },
  },
  vertexShader: `varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv;
uniform sampler2D tDiffuse; uniform vec2 uHole; uniform float uR; uniform float uE; uniform float uAspect;
uniform vec2 uWaveC; uniform float uWaveT; uniform float uQuasar; uniform float uTemp;
void main(){
  vec2 p = vUv - uHole; p.x *= uAspect;
  float d = length(p);
  vec2 dir = d > 1e-4 ? p / d : vec2(0.0,1.0);
  // 렌즈 방정식 β = θ − α — 배경은 바깥으로 밀리고, 정렬되면 아인슈타인 링이 맺힌다.
  // (예전엔 부호가 반대라 빨아들이는 발산 렌즈였다 — 링이 원리적으로 불가능했다)
  // 왜곡 반경은 uE(영향권·√질량 눈금) — 검은 그림자(uR·몸)와 분리다:
  // 몸은 점인데 주변 별빛이 넓게 휘는 것, 그게 블랙홀의 성장이다.
  float defl = (uE*uE*1.6) / max(d, uE*0.4);
  defl *= 1.0 - smoothstep(uE*2.6, uE*5.0, d);
  float b = d - defl;
  vec2 q = uHole + vec2(dir.x/uAspect, dir.y) * b;
  // 화면 밖 샘플은 렌즈를 접는다 — 가장자리 색 번짐 방지
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) q = vUv;
  vec3 col = texture2D(tDiffuse, q).rgb;
  // 렌즈 배율 — 은은하게 (과하면 링이 화면을 지배한다)
  float mag = clamp(d / max(abs(b), 2e-3), 1.0, 2.2);
  col *= mix(1.0, mag, 0.25);
  // 중력파 — 시공의 물결이 화면을 실제로 출렁이며 지나간다 (합병의 흔적)
  if (uWaveT < 1.6) {
    vec2 pw = vUv - uWaveC; pw.x *= uAspect;
    float dw = length(pw);
    float band = exp(-pow((dw - uWaveT*0.55)/0.03, 2.0));
    vec2 qw = vUv + (pw/max(dw,1e-4)) * band * 0.016 * (1.0-uWaveT/1.6);
    col = max(col, texture2D(tDiffuse, qw).rgb);
    col += vec3(0.35,0.4,0.7) * band * (1.0-uWaveT/1.6) * 0.35;
  }
  // 중력 적색편이 — 지평선 근처를 빠져나온 빛은 붉고 어둡다
  float gz = sqrt(clamp(1.0 - uR*0.92/max(d,1e-3), 0.0, 1.0));
  float zone = 1.0 - smoothstep(uR*1.05, uR*3.0, d);
  col = mix(col, col * max(gz, 0.2) * vec3(1.0,0.65,0.45), zone*0.45);
  // 그림자는 지평선의 2.6배 — √27/2 r_s (EHT 실측 눈금, 조사 ②-16):
  // 몸보다 훨씬 큰 검은 구멍으로 보인다. 렌즈 다음에 깎아야 진짜 검다
  col = mix(col, vec3(0.0), smoothstep(uR*2.6, uR*2.2, d));
  // 광자 고리 — 임계곡선으로 수렴하는 서브링들 + 도플러 비대칭 (EHT)
  float angH = atan(p.y, p.x);
  float dopp = 1.0 + 0.35 * sin(angH);
  float hot = 1.0 + uQuasar * 0.8;
  float ring1 = exp(-pow((d - uR*2.75)/(uR*0.09), 2.0));
  float ring2 = exp(-pow((d - uR*2.62)/(uR*0.035), 2.0));
  // 광자 고리도 색온도를 입는다 — 백열(작음) → 검붉음(초대질량)
  vec3 ringC = mix(vec3(1.6,0.7,0.45), vec3(1.5,1.2,0.8), uTemp);
  col += ringC * (ring1*0.4 + ring2*0.24) * dopp * hot;
  gl_FragColor = vec4(col, 1.0);
}`,
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  return t
}

function smokeTexture(): THREE.Texture {
  // 뭉게 — 고해상(256) + 잘고 많은 방울: 128px 를 수백 px 로 확대하면
  // 뿌연 떡이 된다 ("가스 구름 개 짜쳐": 실플레이)
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  let s = 7
  const rnd = (): number => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2
    const rr = rnd() * rnd() * 88
    const x = 128 + Math.cos(a) * rr
    const y = 128 + Math.sin(a) * rr
    const r = 10 + rnd() * 34
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, `rgba(255,255,255,${0.16 + rnd() * 0.16})`)
    g.addColorStop(0.55, 'rgba(255,255,255,0.07)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
  }
  return new THREE.CanvasTexture(c)
}

/**
 * 성운 — 연기가 아니라 **발광 성운**이다 (실플레이 "성운이 뭔지 모르나").
 * 다층 발광 구름(분홍 H-알파·청록 산소·보라) + 어두운 먼지 띠 + 박힌 어린 별들.
 */
function nebulaTexture(seed: number): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  let s = seed
  const rnd = (): number => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const HUES: readonly [number, number, number][] = [
    [255, 90, 130], [90, 200, 220], [170, 110, 255], [255, 150, 90],
  ]
  // 발광 구름 — 색이 다른 층을 겹겹이, **진하게** (묽으면 안개가 된다: 실플레이)
  for (let i = 0; i < 44; i++) {
    const a = rnd() * Math.PI * 2
    const rr = rnd() * rnd() * 92
    const x = 128 + Math.cos(a) * rr
    const y = 128 + Math.sin(a) * rr * (0.7 + rnd() * 0.3)
    const r = 12 + rnd() * 40
    const [hr, hg, hb] = HUES[(seed + i) % HUES.length]!
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, `rgba(${hr},${hg},${hb},${0.24 + rnd() * 0.22})`)
    g.addColorStop(0.6, `rgba(${hr},${hg},${hb},0.1)`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
  }
  // 어두운 먼지 띠 — 창조의 기둥 같은 실루엣
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 7; i++) {
    ctx.beginPath()
    ctx.ellipse(60 + rnd() * 136, 60 + rnd() * 136, 4 + rnd() * 26, 2 + rnd() * 7, rnd() * 3, 0, 6.28)
    ctx.fillStyle = `rgba(0,0,0,${0.5 + rnd() * 0.4})`
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  // 박힌 어린 별들 — 별 성(星) 자의 이유 (굵고 밝게)
  for (let i = 0; i < 56; i++) {
    const x = 30 + rnd() * 196
    const y = 30 + rnd() * 196
    const r = 1.1 + rnd() * 2.4
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.3, 'rgba(200,220,255,0.4)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6)
  }
  return new THREE.CanvasTexture(c)
}

/** 은하 — 팽대부 + 로그 나선팔 두 개 + 별 알갱이 (Core 대형 전용) */
function galaxyTexture(seed: number): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  let s = seed
  const rnd = (): number => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const bulge = ctx.createRadialGradient(128, 128, 1, 128, 128, 34)
  bulge.addColorStop(0, 'rgba(255,240,210,0.95)')
  bulge.addColorStop(0.5, 'rgba(255,220,170,0.4)')
  bulge.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = bulge
  ctx.fillRect(0, 0, 256, 256)
  for (const arm of [0, Math.PI]) {
    for (let t = 0; t < 60; t++) {
      const th = t / 60
      const ang = arm + th * 3.6 + rnd() * 0.1
      const rr = 12 + th * 108
      const x = 128 + Math.cos(ang) * rr
      const y = 128 + Math.sin(ang) * rr * 0.62
      const r = 7 + (1 - th) * 12
      const blue = th > 0.35
      const g = ctx.createRadialGradient(x, y, 1, x, y, r)
      g.addColorStop(0, blue ? `rgba(150,180,255,${0.1 + rnd() * 0.08})` : `rgba(255,225,180,${0.12 + rnd() * 0.08})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 256, 256)
    }
  }
  for (let i = 0; i < 60; i++) {
    const x = 20 + rnd() * 216
    const y = 50 + rnd() * 156
    ctx.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.5})`
    ctx.fillRect(x, y, 1.2, 1.2)
  }
  return new THREE.CanvasTexture(c)
}

/**
 * 항성 표면 — 쌀알 조직(대류 세포) + 흑점. "빛번짐 스프라이트"가 아니라
 * 표면이 끓는 **물체**로 보이게 ("희무끄레" 의 근본 수리 — 형태 우선).
 */
function starTexture(seed: number): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')!
  let s = seed
  const rnd = (): number => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  ctx.fillStyle = '#e8e0d0'
  ctx.fillRect(0, 0, 128, 64)
  // 쌀알 조직 — 밝고 어두운 잔 세포
  for (let i = 0; i < 420; i++) {
    const bright = rnd() < 0.5
    ctx.fillStyle = bright ? `rgba(255,255,255,${0.1 + rnd() * 0.14})` : `rgba(120,90,60,${0.08 + rnd() * 0.12})`
    ctx.beginPath()
    ctx.ellipse(rnd() * 128, rnd() * 64, 1 + rnd() * 2.6, 1 + rnd() * 2, rnd() * 3, 0, 6.28)
    ctx.fill()
  }
  // 흑점 무리
  for (let i = 0; i < 5; i++) {
    const x = rnd() * 128
    const y = 10 + rnd() * 44
    const r = 2 + rnd() * 5
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, r)
    g.addColorStop(0, 'rgba(30,15,8,0.85)')
    g.addColorStop(0.6, 'rgba(90,50,25,0.4)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  return t
}

/**
 * 행성 표면 — 절차 생성 (외부 에셋은 단일 파일 원칙상 불가, 대신 굽는다).
 * 회색조로 만들어 몸색 틴트가 곱해지게 — 8장으로 수백 행성이 다 달라 보인다.
 */
function planetTexture(seed: number, banded: boolean): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')!
  let s = seed
  const rnd = (): number => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  if (banded) {
    // 목성형 — 위도 줄무늬 + 난류 얼룩
    const p1 = rnd() * 6.28
    const p2 = rnd() * 6.28
    for (let y = 0; y < 64; y++) {
      const l = 150 + 52 * Math.sin(y * 0.33 + p1) + 26 * Math.sin(y * 0.9 + p2)
      ctx.fillStyle = `rgb(${l | 0},${l | 0},${l | 0})`
      ctx.fillRect(0, y, 128, 1)
    }
    for (let i = 0; i < 34; i++) {
      const y = rnd() * 64
      const dark = rnd() < 0.5
      ctx.fillStyle = dark ? 'rgba(40,40,40,0.25)' : 'rgba(255,255,255,0.2)'
      ctx.beginPath()
      ctx.ellipse(rnd() * 128, y, 5 + rnd() * 16, 1.2 + rnd() * 2.4, 0, 0, 6.28)
      ctx.fill()
    }
  } else {
    // 암석형 — 반점 지형 + 극관
    ctx.fillStyle = '#969696'
    ctx.fillRect(0, 0, 128, 64)
    for (let i = 0; i < 150; i++) {
      const dark = rnd() < 0.55
      ctx.fillStyle = dark ? `rgba(30,30,30,${0.1 + rnd() * 0.2})` : `rgba(255,255,255,${0.08 + rnd() * 0.16})`
      ctx.beginPath()
      ctx.ellipse(rnd() * 128, rnd() * 64, 2 + rnd() * 9, 2 + rnd() * 7, rnd() * 3, 0, 6.28)
      ctx.fill()
    }
    if (rnd() < 0.7) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillRect(0, 0, 128, 3 + rnd() * 4)
      ctx.fillRect(0, 64 - (3 + rnd() * 4), 128, 8)
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  return t
}

function ringTexture(): THREE.Texture {
  // 행성 고리 — 방사형 밴드 + 카시니 간극 두 줄 (미마스 공명이 비운 자리)
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 62, 128, 128, 126)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(0.1, 'rgba(220,205,170,0.75)')
  g.addColorStop(0.42, 'rgba(200,185,150,0.65)')
  g.addColorStop(0.47, 'rgba(60,55,45,0.08)') // 카시니 간극
  g.addColorStop(0.52, 'rgba(210,195,160,0.6)')
  g.addColorStop(0.78, 'rgba(180,165,135,0.45)')
  g.addColorStop(0.82, 'rgba(60,55,45,0.06)') // 엥케 간극
  g.addColorStop(0.86, 'rgba(170,155,130,0.35)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  /** 기준 도구(축·황도 그리드) — 렌즈 뒤에 그린다: 잣대가 중력에 휘면 잣대가 아니다 */
  readonly overlay: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  private readonly composer: EffectComposer
  private readonly lensPass: ShaderPass
  private readonly bloom: UnrealBloomPass

  /** 카메라 방위각 — 오른쪽 드래그로 돈다. 이동(WASD)은 이 기준으로 변환된다 */
  yaw = 0
  /** 시작은 지평선 구도(0.3) — 지구가 하늘의 절반을 덮는 각도 */
  pitch = 0.3
  zoomBias = 1
  /** 줌아웃 상한 — 몸이 클수록 열린다 ("커지면 더 멀리서도 보게": 실플레이) */
  private zoomMax = 2.4
  /** 부동 원점(three-공간) — 실척 좌표(±1.4e11px)에서 float32 파탄을 막는
   *  유일한 방벽 (아키텍처 §2-2). GPU 로 가는 모든 좌표는 이 원점 상대값.
   *  main 의 화면 투영도 이걸 빼고 project 해야 한다. */
  readonly origin = new THREE.Vector3()

  private readonly lit: THREE.InstancedMesh
  private readonly emis: THREE.InstancedMesh
  /** 은하화된 별들 — 나를 도는 나의 은하 */
  private readonly haloMesh: THREE.InstancedMesh
  private readonly rings: THREE.Mesh[] = []
  private readonly glows: THREE.Sprite[] = []
  private readonly gasSprites: THREE.Sprite[] = []
  private readonly marks: THREE.Sprite[] = []
  private readonly playerMesh: THREE.Mesh
  /** 붕괴하는 지구 — 시작 30초, 내 자리에서 지구 껍질이 조여들며 검어진다 */
  private readonly earthMorphMesh: THREE.Mesh
  private readonly mergeMesh: THREE.Mesh
  private readonly mergeGlow: THREE.Sprite
  private readonly waves: THREE.Mesh[] = []
  private readonly disk: THREE.Mesh
  private readonly diskMat: THREE.ShaderMaterial
  private readonly jets: THREE.Mesh[] = []
  private readonly stars: THREE.Points
  private readonly sun: THREE.DirectionalLight
  private readonly rivalMeshes: THREE.Mesh[] = []
  private readonly rivalGlow: THREE.Sprite[] = []
  private readonly rivalRing: THREE.Sprite[] = []
  private readonly nebSprites: THREE.Sprite[] = []
  private readonly pulsarBeams: THREE.Mesh[] = []
  private readonly band: THREE.Points
  /** 근접 행성 글로브 풀 — 인스턴싱은 텍스처를 못 입는다 */
  private readonly planetMeshes: THREE.Mesh[] = []
  private readonly planetTex: THREE.Texture[] = []
  private readonly planetTexId: number[] = []
  private readonly nebTex: THREE.Texture[] = []
  private readonly galTex: THREE.Texture[] = []
  /** T0 은하 임포스터 — 먼 은하는 원반 그림 한 장으로 하늘에 떠 있다 (P5) */
  private readonly galSprites: THREE.Sprite[] = []
  /** T1 별 점군 — 활성창 밖 별셀 씨앗을 점으로 (물리 0, 실체와 같은 씨앗) */
  private fieldGeo!: THREE.BufferGeometry
  private fieldMat!: THREE.PointsMaterial
  private fieldKey = ''
  private readonly nebMapId: number[] = []
  private readonly starTex: THREE.Texture[] = []
  private readonly starMeshes: THREE.Mesh[] = []
  private readonly starTexId: number[] = []

  private readonly ecliptic: THREE.PolarGridHelper
  /** 랜드마크 — 실지도 항성계는 아무리 멀어도 밝은 별점으로 보인다 (항법의 잣대) */
  private readonly landmarks: THREE.Sprite[] = []
  private readonly labelBox: HTMLDivElement
  private readonly labels: HTMLDivElement[] = []
  private readonly labelSysIdx: number[] = []
  /** 클릭된 목적지 — main 이 소비하고 비운다 */
  pick: { x: number; y: number; z: number; name: string } | null = null
  /** 축 표시기 — three(X,Y,Z)=(빨,초,파) = 게임 (x, z↑, y). X 키 토글 */
  readonly axes: THREE.AxesHelper
  private readonly m4 = new THREE.Matrix4()
  private readonly q0 = new THREE.Quaternion()
  private readonly qS = new THREE.Quaternion()
  private readonly vDir = new THREE.Vector3()
  private readonly v3 = new THREE.Vector3()
  private readonly s3 = new THREE.Vector3()
  private readonly col = new THREE.Color()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.scene = new THREE.Scene()
    this.overlay = new THREE.Scene()
    this.scene.background = new THREE.Color(0x020207)
    this.scene.fog = new THREE.FogExp2(0x030409, 0.00004)
    this.camera = new THREE.PerspectiveCamera(58, 1.77, 1, 400000)

    // 우주는 칠흑이지만 게임은 보여야 한다 — 중성 전역광 (청회색을 쓰면
    // 화면 전체가 90년대 도스 게임처럼 푸르뎅뎅해진다: 실플레이)
    // 1.25 — 항성이 없는 공허에서도 천체가 스스로 어느 정도 비쳐야 한다
    // ("멀리 내가 원하는 거 찾아갈 때도 보이고": 실플레이)
    this.scene.add(new THREE.AmbientLight(0xbdb6ab, 1.25))
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.4)
    this.scene.add(this.sun)
    const fill = new THREE.DirectionalLight(0x8a8278, 0.3)
    fill.position.set(-3, -2, -4)
    this.scene.add(fill)

    const glowTex = glowTexture()
    const smokeTex = smokeTexture()

    const sphere = new THREE.SphereGeometry(1, 20, 14)
    const litMat = new THREE.MeshLambertMaterial()
    litMat.emissive = new THREE.Color(0x2a2622) // 자체 발광 — 무광원 공허에서도 보인다
    this.lit = new THREE.InstancedMesh(sphere, litMat, MAX_INST)
    this.lit.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.lit)
    this.emis = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial(), 600)
    this.emis.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.emis)
    this.haloMesh = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial(), 400)
    this.haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.haloMesh)
    // 근접 행성 글로브 — 절차 표면(줄무늬 4장·암석 4장)을 입은 전용 구체 10개.
    // 태양계 밖 행성이 민짜 회색 공("희무끄레")이던 원인의 수리.
    for (let i = 0; i < 4; i++) this.planetTex.push(planetTexture(101 + i * 37, true))
    for (let i = 0; i < 4; i++) this.planetTex.push(planetTexture(211 + i * 53, false))
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshLambertMaterial()
      mat.emissive = new THREE.Color(0x161412)
      const pm = new THREE.Mesh(sphere, mat)
      pm.visible = false
      this.planetMeshes.push(pm)
      this.planetTexId.push(-1)
      this.scene.add(pm)
    }

    // 행성 고리 풀 — 토성이 드디어 고리를 되찾는다
    const ringGeo = new THREE.RingGeometry(1.3, 2.5, 56)
    const ringTex = ringTexture()
    for (let i = 0; i < 10; i++) {
      const rm = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      }))
      rm.visible = false
      this.rings.push(rm)
      this.scene.add(rm)
    }

    for (let i = 0; i < MAX_GLOW; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }))
      sp.visible = false
      this.glows.push(sp)
      this.scene.add(sp)
    }
    for (let i = 0; i < MAX_GAS; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }))
      sp.visible = false
      this.gasSprites.push(sp)
      this.scene.add(sp)
    }
    for (let i = 0; i < MAX_MARK; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xd9a84c, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.3,
      }))
      sp.visible = false
      this.marks.push(sp)
      this.scene.add(sp)
    }
    for (let i = 0; i < 4; i++) this.nebTex.push(nebulaTexture(313 + i * 97))
    for (let i = 0; i < 3; i++) this.galTex.push(galaxyTexture(511 + i * 131))
    // T0 은하 임포스터 (P5) — 국부군 은하마다 한 장
    for (let i = 0; i < GALAXIES.length; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.galTex[i % this.galTex.length]!,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }))
      sp.visible = false
      this.galSprites.push(sp)
      this.scene.add(sp)
    }
    // T1 별 점군 (P5) — 별셀 씨앗 최대 2400점
    this.fieldGeo = new THREE.BufferGeometry()
    this.fieldGeo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(2400 * 3), 3))
    this.fieldGeo.setAttribute('color',
      new THREE.BufferAttribute(new Float32Array(2400 * 3), 3))
    this.fieldGeo.setDrawRange(0, 0)
    this.fieldMat = new THREE.PointsMaterial({
      size: 600, vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })
    const fieldPts = new THREE.Points(this.fieldGeo, this.fieldMat)
    fieldPts.frustumCulled = false
    this.scene.add(fieldPts)
    // 근접 항성 글로브 — 표면이 끓는 물체 (솜뭉치 후광 금지)
    for (let i = 0; i < 4; i++) this.starTex.push(starTexture(701 + i * 61))
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial()
      const sm = new THREE.Mesh(sphere, mat)
      sm.visible = false
      this.starMeshes.push(sm)
      this.starTexId.push(-1)
      this.scene.add(sm)
    }
    for (let i = 0; i < MAX_NEB; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }))
      sp.visible = false
      this.nebSprites.push(sp)
      this.nebMapId.push(-1)
      this.scene.add(sp)
    }
    // 게 펄서 등대 빔 — 자전축에서 기운 자기축을 따라 두 줄기가 우주를 쓸고 돈다.
    // 좁은 쪽(펄서)에서 넓은 쪽으로 퍼지는 원뿔 껍질 (y 0→1 스팬).
    {
      const beamGeo = new THREE.CylinderGeometry(0.34, 0.015, 1, 10, 1, true)
      beamGeo.translate(0, 0.5, 0)
      for (let i = 0; i < 2; i++) {
        const bm = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
          color: 0xbfe0ff, blending: THREE.AdditiveBlending, transparent: true,
          opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        }))
        bm.visible = false
        this.pulsarBeams.push(bm)
        this.scene.add(bm)
      }
    }

    // 나 — 빛의 부재. 구체는 검고, 지평선·광자 고리는 렌즈 셰이더가 마무리한다
    this.playerMesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0x000000 }))
    this.scene.add(this.playerMesh)
    // 붕괴하는 지구 — 암석 텍스처에 바다색 틴트. morph 가 1이 되면 퇴장한다
    {
      const em = new THREE.MeshLambertMaterial({ color: 0x86b2e8, emissive: 0x0c1626 })
      em.map = this.planetTex[4] ?? null
      this.earthMorphMesh = new THREE.Mesh(sphere, em)
      this.scene.add(this.earthMorphMesh)
    }
    // 나선낙하 중인 상대 — 검은 구 + 백열 테
    this.mergeMesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0x000000 }))
    this.mergeMesh.visible = false
    this.scene.add(this.mergeMesh)
    this.mergeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      color: 0xffd9a0,
    }))
    this.mergeGlow.visible = false
    this.scene.add(this.mergeGlow)
    // 중력파 — 합병 지점에서 퍼지는 시공의 고리 두 겹
    const waveGeo = new THREE.RingGeometry(0.92, 1, 72)
    for (let i = 0; i < 2; i++) {
      const wv = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({
        color: 0x9fb4ff, blending: THREE.AdditiveBlending, transparent: true,
        side: THREE.DoubleSide, depthWrite: false,
      }))
      wv.rotation.x = -Math.PI / 2
      wv.visible = false
      this.waves.push(wv)
      this.scene.add(wv)
    }
    // 강착원반 — 샤쿠라-순야예프 온도 구배(T∝r^-¾: 안쪽 백청, 바깥 적색) +
    // 케플러 차등 회전(안쪽이 빠르다) + 도플러 비밍(다가오는 쪽이 밝다) + 난류 줄무늬
    this.diskMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uFeed: { value: 0 }, uInner: { value: 0.4 },
        uTemp: { value: 1 }, uCam: { value: new THREE.Vector2(1, 0) },
      },
      vertexShader: `varying vec2 vP;
void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vP;
uniform float uTime; uniform float uFeed; uniform float uInner; uniform float uTemp; uniform vec2 uCam;
void main(){
  float r = length(vP);
  float T = pow(max(uInner*2.2, 1.35)/max(r, 1e-3), 0.75);
  vec3 col = mix(vec3(1.0,0.36,0.12), vec3(1.15,1.3,1.55), smoothstep(0.55,1.0,T));
  // 호킹 색온도 — T∝1/M: 갓난 몸은 백열, 초대질량은 검붉게 식는다 (UI 없는 질량계)
  col *= mix(vec3(1.15,0.55,0.4), vec3(1.05,1.1,1.25), uTemp);
  // 케플러 차등 회전 ω∝r^-1.5 — 폭식 중엔 안쪽 고리가 초당 수백 라디안으로
  // 미쳐 돈다 (ISCO 공전 ~ms: 조사 반영, "초당 수백~수천 회전": 실플레이)
  float phi = atan(vP.y,vP.x) - uTime*(1.7 + 6.0*uFeed)*inversesqrt(max(r*r*r, 1e-4));
  // 진짜 도플러 비밍 — β 케플러(안쪽이 빠름) × 시선 방향: 다가오는 쪽이 δ³ 배
  // 밝다 (조사 ②-14 — 가짜 sin 항 폐기). 카메라만 돌려도 초승달이 따라 돈다.
  vec2 tang = vec2(-vP.y, vP.x)/max(r, 1e-3);
  float beta = clamp(0.55*inversesqrt(max(r, 0.25)), 0.0, 0.7);
  float cosT = dot(tang, uCam);
  float beam = clamp(pow(1.0/(1.0 - beta*cosT), 3.0), 0.35, 3.2);
  float streak = 0.84 + 0.16*sin(phi*9.0 + r*14.0);
  // 안쪽 가장자리는 검은 몸(uInner)에 붙는다. 휴면(uFeed 0)엔 거의 안 보이고
  // 먹을 때만 점화한다 — 실제 휴면 블랙홀의 문법 (ED·실물리)
  float alpha = (1.0-smoothstep(1.4,3.1,r)) * smoothstep(uInner, uInner*1.8, r) * (0.04+uFeed*0.6);
  gl_FragColor = vec4(col*beam*streak, alpha);
}`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.disk = new THREE.Mesh(new THREE.RingGeometry(0.02, 3.1, 72), this.diskMat)
    this.disk.rotation.x = -Math.PI / 2
    this.scene.add(this.disk)
    // 상대론적 쌍제트 — 퀘이사 모드에서 스핀축(위아래)으로 뿜는 빛기둥
    const coneGeo = new THREE.ConeGeometry(0.45, 4, 20, 1, true)
    for (const s of [1, -1]) {
      const jet = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
        color: 0x9fc4ff, blending: THREE.AdditiveBlending, transparent: true,
        opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }))
      jet.rotation.x = s > 0 ? Math.PI : 0
      this.jets.push(jet)
      this.scene.add(jet)
    }

    // 황도 기준면 — 수직 이동이 "보이게" 하는 유일한 잣대. 별은 무한원경이라
    // z 로 움직여도 아무 시차가 없다 (실플레이 "z축 못 움직여"의 정체).
    this.ecliptic = new THREE.PolarGridHelper(1, 12, 10, 56, 0x2a3546, 0x18202e)
    const em = this.ecliptic.material as THREE.Material
    em.transparent = true
    em.opacity = 0.05 // 평소엔 유령처럼 — 수직 기동 때만 떠오른다 (도스 그리드 금지)
    em.depthWrite = false
    this.overlay.add(this.ecliptic)

    this.axes = new THREE.AxesHelper(1)
    const am = this.axes.material as THREE.Material
    am.transparent = true
    am.opacity = 0.5
    am.depthWrite = false
    this.overlay.add(this.axes)

    // 별밭 — 결정론 씨앗의 원거리 배경 (카메라를 따라다닌다: 시차 없는 무한 원경)
    const starN = 3200
    const pos = new Float32Array(starN * 3)
    const colArr = new Float32Array(starN * 3)
    let s = 20260718
    const rnd = (): number => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }
    for (let i = 0; i < starN; i++) {
      const a = rnd() * Math.PI * 2
      const b = Math.acos(rnd() * 2 - 1)
      pos[i * 3] = Math.sin(b) * Math.cos(a)
      pos[i * 3 + 1] = Math.cos(b)
      pos[i * 3 + 2] = Math.sin(b) * Math.sin(a)
      const w = 0.5 + rnd() * 0.5
      colArr[i * 3] = w * (0.8 + rnd() * 0.2)
      colArr[i * 3 + 1] = w * (0.85 + rnd() * 0.15)
      colArr[i * 3 + 2] = w
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    starGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 2.6, sizeAttenuation: false, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1,
    }))
    this.scene.add(this.stars)

    // 은하수 띠 — 하늘을 가로지르는 별의 강. 우리가 은하 원반 **안**에 있다는
    // 증거다 ("우주에 점같은 별만 있어?": 실플레이). 은하면은 황도에서 60° 기울었다.
    const bandN = 1700
    const bpos = new Float32Array(bandN * 3)
    const bcol = new Float32Array(bandN * 3)
    for (let i = 0; i < bandN; i++) {
      const a = rnd() * Math.PI * 2
      const h = ((rnd() + rnd() + rnd()) / 1.5 - 1) * 0.16 // 가운데가 짙은 띠
      const n = Math.hypot(1, h)
      bpos[i * 3] = Math.cos(a) / n
      bpos[i * 3 + 1] = h / n
      bpos[i * 3 + 2] = Math.sin(a) / n
      // 은하 중심(남쪽) 방향이 더 밝고 노랗다 — 팽대부를 바라보는 시선
      const core = Math.max(0, Math.cos(a - Math.PI * 1.5)) * 0.5
      const w = 0.1 + rnd() * 0.2 + core * (0.14 + rnd() * 0.2)
      bcol[i * 3] = w * (0.9 + core * 0.3)
      bcol[i * 3 + 1] = w * (0.85 + core * 0.15)
      bcol[i * 3 + 2] = w * 0.95
    }
    const bandGeo = new THREE.BufferGeometry()
    bandGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3))
    bandGeo.setAttribute('color', new THREE.BufferAttribute(bcol, 3))
    this.band = new THREE.Points(bandGeo, new THREE.PointsMaterial({
      size: 2.1, sizeAttenuation: false, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9,
    }))
    this.band.rotation.set(1.02, 0, 0.35)
    this.scene.add(this.band)

    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0x000000 }))
      m.visible = false
      this.rivalMeshes.push(m)
      this.scene.add(m)
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }))
      sp.visible = false
      this.rivalGlow.push(sp)
      this.scene.add(sp)
      // 광자 고리 — 다른 검은 입도 검은 구멍답게 빛의 테를 두른다 (스텔스 금지)
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }))
      ring.visible = false
      this.rivalRing.push(ring)
      this.scene.add(ring)
    }

    // 랜드마크 별점 + 이름 라벨 — 성운·은하는 하늘에서도 제 모습으로 보인다
    // ("은하도 성운도 없어": 실플레이 — 지도엔 있는데 하늘에서 안 읽혔다)
    for (let i = 0; i < STAR_MAP.length; i++) {
      const sys = STAR_MAP[i]!
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sys.kind === 'sun' ? glowTex
          : sys.kind === 'garden' ? this.nebTex[i % this.nebTex.length]!
            : this.galTex[i % this.galTex.length]!,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }))
      sp.material.color.setRGB(
        Math.min(1, sys.cr * 0.8), Math.min(1, sys.cg * 0.8), Math.min(1, sys.cb * 0.8),
      )
      this.landmarks.push(sp)
      this.overlay.add(sp)
    }
    this.labelBox = document.createElement('div')
    this.labelBox.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
    ;(canvas.parentElement ?? document.body).appendChild(this.labelBox)
    for (let i = 0; i < 7; i++) {
      const d = document.createElement('div')
      d.style.cssText =
        'position:absolute;font:600 11px/1.4 ui-monospace,monospace;color:#c9a35f;' +
        'text-shadow:0 0 6px rgba(0,0,0,.9);white-space:nowrap;display:none;' +
        'pointer-events:auto;cursor:pointer;'
      // 목적지 클릭 항법 — 이름을 누르면 그리로 간다 (실플레이).
      // 별지도 뒤 인덱스는 블랙홀 랜드마크 ("다른 블랙홀 위치도": 실플레이)
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        const si = this.labelSysIdx[i]!
        if (si >= STAR_MAP.length) {
          const hh = HOLES[si - STAR_MAP.length]!
          this.pick = { x: hh.x, y: hh.y, z: hh.z, name: hh.name }
        } else if (si >= 0) this.pick = STAR_MAP[si]!
      })
      this.labels.push(d)
      this.labelSysIdx.push(-1)
      this.labelBox.appendChild(d)
    }

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // 렌즈 → 블룸 순서 — 블룸은 카메라 광학이라 렌즈 뒤가 물리적으로 맞고,
    // 광자 고리가 블룸을 받아 그림자 가장자리로 번진다 (EHT·인터스텔라 룩)
    this.lensPass = new ShaderPass(LENS_SHADER)
    this.composer.addPass(this.lensPass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.65, 0.85)
    this.composer.addPass(this.bloom)

    // 카메라 조작 — 왼쪽 드래그 회전(증분·포인터 ID 단일 핸들러), 휠 줌.
    // 클로저 누적 방식은 포인터업을 놓치면 죽은 핸들러가 남아 yaw 가 두 기준
    // 사이를 오가며 툭툭 튀었다 (실플레이). 오른쪽 버튼은 아무것도 하지 않는다.
    let dragId = -1
    let lastX = 0
    let lastY = 0
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && e.pointerType !== 'touch') {
        dragId = e.pointerId
        lastX = e.clientX
        lastY = e.clientY
        canvas.setPointerCapture(e.pointerId)
      }
    })
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return
      this.yaw += (e.clientX - lastX) * 0.006
      this.pitch = Math.min(1.35, Math.max(-1.35, this.pitch + (e.clientY - lastY) * 0.005))
      lastX = e.clientX
      lastY = e.clientY
    })
    const endDrag = (e: PointerEvent): void => {
      if (e.pointerId === dragId) dragId = -1
    }
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('lostpointercapture', endDrag)
    canvas.addEventListener('wheel', (e) => {
      this.zoomBias = Math.min(this.zoomMax, Math.max(0.45, this.zoomBias * (e.deltaY > 0 ? 1.1 : 0.9)))
      e.preventDefault()
    }, { passive: false })
  }

  resize(): void {
    const w = this.renderer.domElement.clientWidth
    const h = this.renderer.domElement.clientHeight
    const cur = new THREE.Vector2()
    this.renderer.getSize(cur)
    const dpr = this.renderer.getPixelRatio()
    if (Math.round(cur.x) !== Math.round(w) || Math.round(cur.y) !== Math.round(h)) {
      this.renderer.setSize(w, h, false)
      this.composer.setPixelRatio(dpr)
      this.composer.setSize(w, h)
      this.camera.aspect = w / Math.max(1, h)
      this.camera.updateProjectionMatrix()
    }
  }

  /** 게임 상태 → 씬. 매 프레임. (게임 x,y,z → three x, z↑, y) */
  sync(g: Voyage, t: number): void {
    const R = g.radius
    /** 시각 몸 — 영향권(R)과 분리된 진짜 "검은 몸". 지구를 먹어도 거의 안 큰다 */
    const BR = bodyRof(R)
    // ── 부동 원점 (Phase 1) — 4096px 양자화된 O 를 플레이어 곁에 두고,
    // px/py/pz 는 **O-상대**가 된다. 시뮬(g.x 등)은 절대 double 그대로.
    // 절대 좌표가 필요한 차분(sys.x - …)은 g.x 를 직접 쓴다.
    const oX3 = Math.round(g.x / 4096) * 4096
    const oY3 = Math.round(g.y / 4096) * 4096
    const oZ3 = Math.round(g.z / 4096) * 4096
    this.origin.set(oX3, oZ3, oY3)
    const px = g.x - oX3
    const py = g.z - oZ3 // three y = 게임 z (위)
    const pz = g.y - oY3
    // 유계 불변식 — 리베이스 누락은 눈이 아니라 어서션이 잡는다 (§2-3)
    if (import.meta.env.DEV) {
      for (const b of g.active) {
        console.assert(
          Math.abs(b.x - oX3) < 200000 && Math.abs(b.y - oY3) < 200000,
          'render offset overflow', b.id)
      }
    }

    // 카메라 — 티끌일 땐 몸의 ~14배까지 바짝(행성이 하늘을 채운다), R5부터 표준
    const kCam = 0.78 - 0.36 * Math.max(0, 1 - R / 5)
    // 줌아웃 상한은 몸 크기 비례 (R300부터 열려 R1300에서 ×6) — 시야가 넓어진
    // 만큼 게임 쪽 활성 반경(rangeN)도 viewZoom 으로 따라온다
    this.zoomMax = 2.4 + Math.min(3.6, Math.max(0, (R - 300) / 280))
    g.viewZoom = this.zoomBias
    const dist = g.camera.viewHeight * kCam * this.zoomBias
    const cp = Math.cos(this.pitch)
    this.camera.position.set(
      px + Math.sin(this.yaw) * cp * dist,
      py + Math.sin(this.pitch) * dist,
      pz + Math.cos(this.yaw) * cp * dist,
    )
    this.camera.lookAt(px, py, pz)
    // far 바닥 15만 — dist 비례만 두면 티끌 눈금(dist~26)에서 1,500px 밖이
    // 통째로 잘린다 ("멀다고 렌더링 개 병신": 실플레이)
    this.camera.far = Math.max(150000, dist * 60)
    this.camera.near = Math.max(0.6, dist * 0.004)
    this.camera.updateProjectionMatrix()
    // 우주에 안개는 없다 — 0.5 는 원거리를 뭉개서 "좀만 멀어지면 아무것도
    // 안 보이는" 원흉이었다 (실플레이). 깊이 단서만 남을 만큼 희미하게.
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = 0.1 / (dist * 18)
    this.stars.position.copy(this.camera.position)
    this.stars.scale.setScalar(dist * 40)
    // 워프 시차 — **절대** 위치 비례로 하늘이 흐른다 (원점 상대면 4096 격자
    // 마다 하늘이 튄다). 저속에선 거의 0 — 별은 원래 멀어서 그게 맞다.
    this.stars.rotation.set(g.y * 1.6e-8, g.x * 2.2e-8, 0)
    this.band.position.copy(this.camera.position)
    this.band.scale.setScalar(dist * 40)
    // 기준면은 황도(z=0)에 고정 — 수직 기동 중에만 뚜렷해진다
    this.ecliptic.position.set(px, -oZ3, pz) // 황도는 게임 z=0 절대 평면 — 원점 상대로 이동
    this.ecliptic.scale.setScalar(dist * 2.2)
    ;(this.ecliptic.material as THREE.Material).opacity =
      0.04 + Math.min(0.18, Math.abs(g.vz) / (dist * 0.5))
    this.axes.position.set(px, py, pz)
    this.axes.scale.setScalar(dist * 0.22)

    // 랜드마크 — 실지도 항성계를 하늘의 별점으로. 가까운 넷엔 이름·광년 라벨
    const w0 = this.renderer.domElement.clientWidth
    const h0 = Math.max(1, this.renderer.domElement.clientHeight)
    let labelN = 0
    const placedLb: [number, number][] = []
    const skyR = dist * 30
    const d3s: number[] = []
    for (let i = 0; i < STAR_MAP.length; i++) {
      const sys = STAR_MAP[i]!
      const sp = this.landmarks[i]!
      const dx = sys.x - g.x
      const dy = sys.z - g.z
      const dz = sys.y - g.y
      const d3 = Math.hypot(dx, dy, dz) || 1
      d3s.push(d3)
      // 별점은 실물 지오메트리가 읽히는 거리까지 산다 — 12화면 일괄 컷은 그
      // 사이 암흑 구간을 만들었다 ("가까이 가면 안 보인다": 실플레이)
      const nearGeo = d3 < Math.max(dist * 4, sys.r * 40)
      if (nearGeo) {
        sp.visible = false
      } else {
        sp.visible = true
        sp.position.set(px + (dx / d3) * skyR, py + (dy / d3) * skyR, pz + (dz / d3) * skyR)
        const imp = sys.kind === 'core' ? 6 : sys.kind === 'garden' ? 4 : 1
        sp.scale.setScalar(skyR * 0.01 * imp)
        sp.material.opacity = sys.kind === 'sun' ? 0.6 : 0.38
      }
    }
    // 라벨은 **가까운 순** 다섯 — 지도 배열 순이면 화면에 걸린 앞 계들이 슬롯을
    // 전부 훔쳐 목적지 라벨이 사라진다 ("3광년 미만인데 찾을 수가 없네": 실플레이).
    // 클릭 목적지는 무조건 1순위 핀.
    const ord = d3s.map((_, i) => i).sort((a, b) => {
      const sa = STAR_MAP[a]!
      const sb = STAR_MAP[b]!
      const pa = g.navOn && sa.x === g.navX && sa.y === g.navY ? -1e18 : 0
      const pb = g.navOn && sb.x === g.navX && sb.y === g.navY ? -1e18 : 0
      return d3s[a]! + pa - (d3s[b]! + pb)
    })
    for (const i of ord) {
      if (labelN >= 5) break
      const sys = STAR_MAP[i]!
      const sp = this.landmarks[i]!
      const d3 = d3s[i]!
      const pinned = g.navOn && sys.x === g.navX && sys.y === g.navY
      // 도착 코앞(1.2화면)에서만 접는다 — 목적지 핀은 항법이 풀릴 때까지 남는다
      if (!sp.visible && d3 < dist * 1.2 && !pinned) continue
      if (sp.visible) this.v3.copy(sp.position).project(this.camera)
      else this.v3.set(sys.x - oX3, sys.z - oZ3, sys.y - oY3).project(this.camera)
      if (this.v3.z < 1 && Math.abs(this.v3.x) < 0.95 && Math.abs(this.v3.y) < 0.92) {
        this.labelSysIdx[labelN] = i
        const lb = this.labels[labelN++]!
        lb.style.display = 'block'
        const lx = ((this.v3.x + 1) / 2) * w0 + 8
        let lyy = ((1 - this.v3.y) / 2) * h0 - 6
        for (let rep = 0; rep < 4; rep++) {
          for (const p of placedLb) {
            if (Math.abs(lyy - p[1]) < 16 && Math.abs(lx - p[0]) < 180) lyy = p[1] + 18
          }
        }
        placedLb.push([lx, lyy])
        lb.style.left = `${lx}px`
        lb.style.top = `${lyy}px`
        // 실거리 광년 — 압축 좌표를 그대로 나누면 마젤란이 "300광년"이 된다
        const lyd = lyOf(d3)
        lb.textContent = `${sys.name} · ${lyd >= 10000 ? `${(lyd / 10000).toFixed(1)}만 광년`
          : lyd >= 0.1 ? `${lyd.toFixed(1)}광년` : `${Math.round(d3 / 1000)}k`}`
        // 먹은 계는 붉은 취소선 — "자꾸 먹은 곳으로 가게 되네" (실플레이)
        const gone = g.sysEaten(i)
        lb.style.color = gone ? '#e05555' : '#c9a35f'
        lb.style.textDecoration = gone ? 'line-through' : 'none'
      }
    }
    // 블랙홀 랜드마크 — 가장 가까운 둘은 이름이 보인다 (보라, 클릭 이동 가능)
    {
      let h1 = -1
      let h2 = -1
      let hd1 = Infinity
      let hd2 = Infinity
      for (let j = 0; j < HOLES.length; j++) {
        const hh = HOLES[j]!
        const dh = Math.hypot(hh.x - g.x, hh.z - g.z, hh.y - g.y) || 1
        if (dh < hd1) {
          h2 = h1
          hd2 = hd1
          h1 = j
          hd1 = dh
        } else if (dh < hd2) {
          h2 = j
          hd2 = dh
        }
      }
      for (const [j, dh] of [[h1, hd1], [h2, hd2]] as const) {
        if (j < 0 || labelN >= 7) continue
        const hh = HOLES[j]!
        this.v3.set(hh.x - oX3, hh.z - oZ3, hh.y - oY3).project(this.camera)
        if (this.v3.z < 1 && Math.abs(this.v3.x) < 0.95 && Math.abs(this.v3.y) < 0.92) {
          this.labelSysIdx[labelN] = STAR_MAP.length + j
          const lb = this.labels[labelN++]!
          lb.style.display = 'block'
          const lx = ((this.v3.x + 1) / 2) * w0 + 8
          let lyy = ((1 - this.v3.y) / 2) * h0 - 6
          for (let rep = 0; rep < 4; rep++) {
            for (const p of placedLb) {
              if (Math.abs(lyy - p[1]) < 16 && Math.abs(lx - p[0]) < 180) lyy = p[1] + 18
            }
          }
          placedLb.push([lx, lyy])
          lb.style.left = `${lx}px`
          lb.style.top = `${lyy}px`
          const lyd = lyOf(dh)
          lb.textContent = `● ${hh.name} · ${lyd >= 10000 ? `${(lyd / 10000).toFixed(1)}만 광년`
            : lyd >= 0.1 ? `${lyd.toFixed(1)}광년` : `${Math.round(dh / 1000)}k`}`
          const gone = g.holeEaten(j)
          lb.style.color = gone ? '#e05555' : '#c99df0'
          lb.style.textDecoration = gone ? 'line-through' : 'none'
        }
      }
    }
    for (let i = labelN; i < 7; i++) {
      this.labels[i]!.style.display = 'none'
      this.labelSysIdx[i] = -1
    }

    // T0 은하 임포스터 (P5) — 밖에서 보면 은하가 원반 그림으로 하늘에 떠 있고,
    // 안(rDisk·1.15)에 들어가면 임포스터가 걷히며 별 점군·실체가 자리를 잇는다
    for (let i = 0; i < GALAXIES.length; i++) {
      const G = GALAXIES[i]!
      const sp = this.galSprites[i]!
      const dgx = G.cx - g.x
      const dgy = G.cy - g.y
      const dgz = G.cz - g.z
      const dg = Math.hypot(dgx, dgy, dgz) || 1
      if (dg < G.rDisk * 1.15) {
        sp.visible = false
        continue
      }
      sp.visible = true
      sp.position.set(
        px + (dgx / dg) * skyR * 0.97,
        py + (dgz / dg) * skyR * 0.97,
        pz + (dgy / dg) * skyR * 0.97,
      )
      const ang = Math.min(0.42, (G.rDisk * 2.2) / dg)
      sp.scale.setScalar(skyR * Math.max(0.015, ang))
      ;(sp.material as THREE.SpriteMaterial).opacity =
        0.85 * Math.min(1, (dg / (G.rDisk * 1.15) - 1) * 2.5)
    }

    // T1 별 점군 (P5) — 플레이어 주변 별셀 7×7 씨앗을 점으로 (물리 0).
    // 활성창 안은 실체 Body 가 그리므로 제외 — 같은 씨앗이라 자리가 안 튄다.
    {
      const ccx = Math.floor(g.x / SCELL)
      const ccy = Math.floor(g.y / SCELL)
      const key = `${ccx},${ccy},${oX3},${oY3},${oZ3}`
      if (key !== this.fieldKey) {
        this.fieldKey = key
        const pos = this.fieldGeo.getAttribute('position') as THREE.BufferAttribute
        const col = this.fieldGeo.getAttribute('color') as THREE.BufferAttribute
        let n = 0
        const actR = 118000 // 활성창(±115.2k) + 여유
        for (let cy2 = ccy - 3; cy2 <= ccy + 3; cy2++) {
          for (let cx2 = ccx - 3; cx2 <= ccx + 3; cx2++) {
            for (const s of g.cellSystems(cx2, cy2)) {
              if (n >= 2400) break
              if (Math.abs(s.x - g.x) < actR && Math.abs(s.y - g.y) < actR) continue
              pos.setXYZ(n, s.x - oX3, s.z - oZ3, s.y - oY3)
              if (s.arm > 0.4) col.setXYZ(n, 0.62, 0.74, 1.0)
              else col.setXYZ(n, 1.0, 0.8, 0.58)
              n++
            }
          }
        }
        this.fieldGeo.setDrawRange(0, n)
        pos.needsUpdate = true
        col.needsUpdate = true
      }
      this.fieldMat.size = Math.max(400, dist * 0.02)
    }

    // 조명 — 가장 가까운 태양이 태양이다
    let sunB: { x: number; y: number; z: number } | null = null
    let sunD = Infinity
    let litN = 0
    let emisN = 0
    let glowN = 0
    let markN = 0
    let ringN = 0
    let nebN = 0
    let planetN = 0
    let starN = 0
    let pulsarSeen = false
    let pulsarX = 0
    let pulsarY = 0
    let pulsarZ = 0
    let pulsarR = 0
    for (const b of g.active) {
      if (b.kind === BodyKind.Sun) {
        const d = (b.x - g.x) ** 2 + (b.y - g.y) ** 2
        if (d < sunD) {
          sunD = d
          sunB = b
        }
      }
    }
    if (sunB) {
      this.sun.position.set(sunB.x - g.x, sunB.z - g.z + 1, sunB.y - g.y)
      this.sun.intensity = 1.4
    } else {
      this.sun.position.set(1, 2, 1)
      this.sun.intensity = 0.7
    }
    this.sun.position.normalize().multiplyScalar(10)
    this.sun.target.position.set(0, 0, 0)

    // 천체
    for (const b of g.active) {
      const bx = b.x - oX3
      const by = b.z - oZ3
      const bz = b.y - oY3
      // 흡수 중이면 나선으로 감기며 줄어들고, 지평선 앞에서 붉게 저물다 얼어붙는다
      let sc = b.r
      let ax = bx
      let ay = by
      let az = bz
      let redK = 0
      for (let i = 0; i < g.absorbs.length; i++) {
        const a = g.absorbs[i]!
        if (a.b.id === b.id) {
          const k = 1 - Math.pow(1 - a.t, 1.7)
          const ang = Math.atan2(bz - pz, bx - px) + k * 3.1
          const d0 = Math.hypot(bx - px, bz - pz) * (1 - k)
          ax = px + Math.cos(ang) * d0
          az = pz + Math.sin(ang) * d0
          ay = by + (py - by) * k
          sc = b.r * (1 - k * 0.62)
          redK = k
          break
        }
      }
      // 지각 계층 — 모든 천체는 최소 각크기를 보장한다: 멀어도 태양은 불덩이,
      // 행성은 구체, **카이퍼·오르트 얼음도 티끌 반짝임**으로는 보인다 ("카이퍼
      // 벨트도 없어": 실플레이 — 있는데 서브픽셀이라 안 보였다). 다가가면
      // 실크기가 자연히 이긴다 (원근 거짓말은 낮은 θ 로 억제).
      let dCam = 0
      if (redK === 0) {
        dCam = Math.hypot(
          ax - this.camera.position.x, ay - this.camera.position.y, az - this.camera.position.z,
        )
        const theta = b.r >= R * 1.25
          ? b.kind === BodyKind.Sun ? 0.045
            : b.kind === BodyKind.Garden || b.kind === BodyKind.Core ? 0.06 : 0.022
          : b.kind === BodyKind.Dust ? 0.0018 : 0.0035 // 소행성은 티끌 반짝임까지만
        sc = Math.max(sc, dCam * theta)
      }
      this.v3.set(ax, ay, az)
      // 스파게티 신장 — 찢김 직전, 내 쪽 축으로 늘어나고 수직으로 눌린다
      if (b.stretch && b.stretch > 0.03) {
        const st = Math.min(1, b.stretch)
        this.vDir.set(px - ax, py - ay, pz - az).normalize()
        this.s3.set(0, 1, 0)
        this.qS.setFromUnitVectors(this.s3, this.vDir)
        this.s3.set(
          Math.max(0.6, sc) * (1 - st * 0.38),
          Math.max(0.6, sc) * (1 + st * 2.4),
          Math.max(0.6, sc) * (1 - st * 0.38),
        )
        this.m4.compose(this.v3, this.qS, this.s3)
      } else if (b.kind === BodyKind.Dust && !b.hot) {
        // 소행성은 감자다 — 매끈한 공으로 그리면 행성과 헷갈린다 (실플레이).
        // id 해시로 찌그러뜨려 돌덩이로 읽히게.
        const base2 = Math.max(0.5, sc)
        this.s3.set(
          base2 * (0.55 + ((b.id >>> 2) % 40) * 0.01),
          base2 * (0.68 + ((b.id >>> 7) % 30) * 0.01),
          base2,
        )
        this.m4.compose(this.v3, this.q0, this.s3)
      } else {
        this.s3.setScalar(Math.max(0.6, sc))
        this.m4.compose(this.v3, this.q0, this.s3)
      }
      if (b.id === PULSAR_ID) {
        pulsarSeen = true
        pulsarX = ax
        pulsarY = ay
        pulsarZ = az
        pulsarR = sc
      }
      // 성운·은하 — 전용 텍스처: 성운은 발광 구름+먼지 띠+박힌 어린 별,
      // 은하는 팽대부+나선팔 ("성운은 연기네ㅋㅋ": 실플레이 — 회색 연기 폐기).
      if (b.kind === BodyKind.Garden || (b.kind === BodyKind.Core && b.r > 600)) {
        const isCore = b.kind === BodyKind.Core
        const texArr = isCore ? this.galTex : this.nebTex
        const ti = (isCore ? 100 : 0) + (b.id % texArr.length)
        if (nebN < MAX_NEB) {
          const sp = this.nebSprites[nebN]!
          sp.visible = true
          if (this.nebMapId[nebN] !== ti) {
            sp.material.map = texArr[b.id % texArr.length]!
            sp.material.needsUpdate = true
            this.nebMapId[nebN] = ti
          }
          sp.material.rotation = (b.id % 628) * 0.01
          sp.material.color.setRGB(
            Math.min(1, 0.9 + redK), Math.min(1, 0.9 * (1 - redK * 0.5)), Math.min(1, 0.95 * (1 - redK * 0.6)),
          )
          sp.material.opacity = isCore ? 0.95 : 1
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * (isCore ? 2.3 : 2.7))
          nebN++
        }
        // 겹layers — 한 장은 벽지처럼 읽힌다 ("하나의 오브젝트가 아니라고":
        // 실플레이). 큰 가스체는 몸 반경 안에 결 다른 조각 여러 장을 3D 로
        // 흩뿌린다 — 원거리에서도 덩어리들의 구름으로 읽힌다. 결정론 산포.
        if (!isCore) {
          const chunks = Math.min(7, 1 + Math.floor(b.r / 420))
          for (let k = 1; k <= chunks && nebN < MAX_NEB; k++) {
            const h1 = ((b.id ^ (k * 0x9e3779b1)) >>> 8) % 1000
            const h2 = ((b.id ^ (k * 0x85ebca6b)) >>> 6) % 1000
            const h3 = ((b.id ^ (k * 0xc2b2ae35)) >>> 4) % 1000
            const sp2 = this.nebSprites[nebN]!
            sp2.visible = true
            const tIdx = (b.id + k * 7) % this.nebTex.length
            const ti2 = 50 + tIdx
            if (this.nebMapId[nebN] !== ti2) {
              sp2.material.map = this.nebTex[tIdx]!
              sp2.material.needsUpdate = true
              this.nebMapId[nebN] = ti2
            }
            sp2.material.rotation = h3 * 0.0063 + t * (k % 2 === 0 ? 0.01 : -0.008)
            const warm = h1 / 1000
            sp2.material.color.setRGB(
              Math.min(1, b.cr * (0.7 + warm * 0.45)),
              Math.min(1, b.cg * (0.65 + warm * 0.35)),
              Math.min(1, b.cb * (0.8 + (1 - warm) * 0.35)),
            )
            sp2.material.opacity = 0.3 + (h2 % 400) / 1000
            const ang2 = h1 * 0.00628
            const off = 0.2 + (h2 / 1000) * 0.65
            sp2.position.set(
              ax + Math.cos(ang2) * b.r * off,
              ay + (h3 / 1000 - 0.5) * b.r * 0.5,
              az + Math.sin(ang2) * b.r * off,
            )
            sp2.scale.setScalar(sc * (0.7 + (h3 % 500) / 700))
            nebN++
          }
        }
        if (glowN < MAX_GLOW) {
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * (isCore ? 0.6 : 0.9))
          sp.material.color.setRGB(Math.min(1, b.cr * 0.9), Math.min(1, b.cg * 0.8), Math.min(1, b.cb))
          sp.material.opacity = isCore ? 0.45 : 0.22
        }
        // 먹이 금테 — 성운도 한 입이 되면 표적으로 읽혀야 한다
        if (markN < MAX_MARK && b.r < R * 0.8 && b.r >= R * 0.1) {
          const mdx = b.x - g.x
          const mdy = b.y - g.y
          if (mdx * mdx + mdy * mdy < dist * dist * 36) {
            const mk = this.marks[markN++]!
            mk.visible = true
            mk.position.set(ax, ay, az)
            mk.scale.setScalar(Math.max(sc * 1.6, dist * 0.012))
          }
        }
        continue
      }
      // 항성질량 블랙홀(백조자리 X-1·IMBH) — 동족이다: 검은 몸 + 기울어진
      // 강착 원반 + 광자 글로우 (X선 쌍성의 실제 초상 — "이미지 꼬라지" 수리)
      if (b.kind === BodyKind.Core) {
        if (litN < MAX_INST) {
          this.v3.set(ax, ay, az)
          this.s3.setScalar(Math.max(0.6, sc * 0.34)) // 몸은 작다 — 원반이 크기를 말한다
          this.m4.compose(this.v3, this.q0, this.s3)
          this.lit.setMatrixAt(litN, this.m4)
          this.col.setRGB(0.01, 0.01, 0.02)
          this.lit.setColorAt(litN, this.col)
          litN++
        }
        if (ringN < this.rings.length) {
          const rm = this.rings[ringN++]!
          rm.visible = true
          rm.position.set(ax, ay, az)
          rm.scale.setScalar(sc * 1.35)
          rm.rotation.x = -Math.PI / 2 + 0.5 + ((b.id % 100) - 50) * 0.004
          ;(rm.material as THREE.MeshBasicMaterial).color.setRGB(1.5, 0.85, 0.45)
          ;(rm.material as THREE.MeshBasicMaterial).opacity = 0.9
        }
        if (glowN < MAX_GLOW) {
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * 0.9)
          sp.material.color.setRGB(1.2, 0.9, 0.6)
          sp.material.opacity = 0.75
        }
        continue
      }
      // 근접 항성 글로브 — 화면에서 큰 별은 표면(쌀알 조직·흑점)이 있는 물체로.
      // 빛번짐 스프라이트 의존이 "희무끄레"의 근본이었다 (실플레이 확정).
      if (b.kind === BodyKind.Sun && !b.hot && redK === 0 && starN < this.starMeshes.length &&
        dCam > 0 && sc > dCam * 0.016) {
        const sm = this.starMeshes[starN]!
        sm.visible = true
        sm.position.set(ax, ay, az)
        sm.scale.setScalar(Math.max(0.6, sc))
        sm.rotation.y = t * 0.02 + (b.id % 628) * 0.01
        const smat = sm.material as THREE.MeshBasicMaterial
        const sti = b.id % this.starTex.length
        if (this.starTexId[starN] !== sti) {
          smat.map = this.starTex[sti]!
          smat.needsUpdate = true
          this.starTexId[starN] = sti
        }
        const pu = 1 + 0.03 * Math.sin(t * 1.1 + (b.id % 628) * 0.01)
        smat.color.setRGB(Math.min(1.6, b.cr * pu), Math.min(1.5, b.cg * pu), Math.min(1.4, b.cb))
        starN++
        // 코로나는 절제 — 형태가 주인공, 번짐은 조연
        if (glowN < MAX_GLOW) {
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * 1.9)
          sp.material.color.setRGB(b.cr * 0.5, b.cg * 0.4, b.cb * 0.25)
          sp.material.opacity = 0.3
        }
        continue
      }
      const isEmis = b.kind === BodyKind.Sun || b.hot
      if (isEmis && emisN < 600) {
        this.emis.setMatrixAt(emisN, this.m4)
        // 맥동 변광·대류 얼룩 — 별은 숨쉰다: 미라형(크고 붉으면 깊고 느리게),
        // 케페이드형(작으면 얕고 빠르게), 초거성은 표면이 얼룩덜룩 끓는다
        const ph = (b.id % 628) * 0.01
        const red = b.cr > b.cb * 1.2
        const amp = b.r > 900 ? 0.08 : red && b.r > 300 ? 0.1 : 0.04
        const spd = b.r > 300 ? 0.3 : 1.1
        const pulse = 1 + amp * Math.sin(t * spd + ph)
        const mottle = b.r > 900 ? 0.93 + 0.07 * Math.sin(t * 0.9 + ph * 7) * Math.sin(t * 0.5 + ph * 3) : 1
        this.col.setRGB(
          Math.min(1, b.cr * pulse * mottle * (1 + redK * 0.6)),
          Math.min(1, b.cg * pulse * (1 - redK * 0.6)),
          Math.min(1, b.cb * mottle * (1 - redK * 0.8)),
        )
        this.emis.setColorAt(emisN, this.col)
        emisN++
        if (b.kind === BodyKind.Sun && glowN < MAX_GLOW - 1) {
          // 원거리 별 후광 — 절제 (솜뭉치 금지: "희무끄레"의 주범이었다)
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * 2.8 * pulse)
          sp.material.color.setRGB(b.cr * 0.45 * mottle, b.cg * 0.38, b.cb * 0.24)
          sp.material.opacity = 0.26
          const core = this.glows[glowN++]!
          core.visible = true
          core.position.set(ax, ay, az)
          core.scale.setScalar(sc * 1.5 * pulse)
          core.material.color.setRGB(1.4, 1.3, 1.1)
          core.material.opacity = 0.4
        }
      } else {
        // 근접 행성 글로브 — 어디의 행성이든(태양계·센타우리·필드계) 눈에 띄는
        // 10개는 절차 표면을 입고 자전한다. 나머지는 인스턴스 구체.
        const globe = (b.kind === BodyKind.Rock || b.kind === BodyKind.Ringed) &&
          redK === 0 && planetN < 10 && dCam > 0 && sc > dCam * 0.012
        if (globe) {
          const pm = this.planetMeshes[planetN]!
          pm.visible = true
          pm.position.set(ax, ay, az)
          pm.scale.setScalar(Math.max(0.6, sc))
          pm.rotation.y = t * 0.05 + (b.id % 628) * 0.01
          const mat = pm.material as THREE.MeshLambertMaterial
          const ti = b.id % 8
          if (this.planetTexId[planetN] !== ti) {
            mat.map = this.planetTex[ti]!
            mat.needsUpdate = true
            this.planetTexId[planetN] = ti
          }
          const dimZ2 = 0.75 + 0.25 * Math.min(1, sc / Math.max(1, b.r))
          mat.color.setRGB(
            Math.min(1, b.cr * 1.15 * dimZ2), Math.min(1, b.cg * 1.15 * dimZ2), Math.min(1, b.cb * 1.2 * dimZ2),
          )
          // 자체 발광 틴트 — 항성 없는 곳의 행성도 제 색으로 은은히 빛난다
          mat.emissive.setRGB(
            Math.min(0.4, b.cr * 0.22), Math.min(0.38, b.cg * 0.2), Math.min(0.42, b.cb * 0.24),
          )
          planetN++
        } else if (litN < MAX_INST) {
          this.lit.setMatrixAt(litN, this.m4)
          this.col.setRGB(
            Math.min(1, b.cr * (1 + redK * 0.8)),
            Math.min(1, b.cg * (1 - redK * 0.7)),
            Math.min(1, b.cb * (1 - redK * 0.9)),
          )
          this.lit.setColorAt(litN, this.col)
          litN++
        }
        // 행성 대기 림 — 대기 조성이 곧 색이다. 태양계 밖 행성도 은은한 대기를 두른다
        const rim = ATMOS.get(b.id) ??
          (globe && b.r >= 6 ? ([b.cr * 0.5, b.cg * 0.55, b.cb * 0.85] as const) : undefined)
        if (rim && glowN < MAX_GLOW - 1) {
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * 2.6)
          sp.material.color.setRGB(rim[0], rim[1], rim[2])
          sp.material.opacity = 0.22
          if (b.id === EARTH_ID) {
            // 오로라 — 태양풍이 극에 쏟아진다
            const au = this.glows[glowN++]!
            au.visible = true
            au.position.set(ax, ay + sc * 1.05, az)
            au.scale.setScalar(sc * 1.1 * (1 + 0.2 * Math.sin(t * 3)))
            au.material.color.setRGB(0.3, 1.1, 0.5)
            au.material.opacity = 0.3
          }
        }
        // 혜성 머리 — 코마의 빛
        if (b.kind === BodyKind.Comet && glowN < MAX_GLOW) {
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * 3.2)
          sp.material.color.setRGB(0.7, 0.85, 1.1)
          sp.material.opacity = 0.35
        }
        // 고리 행성 — 토성의 고리가 드디어 3D 로 (카시니 간극 포함)
        if (b.kind === BodyKind.Ringed && ringN < this.rings.length) {
          const rm = this.rings[ringN++]!
          rm.visible = true
          rm.position.set(ax, ay, az)
          rm.scale.setScalar(sc)
          rm.rotation.x = -Math.PI / 2 + ((b.id % 100) - 50) * 0.006
          ;(rm.material as THREE.MeshBasicMaterial).color.setRGB(1, 1, 1)
          ;(rm.material as THREE.MeshBasicMaterial).opacity = 0.85
        }
      }
      // 먹이 금테 — 멀리서도 보여야 "먹을 게 있다"가 된다
      if (markN < MAX_MARK && b.r < R * 0.8 && b.r >= R * 0.1) {
        const dx = b.x - g.x
        const dy = b.y - g.y
        if (dx * dx + dy * dy < dist * dist * 36) {
          const sp = this.marks[markN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(Math.max(sc * 3, dist * 0.012))
        }
      }
    }
    this.lit.count = litN
    this.lit.instanceMatrix.needsUpdate = true
    if (this.lit.instanceColor) this.lit.instanceColor.needsUpdate = true
    this.emis.count = emisN
    this.emis.instanceMatrix.needsUpdate = true
    if (this.emis.instanceColor) this.emis.instanceColor.needsUpdate = true
    for (let i = glowN; i < MAX_GLOW; i++) this.glows[i]!.visible = false
    for (let i = markN; i < MAX_MARK; i++) this.marks[i]!.visible = false
    for (let i = ringN; i < this.rings.length; i++) this.rings[i]!.visible = false
    for (let i = nebN; i < MAX_NEB; i++) this.nebSprites[i]!.visible = false
    for (let i = planetN; i < this.planetMeshes.length; i++) this.planetMeshes[i]!.visible = false
    for (let i = starN; i < this.starMeshes.length; i++) this.starMeshes[i]!.visible = false

    // 게 펄서 — 등대 빔 두 줄기가 자기축을 따라 쓸고 돈다 (게 성운의 심장)
    if (pulsarSeen) {
      const ang = t * 8
      const tilt = 0.72
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1
        const bm = this.pulsarBeams[i]!
        bm.visible = true
        this.v3.set(
          Math.sin(tilt) * Math.cos(ang) * s,
          Math.cos(tilt) * s,
          Math.sin(tilt) * Math.sin(ang) * s,
        )
        this.s3.set(0, 1, 0)
        bm.quaternion.setFromUnitVectors(this.s3, this.v3)
        bm.position.set(pulsarX, pulsarY, pulsarZ)
        const len = Math.max(900, pulsarR * 70)
        bm.scale.set(len * 0.16, len, len * 0.16)
        ;(bm.material as THREE.MeshBasicMaterial).opacity =
          0.1 + 0.16 * Math.max(0, Math.sin(t * 24 + i * Math.PI))
      }
    } else {
      for (const bm of this.pulsarBeams) bm.visible = false
    }

    // 가스 — 구름·연기
    const gas = (g as unknown as { gas: { x: number; y: number; z: number; life: number; max: number; size: number; cr: number; cg: number; cb: number }[] }).gas
    for (let i = 0; i < MAX_GAS; i++) {
      const src = gas[i]!
      const sp = this.gasSprites[i]!
      if (src.life <= 0) {
        sp.visible = false
        continue
      }
      const k = src.life / src.max
      sp.visible = true
      sp.position.set(src.x - oX3, src.z - oZ3, src.y - oY3)
      sp.scale.setScalar(src.size * 1.7)
      // 회전 변주 — 같은 텍스처의 복붙 떡 방지
      sp.material.rotation = i * 2.39996 + (1 - k) * 0.6
      sp.material.color.setRGB(src.cr * k, src.cg * k, src.cb * k)
      sp.material.opacity = k * 0.26
    }

    // 라이벌
    for (let i = 0; i < this.rivalMeshes.length; i++) {
      const m = this.rivalMeshes[i]!
      const sp = this.rivalGlow[i]!
      const rg = this.rivalRing[i]!
      const rv = g.rivals[i]
      if (!rv) {
        m.visible = false
        sp.visible = false
        rg.visible = false
        continue
      }
      const rr = bhRadius(rv.vol)
      const rBody = bodyRof(rr)
      m.visible = true
      m.position.set(rv.x - oX3, rv.z - oZ3, rv.y - oY3)
      m.scale.setScalar(rBody) // 검은 몸은 작다 — 후광(영향권)이 크기를 말한다
      const threat = rr > R
      sp.visible = true
      sp.position.copy(m.position)
      sp.scale.setScalar(Math.max(rr * 4.5, dist * 0.03))
      sp.material.color.setRGB(threat ? 1.6 : 0.7, threat ? 0.3 : 0.65, threat ? 0.22 : 0.75)
      sp.material.opacity = 0.85
      rg.visible = true
      rg.position.copy(m.position)
      rg.scale.setScalar(rBody * 2.2)
      rg.material.color.setRGB(1.6, 1.2, 0.7)
      rg.material.opacity = 0.9
    }

    // 은하 — 내가 거느린 별들. 내가 움직이면 은하째 따라온다
    let haloN = 0
    for (const h of g.halo) {
      if (haloN >= 400) break
      const rr = h.k * R
      // 나선팔 밀도파 — 원반 별은 두 로그나선 팔 근처에 군집한다 (린-샤우)
      const spiral = h.tier === 1 ? h.arm * Math.PI + Math.log(h.k / 2.2) * 2.4 : 0
      const ca = Math.cos(h.ang + spiral)
      const sa = Math.sin(h.ang + spiral)
      this.v3.set(
        px + ca * rr,
        py + sa * rr * Math.sin(h.inc),
        pz + sa * rr * Math.cos(h.inc),
      )
      // 크기 바닥 R·0.045 — 0.02는 시야(R·20+)의 0.1%라 있어도 안 보였다
      // ("별들 안 보여": 실플레이). 상한 R·0.14 — 별이 몸을 가리면 안 된다.
      this.s3.setScalar(Math.min(R * 0.14, Math.max(h.size, R * 0.045)))
      this.m4.compose(this.v3, this.q0, this.s3)
      this.haloMesh.setMatrixAt(haloN, this.m4)
      // 별의 나이 — 갓 태어난 별은 청백색, 60초에 걸쳐 식는다. 팽대부는 늙고 붉다
      const youth = Math.max(0, 1 - h.age / 60)
      let hr = h.cr * (1 - youth * 0.25)
      let hg = h.cg
      let hb = Math.min(1.3, h.cb + youth * 0.5)
      if (h.tier === 0) {
        hr = Math.min(1.2, hr + 0.3)
        hb *= 0.6
      }
      this.col.setRGB(Math.min(1, hr), Math.min(1, hg), Math.min(1, hb))
      this.haloMesh.setColorAt(haloN, this.col)
      haloN++
    }
    this.haloMesh.count = haloN
    this.haloMesh.instanceMatrix.needsUpdate = true
    if (this.haloMesh.instanceColor) this.haloMesh.instanceColor.needsUpdate = true

    // 나선낙하 — 상대가 미친 속도로 나를 감아 돈다 (LIGO)
    if (g.merging) {
      const mg = g.merging
      const rr = bodyRof(bhRadius(mg.vol))
      this.mergeMesh.visible = true
      this.mergeMesh.position.set(
        px + Math.cos(mg.ang) * mg.rad,
        py + mg.z,
        pz + Math.sin(mg.ang) * mg.rad,
      )
      this.mergeMesh.scale.setScalar(rr)
      this.mergeGlow.visible = true
      this.mergeGlow.position.copy(this.mergeMesh.position)
      this.mergeGlow.scale.setScalar(rr * 3.5)
      this.mergeGlow.material.opacity = 0.9
    } else {
      this.mergeMesh.visible = false
      this.mergeGlow.visible = false
    }
    // 중력파 — 퍼지는 고리
    for (let i = 0; i < this.waves.length; i++) {
      const wv = this.waves[i]!
      const k = (g.waveT - i * 0.22) / 1.6
      if (k > 0 && k < 1) {
        wv.visible = true
        wv.position.set(g.waveX - oX3, g.waveZ - oZ3, g.waveY - oY3)
        wv.scale.setScalar(R * (2 + k * 60))
        ;(wv.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.6
      } else {
        wv.visible = false
      }
    }

    // 나 + 원반 + 제트 — 검은 몸(BR)은 작고, 원반·제트(영향권 R)는 거대하다.
    // 실물리 그대로: M87 제트는 지평선의 수만 배다.
    this.playerMesh.position.set(px, py, pz)
    this.playerMesh.scale.setScalar(BR)
    // 지구→블랙홀 붕괴 — 30초 동안 지구 껍질이 조여들며 빛을 잃는다
    {
      const morph = g.morph
      if (morph < 1) {
        this.earthMorphMesh.visible = true
        this.earthMorphMesh.position.set(px, py, pz)
        this.earthMorphMesh.scale.setScalar(Math.max(BR, R * (1 - morph * 0.94)))
        this.earthMorphMesh.rotation.y = t * 0.2
        const dim = Math.max(0.06, 1 - morph * 1.05)
        const em = this.earthMorphMesh.material as THREE.MeshLambertMaterial
        em.color.setRGB(0.53 * dim, 0.7 * dim, 0.92 * dim)
      } else {
        this.earthMorphMesh.visible = false
      }
    }
    this.disk.position.set(px, py, pz)
    // 원반은 몸 눈금 + **가르강튀아 지수** — 커질수록 원반이 넓어지고(최대
    // 4배) 항상 은은히 타오른다 ("커지면 이펙트를 더 화려하고 넓게": 실플레이).
    // 티끌 눈금에선 grand≈0 이라 "장식이 몸보다 큰" 과거 판정은 재발 안 한다.
    const grand = Math.min(3, R / 300)
    const diskR = Math.min(R, BR * 3) * (1 + grand)
    this.disk.scale.setScalar(diskR * Math.max(0.001, g.morph))
    this.diskMat.uniforms['uTime']!.value = t
    this.diskMat.uniforms['uFeed']!.value = Math.min(1, g.feed + g.quasar * 0.7 + grand * 0.12)
    this.diskMat.uniforms['uInner']!.value = Math.max(0.02, (BR / Math.max(1, diskR)) * 1.2)
    this.bloom.strength = 0.5 + grand * 0.35
    // 호킹 색온도 T∝1/M — 질량이 클수록 검붉게 (조사 ②-8, 계수 1.23e23 정정판)
    const hawkT = Math.max(0, Math.min(1, 1.1 - Math.log10(g.vol + 10) / 9))
    this.diskMat.uniforms['uTemp']!.value = hawkT
    this.lensPass.uniforms['uTemp']!.value = hawkT
    // 도플러용 카메라 시선 (원반 평면 투영)
    {
      const cdx = this.camera.position.x - px
      const cdz = this.camera.position.z - pz
      const cl = Math.hypot(cdx, cdz) || 1
      ;(this.diskMat.uniforms['uCam']!.value as THREE.Vector2).set(cdx / cl, cdz / cl)
    }
    // 제트는 스핀이 민다 (BZ 과정 ∝ a² — 조사 ②-23)
    const jetK = 0.5 + g.spin * 0.8
    for (let i = 0; i < this.jets.length; i++) {
      const jet = this.jets[i]!
      const s = i === 0 ? 1 : -1
      const power = g.quasar * jetK
      jet.position.set(px, py + s * R * 2.6 * Math.max(0.3, power), pz)
      jet.scale.set(R * (0.5 + power), R * (0.6 + power * 2.2), R * (0.5 + power))
      ;(jet.material as THREE.MeshBasicMaterial).opacity = power * 0.5
    }

    // 렌즈 — 검은 그림자는 몸(BR), 왜곡은 영향권(R 의 √눈금): 분리가 성장의 문법
    this.v3.set(px, py, pz).project(this.camera)
    const w = this.renderer.domElement.clientWidth
    const h = Math.max(1, this.renderer.domElement.clientHeight)
    this.lensPass.uniforms['uHole']!.value.set((this.v3.x + 1) / 2, (this.v3.y + 1) / 2)
    // 휴면 블랙홀은 티끌이다 — 그림자·왜곡을 작게, 성장(질량)에만 비례해 커진다
    // ("지금도 크잖아": 몸이 아니라 이 장식들이 컸다)
    const screenK = Math.tan((this.camera.fov * Math.PI) / 360) * dist * 2
    // 붕괴 중엔 렌즈도 태아다 — 그림자·왜곡이 morph 로 차오르고,
    // 커지면 가르강튀아 지수로 넓어진다 (grand = min(3, R/300))
    const grandL = Math.min(3, R / 300)
    this.lensPass.uniforms['uR']!.value =
      Math.max(0.003, (BR * 0.6 * (1 + grandL * 0.35) * g.morph) / screenK)
    this.lensPass.uniforms['uE']!.value =
      Math.max(0.008, ((BR + (R - BR) * 0.18) * (1 + grandL * 0.8) * g.morph) / screenK)
    this.lensPass.uniforms['uAspect']!.value = w / h
    this.lensPass.uniforms['uQuasar']!.value = g.quasar
    // 중력파 → 렌즈 물결
    if (g.waveT < 1.6) {
      this.v3.set(g.waveX - oX3, g.waveZ - oZ3, g.waveY - oY3).project(this.camera)
      this.lensPass.uniforms['uWaveC']!.value.set((this.v3.x + 1) / 2, (this.v3.y + 1) / 2)
      this.lensPass.uniforms['uWaveT']!.value = this.v3.z < 1 ? g.waveT : 9
    } else {
      this.lensPass.uniforms['uWaveT']!.value = 9
    }
    // 퀘이사 점화 — 화면 전체가 뜨거워진다 (그래도 절제)
    this.bloom.strength = 0.5 + g.quasar * 0.45
  }

  render(): void {
    this.composer.render()
    // 기준 도구는 렌즈·블룸의 영향 밖에서 그린다
    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.render(this.overlay, this.camera)
    this.renderer.autoClear = true
  }
}
