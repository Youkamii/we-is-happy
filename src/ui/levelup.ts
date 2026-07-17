/**
 * 레벨업 3택.
 *
 * 게임이 멈추고, 고르고, 즉시 체감된다. 이 창이 뜨는 순간이 도파민의 정점이라
 * 여기서 뜸을 들이면 안 된다 — 숫자 1/2/3 으로 즉시 고를 수 있어야 한다.
 */
import type { Choice } from '../game/loadout'
import { levelGainOf } from '../game/player'

/** HDR 색(1 초과)을 CSS 로 눌러 담는다. */
function css(r: number, g: number, b: number, scale = 1): string {
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, v * scale * 96)))
  return `rgb(${f(r)},${f(g)},${f(b)})`
}

export class LevelUpUI {
  private readonly root: HTMLDivElement
  private onPick: ((c: Choice) => void) | null = null
  private onReroll: (() => void) | null = null
  private choices: Choice[] = []
  private visible = false

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.style.cssText =
      'position:absolute;inset:0;display:none;place-content:center;pointer-events:none;' +
      'background:radial-gradient(ellipse at center,rgba(4,6,12,.55),rgba(3,4,9,.9));' +
      'backdrop-filter:blur(2px);'
    parent.appendChild(this.root)

    window.addEventListener('keydown', this.onKey)
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.visible) return
    const n = parseInt(e.key, 10)
    if (n >= 1 && n <= this.choices.length) {
      e.preventDefault()
      this.pick(this.choices[n - 1]!)
      return
    }
    if ((e.key === 'r' || e.key === 'R') && this.onReroll) {
      e.preventDefault()
      const cb = this.onReroll
      this.hide()
      cb()
    }
  }

  private pick(c: Choice): void {
    const cb = this.onPick
    this.hide()
    cb?.(c)
  }

  show(
    choices: Choice[], level: number, onPick: (c: Choice) => void,
    opts?: { header?: string; onReroll?: (() => void) | null },
  ): void {
    this.choices = choices
    this.onPick = onPick
    this.onReroll = opts?.onReroll ?? null
    this.visible = true
    this.root.style.display = 'grid'
    this.root.style.pointerEvents = 'auto'
    this.root.replaceChildren()

    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:grid;gap:22px;justify-items:center;'

    const isPact = opts?.header !== undefined
    const title = document.createElement('div')
    title.textContent = opts?.header ?? `LEVEL ${level}`
    title.style.cssText =
      'font:800 34px/1 ui-monospace,monospace;letter-spacing:.22em;' +
      (isPact
        ? 'color:#ff9d8a;text-shadow:0 0 30px rgba(255,90,70,.8);'
        : 'color:#ffe3a8;text-shadow:0 0 28px rgba(255,170,60,.85);')
    wrap.appendChild(title)

    // 레벨 자체가 준 성장. 3택은 안 고른 2개가 손실감이라, 선택과 무관하게
    // 강해졌다는 걸 보여줘야 레벨업이 온전한 보상이 된다. (계약 화면엔 무의미)
    if (!isPact) {
      const g = levelGainOf(level)
      const growth = document.createElement('div')
      const parts = [`체력 +${g.maxHp}`, `피해 +${g.damage}%`]
      if (g.milestone) parts.push(g.milestone)
      growth.textContent = parts.join('   ')
      growth.style.cssText =
        `font:600 12px/1 ui-monospace,monospace;letter-spacing:.08em;margin-top:-8px;` +
        `color:${g.milestone ? '#ffd166' : '#7fe3b8'};`
      wrap.appendChild(growth)
    }

    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;justify-content:center;'

    choices.forEach((c, i) => {
      const card = document.createElement('button')
      const accent = css(c.r, c.g, c.b)
      const glow = css(c.r, c.g, c.b, 0.55)
      card.style.cssText =
        `width:240px;min-height:170px;padding:18px 16px;cursor:pointer;text-align:left;` +
        `background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.015));` +
        `border:1px solid ${glow};border-radius:14px;color:#e9eef7;` +
        `font:400 13px/1.6 ui-monospace,monospace;` +
        `box-shadow:0 0 0 rgba(0,0,0,0);transition:transform .12s ease,box-shadow .12s ease,border-color .12s;` +
        `display:flex;flex-direction:column;gap:8px;`
      card.onmouseenter = () => {
        card.style.transform = 'translateY(-4px)'
        card.style.boxShadow = `0 10px 34px ${glow}`
        card.style.borderColor = accent
      }
      card.onmouseleave = () => {
        card.style.transform = 'none'
        card.style.boxShadow = '0 0 0 rgba(0,0,0,0)'
        card.style.borderColor = glow
      }
      card.onclick = () => this.pick(c)

      const key = document.createElement('div')
      key.textContent = String(i + 1)
      key.style.cssText =
        `font:700 11px/1 ui-monospace,monospace;color:${accent};opacity:.75;letter-spacing:.2em;`
      card.appendChild(key)

      // innerHTML 을 쓰지 않는다. 지금은 c.title 이 정적 테이블에서만 오지만,
      // 협동이 붙으면 상대 피어의 로드아웃 이름이 여기로 들어올 수 있다.
      const name = document.createElement('div')
      const titleEl = document.createElement('span')
      titleEl.textContent = c.title
      titleEl.style.cssText = `font:700 19px/1.3 ui-monospace,monospace;color:${accent}`
      name.appendChild(titleEl)
      const lvTag =
        c.kind === 'evolve' ? '진화'
        : c.kind === 'pact' ? '계약'
        : c.level > 1 ? `Lv ${c.level}`
        : c.kind === 'heal' ? '' : 'NEW'
      if (lvTag) {
        const tagEl = document.createElement('span')
        tagEl.textContent = ` ${lvTag}`
        tagEl.style.cssText = 'font-size:11px;opacity:.6'
        name.appendChild(tagEl)
      }
      card.appendChild(name)

      const desc = document.createElement('div')
      desc.textContent = c.desc
      desc.style.cssText = 'opacity:.82;flex:1;'
      card.appendChild(desc)

      if (c.hint) {
        const hint = document.createElement('div')
        hint.textContent = c.hint
        const isReady = c.kind === 'evolve' || c.hint.includes('완료') || c.hint.includes('진화한다')
        hint.style.cssText =
          `font-size:11px;padding:5px 8px;border-radius:6px;` +
          (isReady
            ? 'background:rgba(255,190,70,.18);color:#ffd88a;border:1px solid rgba(255,190,70,.4);'
            : 'background:rgba(255,255,255,.05);color:#9fb4cc;')
        card.appendChild(hint)
      }

      row.appendChild(card)
    })

    wrap.appendChild(row)

    if (this.onReroll) {
      const rr = document.createElement('button')
      rr.textContent = '다시 뽑기 — 막마다 1회 (R)'
      rr.style.cssText =
        'padding:9px 20px;cursor:pointer;pointer-events:auto;' +
        'background:rgba(120,160,220,.08);border:1px solid rgba(120,160,220,.35);' +
        'border-radius:8px;color:#9fb6d4;font:600 12px ui-monospace,monospace;letter-spacing:.08em;'
      rr.onclick = () => {
        const cb = this.onReroll!
        this.hide()
        cb()
      }
      wrap.appendChild(rr)
    }

    const help = document.createElement('div')
    help.textContent = '숫자키 또는 클릭'
    help.style.cssText = 'font:400 11px/1 ui-monospace,monospace;color:#5f7893;letter-spacing:.1em;'
    wrap.appendChild(help)

    this.root.appendChild(wrap)
  }

  hide(): void {
    this.visible = false
    this.root.style.display = 'none'
    this.root.style.pointerEvents = 'none'
    this.onPick = null
    this.onReroll = null
  }

  get isVisible(): boolean {
    return this.visible
  }
}
