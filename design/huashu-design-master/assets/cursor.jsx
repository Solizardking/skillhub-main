/**
 * Cursor — Product UI demo cursor component kit
 *
 * Works with browser_window.jsx / macos_window.jsx. Recipes and parameters
 * from references/ui-demo-animation.md section ④ (trajectory algorithm:
 * animation-best-practices §3.5; ripple params: shotcraft·type-and-filter +
 * decoupled recipes; seek safety rules: gsap-recipes §6).
 *
 * Frame determinism: Math.random / Date.now are forbidden in this file.
 * Randomness is always derived from a mulberry32 seeded PRNG.
 * The same frame looks identical no matter how many times you seek.
 *
 * ── Usage A · Stage clock (animations.jsx) ─────────────────────────
 *
 *   const { Stage, Sprite } = window.Animations;
 *   const { CursorSprite, ClickRipple, HoverHighlight } = window;
 *
 *   <Stage duration={8}>
 *     <Sprite start={1} end={2.2}>   {/* Cursor arcs to the button, convergence damping at the end *\/}
 *       <CursorSprite points={[[220, 480], [860, 300]]} seed={7} clickAt={0.96} />
 *     </Sprite>
 *     <Sprite start={2.1} end={3.0}> {/* Click ripple: two-ring decoupled *\/}
 *       <ClickRipple x={860} y={300} color="#9945FF" duration={0.9} />
 *     </Sprite>
 *   </Stage>
 *
 *   Hover-linked highlight (time-driven hit test, not event-driven):
 *     const sampler = window.CursorKit.buildCursorSampler(points, { seed: 7 });
 *     const hovered = window.CursorKit.hoverIndexAt(sampler, easedU, [
 *       { id: 'save', rect: { x: 820, y: 270, w: 96, h: 44 } },
 *     ]);
 *     <HoverHighlight rect={{...}} intensity={hovered === 'save' ? 1 : 0} />
 *
 *   Drag: pass dragRange={[0.2, 0.8]} to the cursor (switches to grab hand
 *   + micro-scale within the range). Drive the dragged element with the same
 *   sampler minus the grab-point offset — cursor and element stay in sync.
 *
 * ── Usage B · GSAP timeline (HyperFrames render) ────────────────────
 *
 *   const K = window.CursorKit;
 *   const sampler = K.buildCursorSampler([[220, 480], [860, 300]], { seed: 7 });
 *   K.attachCursorTween(tl, '#cursor', sampler, { duration: 1.1, position: 's1+=0.5' });
 *   K.attachClickTween(tl, '#cursor', { position: '>' });
 *   K.attachRippleTween(tl, '#rip1', '#rip2', { position: '<' });
 *   // Don't forget the gsap-recipes §6.3 first-frame insurance: after
 *   // registering the timeline, manually add one initial set.
 *
 * Cursor shapes: arrow (macOS arrow, default) / hand (clickable) / grab (dragging) / text (I-beam)
 *
 * Solana theme: ripples/highlights default to Solana purple #9945FF.
 */

/* ══════════════ Utility layer (pure functions, shared by both drivers) ══════════════ */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CursorEasing = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inQuad: (t) => t * t,
};

// Catmull-Rom single segment interpolation (p1→p2, p0/p3 are the neighboring control points)
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

/**
 * buildCursorSampler(points, opts) → sample(u) → {x, y}
 *
 * - With only 2 points, automatically inserts one control point offset from
 *   the midpoint to create an arc (real mice don't move in straight lines,
 *   best-practices §3.5). Offset direction is decided by the seed.
 * - With ≥3 points, uses Catmull-Rom smoothing (same interpolation as huarec).
 * - Hand wobble: two sine waves with incommensurable frequencies summed,
 *   amplitude ±wobble px, converging to 0 as u→1 (hands steady up near target).
 */
function buildCursorSampler(points, opts) {
  const o = Object.assign({ seed: 7, wobble: 2, arc: 0.18 }, opts);
  const rand = mulberry32(o.seed);
  const ph1 = rand() * 6.283, ph2 = rand() * 6.283;
  const side = rand() < 0.5 ? -1 : 1;

  let pts = points.map((p) => [p[0], p[1]]);
  if (pts.length === 2) {
    const [a, b] = pts;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const mid = [a[0] + dx * 0.5 - dy * o.arc * side, a[1] + dy * 0.5 + dx * o.arc * side];
    pts = [a, mid, b];
  }
  // Pad the ends with virtual points so Catmull-Rom covers the whole path
  const ext = [pts[0], ...pts, pts[pts.length - 1]];
  const segs = pts.length - 1;

  return function sample(u) {
    const uu = Math.max(0, Math.min(1, u));
    const f = uu * segs;
    const i = Math.min(segs - 1, Math.floor(f));
    const lt = f - i;
    const [x0, y0] = catmullRom(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], lt);
    const damp = o.wobble * (1 - uu);            // converge near target
    return {
      x: x0 + Math.sin(uu * 47.13 + ph1) * damp, // 47.13 / 33.7 incommensurable
      y: y0 + Math.sin(uu * 33.7 + ph2) * damp,
    };
  };
}

// Hover hit: time-driven deterministic hit test (not event listening)
function hoverIndexAt(sampler, u, targets, pad) {
  const p = sampler(u);
  const m = pad || 0;
  for (const t of targets) {
    const r = t.rect;
    if (p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m) return t.id;
  }
  return null;
}

/**
 * rippleRingState(tSec, opts) → { scale, opacity }
 * Single-ring state for a two-ring ripple. Expansion and fade are decoupled
 * (shotcraft-tested recipe): out-cubic EXPAND frames (punch), linear FADE
 * frames (uniform), FADE > EXPAND.
 * Default 22f/26f@30fps; compact scenes (type-and-filter) can compress to 10f each.
 */
function rippleRingState(tSec, opts) {
  const o = Object.assign({ delayF: 0, expandF: 22, fadeF: 26, r0: 14, r1: 54, fps: 30 }, opts);
  const t = tSec - o.delayF / o.fps;
  if (t < 0) return { scale: o.r0 / o.r1, opacity: 0 };
  const pe = Math.min(1, t / (o.expandF / o.fps));
  const pf = Math.min(1, t / (o.fadeF / o.fps));
  return {
    scale: (o.r0 + (o.r1 - o.r0) * CursorEasing.outCubic(pe)) / o.r1,
    opacity: 1 - pf,
  };
}

/* ══════════════ Cursor shapes (SVG, black fill white stroke, paintOrder keeps accurate contour) ══════════════ */

const CURSOR_PATHS = {
  // macOS arrow: vertical left edge, hypotenuse to the right wing, with click tail. Hotspot at (0,0)
  arrow: {
    viewBox: '0 0 17 22',
    d: 'M1.5 1.5 L1.5 18.6 L6.4 13.9 L9.1 20.3 L11.9 19.1 L9.2 12.8 L14.5 12.8 Z',
    hotspot: [1.5, 1.5],
  },
  // Clickable hand (simplified index finger). Hotspot at fingertip
  hand: {
    viewBox: '0 0 22 24',
    d: 'M9.2 1.9 c1 0 1.5 .7 1.5 1.6 v6.1 l1 .1 v-4.4 c0-1.9 2.8-1.9 2.8 0 v4.7 l.9 .1 v-3.2 c0-1.8 2.6-1.8 2.6 0 v3.6 l.9 .2 v-1.6 c0-1.6 2.3-1.6 2.3 0 v5.6 c0 4.3-2.9 7.3-7.3 7.3 h-2.1 c-2.9 0-4.5-1.3-5.9-3.7 L3.1 13.4 c-.7-1.2 .8-2.4 1.9-1.5 l2.7 2.3 V3.5 c0-.9 .6-1.6 1.5-1.6 Z',
    hotspot: [9.9, 1.9],
  },
  // Dragging (fist): hand variant with fingers curled
  grab: {
    viewBox: '0 0 22 22',
    d: 'M5.4 7.2 c0-1.7 2.5-1.7 2.5 0 v2.1 l.9 0 v-3.3 c0-1.8 2.7-1.8 2.7 0 v3.3 l.9 0 v-2.9 c0-1.8 2.6-1.8 2.6 0 v3 l.9 .1 v-1.7 c0-1.6 2.3-1.6 2.3 0 v5.1 c0 4.2-2.8 7-7.1 7 h-1.9 c-2.8 0-4.4-1.2-5.7-3.6 L2.5 13.1 c-.6-1.2 .8-2.3 1.8-1.4 l1.1 .9 Z',
    hotspot: [10, 8],
  },
  // Text I-beam. Hotspot at center
  text: {
    viewBox: '0 0 10 22',
    d: 'M1 1.5 h3 v0 c.4 0 .7 .2 1 .5 c.3-.3 .6-.5 1-.5 h3 v2 h-2.6 c-.2 0-.4 .2-.4 .4 v14.2 c0 .2 .2 .4 .4 .4 H9 v2 H6 c-.4 0-.7-.2-1-.5 c-.3 .3-.6 .5-1 .5 H1 v-2 h2.6 c.2 0 .4-.2 .4-.4 V3.9 c0-.2-.2-.4-.4-.4 H1 Z',
    hotspot: [5, 11],
  },
};

function CursorIcon({ variant = 'arrow', size = 22 }) {
  const s = CURSOR_PATHS[variant] || CURSOR_PATHS.arrow;
  return (
    <svg width={size} height={size * 1.25} viewBox={s.viewBox}
      style={{ display: 'block', overflow: 'visible' }}>
      <path d={s.d} fill="#111" stroke="#fff" strokeWidth="1.4"
        strokeLinejoin="round" style={{ paintOrder: 'stroke' }} />
    </svg>
  );
}

/* ══════════════ Stage clock components (works with animations.jsx) ══════════════ */

/**
 * CursorSprite — place inside <Sprite>, cursor that moves along a path
 *
 * props:
 *   points     [[x,y],...] path points (stage coordinates). 2 points auto-arc
 *   seed       random seed (change seed = new arc + wobble variant)
 *   wobble     wobble amplitude px (default 2, best-practices §3.5 ±2px)
 *   ease       progress easing, default inOutQuad (symmetric human feel)
 *   clickAt    0-1, cursor presses down at this progress (scale 0.85 dip + rebound)
 *   dragRange  [u0,u1], switches to grab hand + scale 0.94 within the range
 *   variant    base shape, default 'arrow'
 *   size       cursor width px, default 22
 */
function CursorSprite({
  points, seed = 7, wobble = 2, ease = CursorEasing.inOutQuad,
  clickAt = null, dragRange = null, variant = 'arrow', size = 22, style,
}) {
  const { useSprite } = window.Animations;
  const { t } = useSprite();
  const sampler = React.useMemo(
    () => buildCursorSampler(points, { seed, wobble }),
    [JSON.stringify(points), seed, wobble]
  );
  const u = ease(t);
  const p = sampler(u);

  let scale = 1;
  let shape = variant;
  if (dragRange && u >= dragRange[0] && u <= dragRange[1]) {
    shape = 'grab';
    scale = 0.94;
  }
  if (clickAt !== null) {
    const d = (u - clickAt) / 0.05;              // click window ±5% progress
    if (d >= 0 && d < 1) scale *= 0.85 + 0.15 * CursorEasing.outCubic(d);      // rebound
    else if (d >= -0.6 && d < 0) scale *= 1 - 0.15 * CursorEasing.inQuad(1 + d / 0.6); // press down
  }

  const hs = (CURSOR_PATHS[shape] || CURSOR_PATHS.arrow).hotspot;
  const k = size / 17;                            // visual size normalization
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, zIndex: 999, pointerEvents: 'none',
      transform: `translate(${p.x - hs[0] * k}px, ${p.y - hs[1] * k}px) scale(${scale})`,
      transformOrigin: `${hs[0] * k}px ${hs[1] * k}px`,
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
      ...style,
    }}>
      <CursorIcon variant={shape} size={size} />
    </div>
  );
}

/**
 * ClickRipple — two-ring concentric ripple (place in its own <Sprite>, starting at the click frame)
 * Rings start 3f apart; radius 14→54 / 14→78; expansion out-cubic 22f, fade linear 26f decoupled.
 * duration = the containing Sprite's length (seconds), used to convert local progress back to seconds.
 */
function ClickRipple({ x, y, color = '#9945FF', r1 = 54, r2 = 78, duration = 0.9, fps = 30 }) {
  const { useSprite } = window.Animations;
  const { t } = useSprite();
  const tSec = t * duration;
  const rings = [
    { rMax: r1, st: rippleRingState(tSec, { delayF: 0, r1, fps }) },
    { rMax: r2, st: rippleRingState(tSec, { delayF: 3, r1: r2, fps }) },
  ];
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: 998, pointerEvents: 'none' }}>
      {rings.map((r, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: -r.rMax, top: -r.rMax, width: r.rMax * 2, height: r.rMax * 2,
          borderRadius: '50%',
          border: `3px solid ${color}`,
          boxShadow: `0 0 40px ${color}55`,
          transform: `scale(${r.st.scale})`,      // fixed size + scale, no width/height tween
          opacity: r.st.opacity,
        }} />
      ))}
    </div>
  );
}

/**
 * HoverHighlight — linked highlight of the cursor's hover target
 * intensity 0→1 derived by the caller from time (paired with hoverIndexAt).
 * This component only renders: hairline outline fade-in + slight brightening,
 * withdrawn when cursor leaves.
 */
function HoverHighlight({ rect, intensity = 0, color = '#9945FF', radius = 8 }) {
  if (intensity <= 0) return null;
  return (
    <div style={{
      position: 'absolute', left: rect.x - 3, top: rect.y - 3,
      width: rect.w + 6, height: rect.h + 6,
      borderRadius: radius, pointerEvents: 'none',
      border: `1.5px solid ${color}`,
      boxShadow: `0 0 0 3px ${color}22`,
      opacity: intensity,
      backdropFilter: `brightness(${1 + 0.06 * intensity})`,
    }} />
  );
}

/* ══════════════ GSAP driver layer (HyperFrames render pipeline) ══════════════ */

/**
 * attachCursorTween — proxy tween drives the cursor DOM element along the sampler path
 * (componentized wrapper of gsap-recipes §3.5; everything derived from proxy.u, seek-safe)
 */
function attachCursorTween(tl, target, sampler, opts) {
  const o = Object.assign({ duration: 1.1, ease: 'power1.inOut', position: '>' }, opts);
  const proxy = { u: 0 };
  tl.to(proxy, {
    u: 1, duration: o.duration, ease: o.ease,
    onUpdate: () => {
      const p = sampler(proxy.u);
      gsap.set(target, { x: p.x, y: p.y });
    },
  }, o.position);
  return proxy;
}

/** attachClickTween — click Anticipation: press down 0.85 then back.out rebound */
function attachClickTween(tl, target, opts) {
  const o = Object.assign({ position: '>' }, opts);
  tl.to(target, { scale: 0.85, duration: 0.08, ease: 'power1.in' }, o.position);
  tl.to(target, { scale: 1, duration: 0.25, ease: 'back.out' }, '>');
}

/**
 * attachRippleTween — two-ring ripple. ring1/ring2 are fixed-size ring elements
 * (diameter = 2× final radius, initial scale = r0/r1); only tween scale and opacity.
 */
function attachRippleTween(tl, ring1, ring2, opts) {
  const o = Object.assign({ r0: 14, r1: 54, r2: 78, fps: 30, position: '>' }, opts);
  const F = (n) => n / o.fps;
  [[ring1, o.r1, 0], [ring2, o.r2, 3]].forEach(([el, rMax, delayF]) => {
    const at = delayF === 0 ? o.position : '<+=' + F(delayF);
    tl.fromTo(el, { scale: o.r0 / rMax, autoAlpha: 1 },
      { scale: 1, duration: F(22), ease: 'power3.out' }, at);          // expansion: punch
    tl.to(el, { autoAlpha: 0, duration: F(26), ease: 'none' }, '<');   // fade: uniform, decoupled
  });
}

/* ══════════════ Exports ══════════════ */

if (typeof window !== 'undefined') {
  window.CursorIcon = CursorIcon;
  window.CursorSprite = CursorSprite;
  window.ClickRipple = ClickRipple;
  window.HoverHighlight = HoverHighlight;
  window.CursorKit = {
    mulberry32,
    CursorEasing,
    buildCursorSampler,
    hoverIndexAt,
    rippleRingState,
    attachCursorTween,
    attachClickTween,
    attachRippleTween,
    CURSOR_PATHS,
  };
}