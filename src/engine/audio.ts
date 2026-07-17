/**
 * 절차적 오디오. 사운드 파일은 0개다.
 *
 * 모든 소리를 WebAudio 노드로 그 자리에서 합성한다. 후반엔 초당 수백 발이 나가므로
 * 두 가지가 필수다: (1) 보이스 상한 — 노드를 무제한으로 만들면 오디오 스레드가 죽는다,
 * (2) 같은 소리 스로틀 — 같은 프레임에 200발이 겹치면 클리핑으로 찢어진다.
 */

/** 동시에 살아있을 수 있는 최대 보이스 */
const MAX_VOICES = 24

export type SfxName =
  | 'shoot' | 'hit' | 'kill' | 'bigKill' | 'hurt' | 'pickup'
  | 'levelup' | 'evolve' | 'nova' | 'bolt' | 'blade' | 'death' | 'win'
  | 'boom'

interface Throttle {
  /** 이 소리를 다시 낼 수 있는 가장 이른 시각 (ctx.currentTime 기준) */
  next: number
  /** 최소 간격 (초) */
  gap: number
}

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private voices = 0
  private readonly throttles = new Map<SfxName, Throttle>()
  private musicTimer = 0
  private musicStep = 0
  /** 0..1 — 웨이브 압박도. 음악 레이어가 여기 따라 쌓인다. */
  intensity = 0
  muted = false
  private started = false

  /**
   * 브라우저 자동재생 정책 때문에 첫 사용자 입력 전에는 컨텍스트를 만들 수 없다.
   * (만들어도 suspended 로 태어난다.)
   */
  start(): void {
    if (this.started) return
    this.started = true
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor({ latencyHint: 'interactive' })
    } catch {
      return // 오디오가 없어도 게임은 돌아야 한다
    }
    const ctx = this.ctx

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.5
    // 후반에 동시 발음이 몰려도 찢어지지 않게 마스터에 리미터를 건다
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 24
    comp.ratio.value = 12
    comp.attack.value = 0.003
    comp.release.value = 0.18
    this.master.connect(comp)
    comp.connect(ctx.destination)

    this.sfxGain = ctx.createGain()
    this.sfxGain.gain.value = 1
    this.sfxGain.connect(this.master)

    this.musicGain = ctx.createGain()
    this.musicGain.gain.value = 0.42
    this.musicGain.connect(this.master)

    // 노이즈 버퍼 한 장을 구워 두고 재사용한다 (매번 만들면 GC 가 튄다)
    const len = Math.floor(ctx.sampleRate * 1.2)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02)
    }
  }

  private canPlay(name: SfxName, gap: number): boolean {
    if (!this.ctx || this.muted) return false
    if (this.voices >= MAX_VOICES) return false
    const now = this.ctx.currentTime
    let t = this.throttles.get(name)
    if (!t) {
      t = { next: 0, gap }
      this.throttles.set(name, t)
    }
    if (now < t.next) return false
    t.next = now + gap
    return true
  }

  private track(node: AudioScheduledSourceNode, endAt: number): void {
    this.voices++
    node.onended = () => { this.voices-- }
    node.stop(endAt)
  }

  /** 톤 하나. WebAudio 합성의 최소 단위. */
  private tone(
    type: OscillatorType,
    freq: number, freqTo: number,
    t0: number, dur: number,
    gain: number,
    dest: AudioNode,
    detune = 0,
  ): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (freqTo !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + dur)
    if (detune) osc.detune.value = detune
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(dest)
    osc.start(t0)
    this.track(osc, t0 + dur + 0.02)
  }

  /** 노이즈 버스트. 타격·폭발의 '탁' 하는 몸통. */
  private noise(
    t0: number, dur: number, gain: number,
    filterType: BiquadFilterType, freq: number, freqTo: number,
    dest: AudioNode,
  ): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = filterType
    f.frequency.setValueAtTime(freq, t0)
    if (freqTo !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + dur)
    f.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f)
    f.connect(g)
    g.connect(dest)
    src.start(t0)
    this.track(src, t0 + dur + 0.02)
  }

  play(name: SfxName): void {
    const ctx = this.ctx
    const sfx = this.sfxGain
    if (!ctx || !sfx) return
    const t = ctx.currentTime

    switch (name) {
      case 'shoot':
        // 초당 수십 발이라 아주 짧고 작아야 한다. 여기서 욕심내면 귀가 아프다.
        if (!this.canPlay('shoot', 0.045)) return
        this.tone('square', 620, 240, t, 0.055, 0.045, sfx)
        break

      case 'hit':
        if (!this.canPlay('hit', 0.035)) return
        this.noise(t, 0.05, 0.09, 'bandpass', 2600, 900, sfx)
        break

      case 'kill':
        if (!this.canPlay('kill', 0.05)) return
        this.noise(t, 0.1, 0.12, 'lowpass', 1800, 300, sfx)
        this.tone('triangle', 340, 120, t, 0.09, 0.06, sfx)
        break

      case 'bigKill':
        if (!this.canPlay('bigKill', 0.1)) return
        this.noise(t, 0.28, 0.24, 'lowpass', 900, 90, sfx)
        this.tone('sawtooth', 180, 44, t, 0.26, 0.14, sfx)
        break

      case 'hurt':
        if (!this.canPlay('hurt', 0.18)) return
        this.tone('sawtooth', 220, 70, t, 0.22, 0.2, sfx)
        this.noise(t, 0.16, 0.16, 'lowpass', 700, 160, sfx)
        break

      case 'pickup':
        if (!this.canPlay('pickup', 0.03)) return
        this.tone('sine', 880, 1320, t, 0.06, 0.05, sfx)
        break

      case 'levelup': {
        if (!this.canPlay('levelup', 0.3)) return
        // 완전5도 상승 아르페지오 — 짧고 확실한 보상음
        const notes = [523.25, 659.25, 783.99, 1046.5]
        notes.forEach((f, i) => this.tone('triangle', f, f, t + i * 0.055, 0.3, 0.11, sfx))
        break
      }

      case 'evolve': {
        if (!this.canPlay('evolve', 0.5)) return
        // 진화는 이 게임에서 가장 귀한 순간이라 유일하게 길게 간다
        const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5]
        notes.forEach((f, i) => {
          this.tone('sawtooth', f, f, t + i * 0.07, 0.5, 0.075, sfx, -6)
          this.tone('triangle', f * 2, f * 2, t + i * 0.07, 0.35, 0.05, sfx)
        })
        this.noise(t, 0.7, 0.1, 'highpass', 400, 5000, sfx)
        break
      }

      case 'nova':
        if (!this.canPlay('nova', 0.12)) return
        this.noise(t, 0.4, 0.2, 'bandpass', 300, 3200, sfx)
        this.tone('sine', 90, 260, t, 0.36, 0.12, sfx)
        break

      case 'bolt':
        if (!this.canPlay('bolt', 0.08)) return
        this.noise(t, 0.14, 0.16, 'highpass', 1800, 6000, sfx)
        this.tone('square', 1400, 380, t, 0.1, 0.05, sfx)
        break

      case 'blade':
        if (!this.canPlay('blade', 0.07)) return
        this.noise(t, 0.11, 0.1, 'bandpass', 4200, 1400, sfx)
        break

      case 'boom':
        // 포식 예고·시작 — 블랙홀이 숨을 들이쉬는 초저음. 배로 느껴져야 한다.
        if (!this.canPlay('boom', 0.5)) return
        this.tone('sine', 72, 26, t, 0.65, 0.5, sfx)
        this.noise(t, 0.5, 0.22, 'lowpass', 300, 40, sfx)
        break

      case 'death':
        this.tone('sawtooth', 160, 28, t, 1.4, 0.3, sfx)
        this.noise(t, 1.1, 0.28, 'lowpass', 1200, 60, sfx)
        break

      case 'win': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
        notes.forEach((f, i) => this.tone('triangle', f, f, t + i * 0.11, 0.6, 0.12, sfx))
        break
      }
    }
  }

  /** 심장박동 동기 모드에서 마지막으로 예약한 16분 인덱스 */
  private lastIdx16 = -1

  /**
   * 적응형 BGM. 압박이 커질수록 레이어가 쌓인다.
   *
   * **심장박동 동기**: beatClock(박 단위, 게임의 단일 박자원)을 받으면 16분 그리드를
   * 거기서 유도한다 — 킥이 곧 게임의 박이고, 마디 첫 박(s%16==0)은 강킥이다.
   * 무기 발사(8분음 양자화)·중력 펄스가 같은 시계에 물려 있으므로, 여기가 어긋나면
   * 리듬게임이 아니라 소음이 된다. 시뮬이 멈추면(일시정지·레벨업) 음악도 멈춘다.
   * beatClock 없이 부르면(타이틀·정지 화면) 자체 타이머로 돈다.
   */
  updateMusic(dt: number, beatClock = -1, bpm = 116): void {
    const ctx = this.ctx
    const bus = this.musicGain
    if (!ctx || !bus || this.muted) return

    if (beatClock >= 0) {
      const idx = Math.floor(beatClock * 4)
      if (idx <= this.lastIdx16) return
      // 탭 복귀 등으로 크게 밀렸으면 따라잡지 않는다 — 몰아 연주하면 소음이다
      if (idx - this.lastIdx16 > 8) this.lastIdx16 = idx - 1
      const t = ctx.currentTime + 0.02
      while (this.lastIdx16 < idx) {
        this.lastIdx16++
        this.scheduleStep(this.lastIdx16, t, bpm)
      }
      return
    }

    const selfBpm = 104 + this.intensity * 34
    const stepDur = 60 / selfBpm / 4
    this.musicTimer -= dt
    if (this.musicTimer > 0) return
    this.musicTimer += stepDur
    this.scheduleStep(this.musicStep++, ctx.currentTime + 0.02, selfBpm)
  }

  /** 시퀀서 16분 스텝 하나 예약. s 가 그리드 위치(마디 = 16)를 정한다. */
  private scheduleStep(s: number, t: number, _bpm: number): void {
    const bus = this.musicGain!
    const inten = this.intensity

    // 킥 — 박마다. 마디 첫 박은 블랙홀의 강박: 심장박동의 몸통이다.
    if (s % 4 === 0) {
      const strong = s % 16 === 0
      this.tone('sine', strong ? 168 : 150, strong ? 36 : 42, t, strong ? 0.2 : 0.15, strong ? 0.62 : 0.42, bus)
    }
    // 베이스 — 처음부터
    if (s % 2 === 0) {
      const root = BASS[Math.floor(s / 8) % BASS.length]!
      this.tone('triangle', root, root, t, 0.13, 0.22, bus)
    }
    // 하이햇 — 압박 20%부터
    if (inten > 0.2 && s % 2 === 1) {
      this.noise(t, 0.03, 0.05 + inten * 0.05, 'highpass', 7000, 9000, bus)
    }
    // 아르페지오 — 압박 45%부터
    if (inten > 0.45) {
      const n = ARP[s % ARP.length]!
      this.tone('square', n, n, t, 0.09, 0.05 + inten * 0.04, bus, 4)
    }
    // 리드 — 압박 75%부터. 마지막 1분이 다른 곡처럼 들려야 한다.
    if (inten > 0.75 && s % 8 === 0) {
      const n = LEAD[Math.floor(s / 8) % LEAD.length]!
      this.tone('sawtooth', n, n, t, 0.5, 0.055, bus, -8)
    }
  }

  // ready 게터가 있었지만 호출부 0이라 지웠다 (#9).
}

// A 에올리안 — 어둡고 긴장된 결. 5분 내내 들어야 하므로 자극적이지 않게.
const BASS = [55, 55, 65.41, 49] // A1 A1 C2 G1
const ARP = [220, 261.63, 329.63, 261.63, 220, 329.63, 392, 329.63]
const LEAD = [440, 523.25, 392, 349.23]
