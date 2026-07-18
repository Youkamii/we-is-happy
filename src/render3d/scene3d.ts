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
import { LY, STAR_MAP } from '../game/starmap'
import { BodyKind, type Voyage } from '../game/voyage'

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

/** 중력 렌즈 — 화면 공간에서 지평선 둘레로 배경을 휜다 (슈바르츠실트 흉내) */
const LENS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uHole: { value: new THREE.Vector2(0.5, 0.5) },
    uR: { value: 0.05 },
    uAspect: { value: 1.77 },
    uWaveC: { value: new THREE.Vector2(0.5, 0.5) },
    uWaveT: { value: 9 },
    uQuasar: { value: 0 },
  },
  vertexShader: `varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv;
uniform sampler2D tDiffuse; uniform vec2 uHole; uniform float uR; uniform float uAspect;
uniform vec2 uWaveC; uniform float uWaveT; uniform float uQuasar;
void main(){
  vec2 p = vUv - uHole; p.x *= uAspect;
  float d = length(p);
  vec2 dir = d > 1e-4 ? p / d : vec2(0.0,1.0);
  // 렌즈 방정식 β = θ − α — 배경은 바깥으로 밀리고, 정렬되면 아인슈타인 링이 맺힌다.
  // (예전엔 부호가 반대라 빨아들이는 발산 렌즈였다 — 링이 원리적으로 불가능했다)
  // 왜곡은 지평선 근방으로 국한 — 광각으로 걸면 다가가는 천체의 상이
  // 바깥으로 밀려 "가까이 가면 멀어져 보이는" 착시가 생긴다
  float defl = (uR*uR*1.6) / max(d, uR*0.4);
  defl *= 1.0 - smoothstep(uR*2.6, uR*5.0, d);
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
  // 사건의 지평선 — 렌즈 다음에 깎아야 진짜 검다
  col = mix(col, vec3(0.0), smoothstep(uR*1.02, uR*0.88, d));
  // 광자 고리 — 임계곡선으로 수렴하는 서브링들 + 도플러 비대칭 (EHT)
  float angH = atan(p.y, p.x);
  float dopp = 1.0 + 0.35 * sin(angH);
  float hot = 1.0 + uQuasar * 0.8;
  float ring1 = exp(-pow((d - uR*1.10)/(uR*0.035), 2.0));
  float ring2 = exp(-pow((d - uR*1.03)/(uR*0.013), 2.0));
  col += vec3(1.5,1.1,0.65) * (ring1*0.4 + ring2*0.24) * dopp * hot;
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
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  // 뭉게 — 반경 그라디언트 여러 방울
  let s = 7
  const rnd = (): number => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  for (let i = 0; i < 9; i++) {
    const x = 34 + rnd() * 60
    const y = 34 + rnd() * 60
    const r = 18 + rnd() * 30
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.34)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  }
  return new THREE.CanvasTexture(c)
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
  pitch = 0.62
  zoomBias = 1

  private readonly lit: THREE.InstancedMesh
  private readonly emis: THREE.InstancedMesh
  /** 은하화된 별들 — 나를 도는 나의 은하 */
  private readonly haloMesh: THREE.InstancedMesh
  private readonly rings: THREE.Mesh[] = []
  private readonly glows: THREE.Sprite[] = []
  private readonly gasSprites: THREE.Sprite[] = []
  private readonly marks: THREE.Sprite[] = []
  private readonly playerMesh: THREE.Mesh
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

  private readonly ecliptic: THREE.PolarGridHelper
  /** 랜드마크 — 실지도 항성계는 아무리 멀어도 밝은 별점으로 보인다 (항법의 잣대) */
  private readonly landmarks: THREE.Sprite[] = []
  private readonly labelBox: HTMLDivElement
  private readonly labels: HTMLDivElement[] = []
  /** 축 표시기 — three(X,Y,Z)=(빨,초,파) = 게임 (x, z↑, y). X 키 토글 */
  readonly axes: THREE.AxesHelper
  private readonly m4 = new THREE.Matrix4()
  private readonly q0 = new THREE.Quaternion()
  private readonly v3 = new THREE.Vector3()
  private readonly s3 = new THREE.Vector3()
  private readonly col = new THREE.Color()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.scene = new THREE.Scene()
    this.overlay = new THREE.Scene()
    this.scene.background = new THREE.Color(0x030510)
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.00004)
    this.camera = new THREE.PerspectiveCamera(58, 1.77, 1, 400000)

    // 우주는 칠흑이지만 게임은 보여야 한다 — 은은한 전역광 + 반대편 보조광
    this.scene.add(new THREE.AmbientLight(0x9aa8c8, 1.25))
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.4)
    this.scene.add(this.sun)
    const fill = new THREE.DirectionalLight(0x6677aa, 0.4)
    fill.position.set(-3, -2, -4)
    this.scene.add(fill)

    const glowTex = glowTexture()
    const smokeTex = smokeTexture()

    const sphere = new THREE.SphereGeometry(1, 20, 14)
    const litMat = new THREE.MeshLambertMaterial()
    litMat.emissive = new THREE.Color(0x1c2436) // 완전 검정으로는 안 떨어진다
    this.lit = new THREE.InstancedMesh(sphere, litMat, MAX_INST)
    this.lit.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.lit)
    this.emis = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial(), 600)
    this.emis.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.emis)
    this.haloMesh = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial(), 400)
    this.haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.haloMesh)
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

    // 나 — 빛의 부재. 구체는 검고, 지평선·광자 고리는 렌즈 셰이더가 마무리한다
    this.playerMesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0x000000 }))
    this.scene.add(this.playerMesh)
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
      uniforms: { uTime: { value: 0 }, uFeed: { value: 0 } },
      vertexShader: `varying vec2 vP;
void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vP;
uniform float uTime; uniform float uFeed;
void main(){
  float r = length(vP);
  float T = pow(1.35/r, 0.75);
  vec3 col = mix(vec3(1.0,0.36,0.12), vec3(1.15,1.3,1.55), smoothstep(0.55,1.0,T));
  float phi = atan(vP.y,vP.x) - uTime*1.7*inversesqrt(r*r*r);
  float beam = pow(1.0 + 0.28*sin(atan(vP.y,vP.x))/sqrt(r), 2.0);
  float streak = 0.84 + 0.16*sin(phi*9.0 + r*14.0);
  float alpha = (1.0-smoothstep(1.4,3.1,r)) * smoothstep(1.32,1.5,r) * (0.2+uFeed*0.45);
  gl_FragColor = vec4(col*beam*streak, alpha);
}`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.disk = new THREE.Mesh(new THREE.RingGeometry(1.35, 3.1, 72), this.diskMat)
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
    this.ecliptic = new THREE.PolarGridHelper(1, 12, 10, 56, 0x33477a, 0x1c2a4d)
    const em = this.ecliptic.material as THREE.Material
    em.transparent = true
    em.opacity = 0.22
    em.depthWrite = false
    this.overlay.add(this.ecliptic)

    this.axes = new THREE.AxesHelper(1)
    const am = this.axes.material as THREE.Material
    am.transparent = true
    am.opacity = 0.75
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

    // 랜드마크 별점 + 이름 라벨
    for (let i = 0; i < STAR_MAP.length; i++) {
      const sys = STAR_MAP[i]!
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
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
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div')
      d.style.cssText =
        'position:absolute;font:600 11px/1.4 ui-monospace,monospace;color:#c9a35f;' +
        'text-shadow:0 0 6px rgba(0,0,0,.9);white-space:nowrap;display:none;'
      this.labels.push(d)
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
      this.zoomBias = Math.min(2.4, Math.max(0.45, this.zoomBias * (e.deltaY > 0 ? 1.1 : 0.9)))
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
    const px = g.x
    const py = g.z // three y = 게임 z (위)
    const pz = g.y

    // 카메라 — 내가 보이되 세계를 가리지 않는 거리
    const dist = g.camera.viewHeight * 0.78 * this.zoomBias
    const cp = Math.cos(this.pitch)
    this.camera.position.set(
      px + Math.sin(this.yaw) * cp * dist,
      py + Math.sin(this.pitch) * dist,
      pz + Math.cos(this.yaw) * cp * dist,
    )
    this.camera.lookAt(px, py, pz)
    this.camera.far = dist * 60
    this.camera.near = Math.max(0.5, dist * 0.002)
    this.camera.updateProjectionMatrix()
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = 0.5 / (dist * 18)
    this.stars.position.copy(this.camera.position)
    this.stars.scale.setScalar(dist * 40)
    // 기준면은 황도(z=0)에 고정 — 내가 뜨고 가라앉는 게 이 면을 잣대로 읽힌다
    this.ecliptic.position.set(px, 0, pz)
    this.ecliptic.scale.setScalar(dist * 3.2)
    this.axes.position.set(px, py, pz)
    this.axes.scale.setScalar(dist * 0.22)

    // 랜드마크 — 실지도 항성계를 하늘의 별점으로. 가까운 넷엔 이름·광년 라벨
    const w0 = this.renderer.domElement.clientWidth
    const h0 = Math.max(1, this.renderer.domElement.clientHeight)
    let labelN = 0
    const skyR = dist * 30
    for (let i = 0; i < STAR_MAP.length; i++) {
      const sys = STAR_MAP[i]!
      const sp = this.landmarks[i]!
      const dx = sys.x - px
      const dy = sys.z - py
      const dz = sys.y - pz
      const d3 = Math.hypot(dx, dy, dz) || 1
      if (d3 < dist * 12) {
        sp.visible = false // 실제 지오메트리가 보이는 거리 — 별점은 물러난다
        continue
      }
      sp.visible = true
      sp.position.set(px + (dx / d3) * skyR, py + (dy / d3) * skyR, pz + (dz / d3) * skyR)
      const imp = sys.kind === 'core' ? 2.6 : sys.kind === 'garden' ? 1.7 : 1
      sp.scale.setScalar(skyR * 0.01 * imp)
      sp.material.opacity = 0.6
      // 라벨 — 화면 안에 있고 가까운 순 다섯
      if (labelN < 5) {
        this.v3.copy(sp.position).project(this.camera)
        if (this.v3.z < 1 && Math.abs(this.v3.x) < 0.95 && Math.abs(this.v3.y) < 0.92) {
          const lb = this.labels[labelN++]!
          lb.style.display = 'block'
          lb.style.left = `${((this.v3.x + 1) / 2) * w0 + 8}px`
          lb.style.top = `${((1 - this.v3.y) / 2) * h0 - 6}px`
          const lyd = d3 / LY
          lb.textContent = `${sys.name} · ${lyd >= 1 ? `${lyd.toFixed(1)}광년` : `${Math.round(d3 / 1000)}k`}`
        }
      }
    }
    for (let i = labelN; i < 5; i++) this.labels[i]!.style.display = 'none'

    // 조명 — 가장 가까운 태양이 태양이다
    let sunB: { x: number; y: number; z: number } | null = null
    let sunD = Infinity
    let litN = 0
    let emisN = 0
    let glowN = 0
    let markN = 0
    let ringN = 0
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
      this.sun.position.set(sunB.x - px, sunB.z - py + 1, sunB.y - pz)
      this.sun.intensity = 1.4
    } else {
      this.sun.position.set(1, 2, 1)
      this.sun.intensity = 0.7
    }
    this.sun.position.normalize().multiplyScalar(10)
    this.sun.target.position.set(0, 0, 0)

    // 천체
    for (const b of g.active) {
      const bx = b.x
      const by = b.z
      const bz = b.y
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
      this.v3.set(ax, ay, az)
      this.s3.setScalar(Math.max(0.6, sc))
      this.m4.compose(this.v3, this.q0, this.s3)
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
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * 5.5 * pulse)
          sp.material.color.setRGB(b.cr * 0.6 * mottle, b.cg * 0.5, b.cb * 0.3)
          sp.material.opacity = 0.5
          const core = this.glows[glowN++]!
          core.visible = true
          core.position.set(ax, ay, az)
          core.scale.setScalar(sc * 2.3 * pulse)
          core.material.color.setRGB(1.4, 1.3, 1.1)
          core.material.opacity = 0.6
        }
      } else if (litN < MAX_INST) {
        this.lit.setMatrixAt(litN, this.m4)
        this.col.setRGB(
          Math.min(1, b.cr * (1 + redK * 0.8)),
          Math.min(1, b.cg * (1 - redK * 0.7)),
          Math.min(1, b.cb * (1 - redK * 0.9)),
        )
        this.lit.setColorAt(litN, this.col)
        litN++
        // 행성 대기 림 — 대기 조성이 곧 색이다 (지구 청색, 금성 황백, 천왕성 청록…)
        const rim = ATMOS.get(b.id)
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
          ;(rm.material as THREE.MeshBasicMaterial).opacity = 0.85
        }
      }
      // 성운·은하심 — 큰 연기 후광
      if ((b.kind === BodyKind.Garden || b.kind === BodyKind.Core) && glowN < MAX_GLOW) {
        const sp = this.glows[glowN++]!
        sp.visible = true
        sp.position.set(ax, ay, az)
        sp.scale.setScalar(sc * 3.2)
        sp.material.color.setRGB(b.cr * 0.5, b.cg * 0.45, b.cb * 0.6)
        sp.material.opacity = 0.4
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
      sp.position.set(src.x, src.z, src.y)
      sp.scale.setScalar(src.size * 2.4)
      sp.material.color.setRGB(src.cr * k, src.cg * k, src.cb * k)
      sp.material.opacity = k * 0.35
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
      const rr = Math.cbrt(rv.vol)
      m.visible = true
      m.position.set(rv.x, rv.z, rv.y)
      m.scale.setScalar(rr)
      const threat = rr > R
      sp.visible = true
      sp.position.copy(m.position)
      sp.scale.setScalar(Math.max(rr * 4.5, dist * 0.03))
      sp.material.color.setRGB(threat ? 1.6 : 0.7, threat ? 0.3 : 0.65, threat ? 0.22 : 0.75)
      sp.material.opacity = 0.85
      rg.visible = true
      rg.position.copy(m.position)
      rg.scale.setScalar(rr * 1.9)
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
      this.s3.setScalar(Math.max(h.size, R * 0.02))
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
      const rr = Math.cbrt(mg.vol)
      this.mergeMesh.visible = true
      this.mergeMesh.position.set(
        px + Math.cos(mg.ang) * mg.rad,
        py + mg.z,
        pz + Math.sin(mg.ang) * mg.rad,
      )
      this.mergeMesh.scale.setScalar(rr)
      this.mergeGlow.visible = true
      this.mergeGlow.position.copy(this.mergeMesh.position)
      this.mergeGlow.scale.setScalar(rr * 3)
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
        wv.position.set(g.waveX, g.waveZ, g.waveY)
        wv.scale.setScalar(R * (2 + k * 60))
        ;(wv.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.6
      } else {
        wv.visible = false
      }
    }

    // 나 + 원반 + 제트
    this.playerMesh.position.set(px, py, pz)
    this.playerMesh.scale.setScalar(R)
    this.disk.position.set(px, py, pz)
    this.disk.scale.setScalar(R)
    this.diskMat.uniforms['uTime']!.value = t
    this.diskMat.uniforms['uFeed']!.value = Math.min(1, g.feed + g.quasar * 0.7)
    for (let i = 0; i < this.jets.length; i++) {
      const jet = this.jets[i]!
      const s = i === 0 ? 1 : -1
      const power = g.quasar
      jet.position.set(px, py + s * R * 2.6 * Math.max(0.3, power), pz)
      jet.scale.set(R * (0.5 + power), R * (0.6 + power * 2.2), R * (0.5 + power))
      ;(jet.material as THREE.MeshBasicMaterial).opacity = power * 0.5
    }

    // 렌즈 — 내 화면 위치와 화면 반지름
    this.v3.set(px, py, pz).project(this.camera)
    const w = this.renderer.domElement.clientWidth
    const h = Math.max(1, this.renderer.domElement.clientHeight)
    this.lensPass.uniforms['uHole']!.value.set((this.v3.x + 1) / 2, (this.v3.y + 1) / 2)
    const rScreen = R / (Math.tan((this.camera.fov * Math.PI) / 360) * dist * 2)
    // 렌즈는 존재 증명이되 화면을 먹으면 안 된다 — 실크기 기준, 바닥만 살짝
    this.lensPass.uniforms['uR']!.value = Math.max(0.013, rScreen)
    this.lensPass.uniforms['uAspect']!.value = w / h
    this.lensPass.uniforms['uQuasar']!.value = g.quasar
    // 중력파 → 렌즈 물결
    if (g.waveT < 1.6) {
      this.v3.set(g.waveX, g.waveZ, g.waveY).project(this.camera)
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
