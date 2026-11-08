// Bottom sheet for phones: three snap points (peek / half / full), dragged by
// the grip or the list heading. On wide screens the panel is a fixed sidebar.

const WIDE = matchMedia('(min-width: 900px)');

export class Sheet {
  constructor(panel, { app, grip, dragAreas = [], onChange }) {
    this.panel = panel;
    this.app = app;
    this.grip = grip;
    this.onChange = onChange;
    this.state = 'half';
    this.offset = 0;
    this.measure();
    for (const el of [grip, ...dragAreas]) this.bindDrag(el);
    grip.addEventListener('click', () => {
      if (this.justDragged) return;
      this.snap(this.state === 'full' ? 'half' : this.state === 'half' ? 'full' : 'half');
    });
    grip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        grip.click();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.snap(this.state === 'peek' ? 'half' : 'full');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.snap(this.state === 'full' ? 'half' : 'peek');
      }
    });
    addEventListener('resize', () => {
      this.measure();
      this.apply(false);
    });
    WIDE.addEventListener?.('change', () => {
      this.measure();
      this.apply(false);
    });
  }

  get wide() {
    return WIDE.matches;
  }

  measure() {
    this.panelH = this.panel.getBoundingClientRect().height || innerHeight * 0.85;
    const h = innerHeight;
    this.heights = {
      peek: Math.min(168, this.panelH),
      half: Math.round(Math.min(this.panelH, Math.max(260, h * 0.46))),
      full: this.panelH,
    };
  }

  visible() {
    return this.wide ? 0 : this.panelH - this.offset;
  }

  apply(animate = true) {
    if (this.wide) {
      this.offset = 0;
      this.app.style.setProperty('--panel-offset', '0px');
      this.app.style.setProperty('--sheet-visible', '0px');
      this.onChange?.({ visible: 0, wide: true, state: 'wide' });
      return;
    }
    this.offset = Math.max(0, this.panelH - this.heights[this.state]);
    this.panel.classList.toggle('dragging', !animate);
    this.app.style.setProperty('--panel-offset', `${this.offset}px`);
    this.app.style.setProperty('--sheet-visible', `${this.heights[this.state]}px`);
    this.panel.dataset.state = this.state;
    this.grip.setAttribute('aria-expanded', String(this.state === 'full'));
    this.onChange?.({ visible: this.heights[this.state], wide: false, state: this.state });
  }

  snap(state, animate = true) {
    if (!this.heights[state]) return;
    this.state = state;
    this.apply(animate);
  }

  /** Make sure the sheet is at least at `state` (does not shrink it). */
  ensure(state) {
    const order = ['peek', 'half', 'full'];
    if (order.indexOf(this.state) < order.indexOf(state)) this.snap(state);
  }

  bindDrag(el) {
    let startY = 0;
    let startOffset = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let active = false;
    let moved = false;
    el.addEventListener('pointerdown', (e) => {
      if (this.wide || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target.closest('button:not(.panel-grip), a, select, input')) return;
      active = true;
      moved = false;
      startY = lastY = e.clientY;
      lastT = performance.now();
      startOffset = this.offset;
      velocity = 0;
      // Keep receiving moves after the pointer leaves the thin grip (mouse/pen
      // have no implicit capture, touch does).
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) < 6) return;
      if (!moved) {
        moved = true;
        this.panel.classList.add('dragging');
      }
      const now = performance.now();
      velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
      lastY = e.clientY;
      lastT = now;
      const max = this.panelH - this.heights.peek;
      this.offset = Math.min(max, Math.max(0, startOffset + dy));
      this.panel.style.transform = `translateY(${this.offset}px)`;
    });
    const end = () => {
      if (!active) return;
      active = false;
      if (!moved) return;
      // Hand the dragged position to the CSS variable first so the snap
      // animation starts from where the finger left the sheet.
      this.app.style.setProperty('--panel-offset', `${this.offset}px`);
      this.panel.style.transform = '';
      this.justDragged = true;
      setTimeout(() => (this.justDragged = false), 50);
      const visible = this.panelH - this.offset;
      // Fling with velocity, otherwise snap to the nearest point.
      let target;
      if (velocity > 0.6) target = visible > this.heights.half + 40 ? 'half' : 'peek';
      else if (velocity < -0.6) target = visible < this.heights.half - 40 ? 'half' : 'full';
      else {
        target = Object.entries(this.heights).reduce((best, [k, h]) =>
          Math.abs(h - visible) < Math.abs(this.heights[best] - visible) ? k : best, 'half');
      }
      requestAnimationFrame(() => this.snap(target));
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
