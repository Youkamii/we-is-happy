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
import { LY, STAR_MAP } from '../game/starmap'
import { BodyKind, type Voyage } from '../game/voyage'

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
  },
  vertexShader: `varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv;
uniform sampler2D tDiffuse; uniform vec2 uHole; uniform float uR; uniform float uAspect;
void main(){
  vec2 p = vUv - uHole; p.x *= uAspect;
  float d = length(p);
  vec2 dir = d > 1e-4 ? p / d : vec2(0.0,1.0);
  float defl = (uR*uR*2.3) / max(d - uR*0.3, uR*0.4);
  vec2 uv = vUv + vec2(dir.x/uAspect, dir.y) * defl;
  vec3 col = texture2D(tDiffuse, uv).rgb;
  // 사건의 지평선 — 렌즈 다음에 깎아야 진짜 검다
  col = mix(col, vec3(0.0), smoothstep(uR*1.02, uR*0.88, d));
  // 광자 고리
  float ring = exp(-abs(d - uR*1.06)/(uR*0.05));
  col += vec3(1.4,1.05,0.6) * ring * 0.7;
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

function diskTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 32
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 256, 0)
  g.addColorStop(0, 'rgba(255,190,110,0.9)')
  g.addColorStop(0.35, 'rgba(255,130,50,0.5)')
  g.addColorStop(1, 'rgba(120,60,160,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 32)
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

  /** 카메라 방위각 — 오른쪽 드래그로 돈다. 이동(WASD)은 이 기준으로 변환된다 */
  yaw = 0
  pitch = 0.62
  zoomBias = 1

  private readonly lit: THREE.InstancedMesh
  private readonly emis: THREE.InstancedMesh
  private readonly glows: THREE.Sprite[] = []
  private readonly gasSprites: THREE.Sprite[] = []
  private readonly marks: THREE.Sprite[] = []
  private readonly playerMesh: THREE.Mesh
  private readonly disk: THREE.Mesh
  private readonly stars: THREE.Points
  private readonly sun: THREE.DirectionalLight
  private readonly rivalMeshes: THREE.Mesh[] = []
  private readonly rivalGlow: THREE.Sprite[] = []

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
    this.scene.add(new THREE.AmbientLight(0x9aa8c8, 0.85))
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.4)
    this.scene.add(this.sun)
    const fill = new THREE.DirectionalLight(0x6677aa, 0.4)
    fill.position.set(-3, -2, -4)
    this.scene.add(fill)

    const glowTex = glowTexture()
    const smokeTex = smokeTexture()

    const sphere = new THREE.SphereGeometry(1, 20, 14)
    const litMat = new THREE.MeshLambertMaterial()
    litMat.emissive = new THREE.Color(0x101623) // 완전 검정으로는 안 떨어진다
    this.lit = new THREE.InstancedMesh(sphere, litMat, MAX_INST)
    this.lit.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.lit)
    this.emis = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial(), 600)
    this.emis.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.emis)

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
    this.disk = new THREE.Mesh(
      new THREE.RingGeometry(1.35, 3.1, 72),
      new THREE.MeshBasicMaterial({
        map: diskTexture(), blending: THREE.AdditiveBlending, transparent: true,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    )
    this.disk.rotation.x = -Math.PI / 2
    this.scene.add(this.disk)

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
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.7, 0.82)
    this.composer.addPass(bloom)
    this.lensPass = new ShaderPass(LENS_SHADER)
    this.composer.addPass(this.lensPass)

    // 카메라 조작 — 왼쪽 드래그 회전, 휠 줌. 오른쪽 버튼은 아무것도 하지 않는다.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && e.pointerType !== 'touch') {
        const startX = e.clientX
        const startY = e.clientY
        const y0 = this.yaw
        const p0 = this.pitch
        const move = (ev: PointerEvent): void => {
          this.yaw = y0 + (ev.clientX - startX) * 0.006
          // 아래(-)로도 내려간다 — 위를 올려다볼 수 있어야 3D 다 (실플레이)
          this.pitch = Math.min(1.35, Math.max(-1.35, p0 + (ev.clientY - startY) * 0.005))
        }
        const up = (): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }
    })
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

    // 카메라 — 뒤에서 비스듬히, 내가 화면에서 점이 되지 않을 만큼 가깝게
    const dist = g.camera.viewHeight * 0.58 * this.zoomBias
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
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = 0.9 / (dist * 18)
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
      sp.scale.setScalar(skyR * 0.014 * imp)
      sp.material.opacity = 0.85
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
      // 흡수 중이면 나선으로 감기며 줄어든다
      let sc = b.r
      let ax = bx
      let ay = by
      let az = bz
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
          break
        }
      }
      this.v3.set(ax, ay, az)
      this.s3.setScalar(Math.max(0.6, sc))
      this.m4.compose(this.v3, this.q0, this.s3)
      const isEmis = b.kind === BodyKind.Sun || b.hot
      if (isEmis && emisN < 600) {
        this.emis.setMatrixAt(emisN, this.m4)
        this.col.setRGB(Math.min(1, b.cr), Math.min(1, b.cg), Math.min(1, b.cb))
        this.emis.setColorAt(emisN, this.col)
        emisN++
        if (b.kind === BodyKind.Sun && glowN < MAX_GLOW) {
          const sp = this.glows[glowN++]!
          sp.visible = true
          sp.position.set(ax, ay, az)
          sp.scale.setScalar(sc * 6)
          sp.material.color.setRGB(b.cr * 0.6, b.cg * 0.5, b.cb * 0.3)
          sp.material.opacity = 0.55
        }
      } else if (litN < MAX_INST) {
        this.lit.setMatrixAt(litN, this.m4)
        this.col.setRGB(Math.min(1, b.cr), Math.min(1, b.cg), Math.min(1, b.cb))
        this.lit.setColorAt(litN, this.col)
        litN++
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
      sp.material.opacity = k * 0.5
    }

    // 라이벌
    for (let i = 0; i < this.rivalMeshes.length; i++) {
      const m = this.rivalMeshes[i]!
      const sp = this.rivalGlow[i]!
      const rv = g.rivals[i]
      if (!rv) {
        m.visible = false
        sp.visible = false
        continue
      }
      const rr = Math.cbrt(rv.vol)
      m.visible = true
      m.position.set(rv.x, rv.z, rv.y)
      m.scale.setScalar(rr)
      sp.visible = true
      sp.position.copy(m.position)
      sp.scale.setScalar(rr * 3.4)
      const threat = rr > R
      sp.material.color.setRGB(threat ? 1.2 : 0.5, threat ? 0.25 : 0.5, threat ? 0.2 : 0.55)
      sp.material.opacity = 0.5
    }

    // 나 + 원반
    this.playerMesh.position.set(px, py, pz)
    this.playerMesh.scale.setScalar(R)
    this.disk.position.set(px, py, pz)
    this.disk.scale.setScalar(R)
    this.disk.rotation.z = t * 0.5
    ;(this.disk.material as THREE.MeshBasicMaterial).opacity = 0.3 + g.feed * 0.55

    // 렌즈 — 내 화면 위치와 화면 반지름
    this.v3.set(px, py, pz).project(this.camera)
    const w = this.renderer.domElement.clientWidth
    const h = Math.max(1, this.renderer.domElement.clientHeight)
    this.lensPass.uniforms['uHole']!.value.set((this.v3.x + 1) / 2, (this.v3.y + 1) / 2)
    const rScreen = R / (Math.tan((this.camera.fov * Math.PI) / 360) * dist * 2)
    // 렌즈는 내 존재 증명이다 — 작아도 보이게 바닥값을 두고 살짝 부풀린다
    this.lensPass.uniforms['uR']!.value = Math.max(0.03, rScreen * 1.35)
    this.lensPass.uniforms['uAspect']!.value = w / h
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
