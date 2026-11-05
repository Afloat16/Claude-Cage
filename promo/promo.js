/* Claude Cage promo · every frame is a pure function of time.
 * render(t) sets all styles from t, so preview playback, scrubbing and the
 * frame-by-frame export in render.mjs all show exactly the same picture. */
(() => {
  'use strict';
  const T = window.TL;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------- math ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const p = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    out: x => 1 - Math.pow(1 - x, 3),
    out5: x => 1 - Math.pow(1 - x, 5),
    in: x => x * x * x,
    io: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    sine: x => -(Math.cos(Math.PI * x) - 1) / 2,
    back: (x, s = 1.6) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  };
  // Fade in over [a, a+fi], fade out over [b-fo, b].
  const win = (t, a, b, fi = 0.5, fo = 0.5) => Math.min(E.out(p(t, a, a + fi)), 1 - E.io(p(t, b - fo, b)));
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  const css = (el, o) => {
    if (!el) return;
    const s = el.style;
    if (o.o !== undefined) { s.opacity = o.o.toFixed(4); s.visibility = o.o <= 0.001 ? 'hidden' : 'visible'; }
    if (o.tf !== undefined) s.transform = o.tf;
    if (o.f !== undefined) s.filter = o.f;
  };
  const blur = v => (v > 0.05 ? `blur(${v.toFixed(2)}px)` : 'none');

  // ---------- text ----------
  function split(el) {
    const text = el.textContent;
    el.textContent = '';
    el._chars = [...text].map(ch => {
      const s = document.createElement('span');
      s.className = 'c';
      s.textContent = ch;
      el.appendChild(s);
      return s;
    });
  }
  function reveal(el, t, start, { stagger = 0.045, dur = 0.7, y = 18, b = 10 } = {}) {
    el._chars.forEach((c, i) => {
      const k = E.out(p(t, start + i * stagger, start + i * stagger + dur));
      css(c, { o: k, tf: `translateY(${((1 - k) * y).toFixed(2)}px)`, f: blur((1 - k) * b) });
    });
  }
  const revealEnd = (el, start, { stagger = 0.045, dur = 0.7 } = {}) => start + (el._chars.length - 1) * stagger + dur;

  // A stack of labels that roll vertically at the given switch times.
  function flip(el, t, times, h = 18) {
    const spans = el._spans || (el._spans = [...el.children]);
    let v = 0;
    times.forEach(at => { v += E.io(p(t, at, at + 0.42)); });
    spans.forEach((s, i) => {
      const d = i - v;
      s.style.position = 'absolute';
      css(s, { o: clamp(1 - Math.abs(d) * 1.4), tf: `translateY(${(d * h).toFixed(2)}px)` });
    });
  }

  // ---------- pixel logo ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ORANGE = '#ef6f45', DARK = '#252321';
  function rect(svg, x, y, w, h, fill) {
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill);
    svg.appendChild(r);
    return r;
  }
  function buildLogo(svg) {
    svg.setAttribute('viewBox', '0 0 926 926');
    const cells = [];
    const u = 46, bx = 187, by = 280;
    const add = (x, y, w, h) => cells.push({ el: rect(svg, x, y, w + 0.8, h + 0.8, ORANGE), cx: x + w / 2, cy: y + h / 2 });
    for (let r = 0; r < 7; r++) for (let c = 0; c < 12; c++) add(bx + c * u, by + r * u, u, u);
    for (const r of [3, 4]) { add(bx - 69, by + r * u, 69, u); add(bx + 12 * u, by + r * u, 69, u); }
    for (const x of [230, 338, 535, 642]) { add(x, 602, 55, 40); add(x, 642, 55, 40); }
    cells.forEach((c, i) => {
      const d = Math.hypot(c.cx - 463, c.cy - 450) / 420;
      c.delay = d * 0.75 + hash(i) * 0.22;
    });
    // Seamless body drawn once every pixel has landed.
    const solid = [
      rect(svg, bx, by, 12 * u, 7 * u, ORANGE), rect(svg, bx - 69, by + 3 * u, 12 * u + 138, 2 * u, ORANGE),
      ...[230, 338, 535, 642].map(x => rect(svg, x, 600, 55, 82, ORANGE)),
    ];
    const settle = Math.max(...cells.map(c => c.delay)) + 0.42;
    const eyes = [rect(svg, 338, 345, 51, 95, DARK), rect(svg, 537, 345, 51, 95, DARK)];
    const frame = [
      rect(svg, 35, 80, 855, 67, DARK), rect(svg, 35, 761, 855, 67, DARK),
      rect(svg, 35, 80, 65, 748, DARK), rect(svg, 825, 80, 65, 748, DARK),
    ];
    const bars = [rect(svg, 268, 80, 54, 748, DARK), rect(svg, 604, 80, 54, 748, DARK)];
    return { svg, cells, solid, settle, eyes, frame, bars };
  }
  // Assemble the logo: pixels pop from the centre, the frame draws, two bars drop.
  function logoAt(L, t, { pixels, frame, bars, blink, speed = 1 }) {
    const whole = t >= pixels + L.settle * speed;
    L.solid.forEach(r => css(r, { o: whole ? 1 : 0 }));
    L.cells.forEach(c => {
      if (whole) { css(c.el, { o: 0 }); return; }
      const k = p(t, pixels + c.delay * speed, pixels + c.delay * speed + 0.42 * speed);
      const e = k >= 1 ? 1 : Math.max(0, E.back(k, 2.2));
      css(c.el, { o: k > 0 ? 1 : 0, tf: `scale(${e.toFixed(4)})` });
    });
    const eye = E.back(p(t, pixels + 0.95 * speed, pixels + 1.3 * speed), 1.8);
    const bl = blink.reduce((m, b) => Math.min(m, 1 - Math.sin(Math.PI * p(t, b, b + 0.2)) * 0.92), 1);
    L.eyes.forEach(e => css(e, { o: eye > 0 ? 1 : 0, tf: `scaleY(${(Math.max(0, eye) * bl).toFixed(4)})` }));
    L.frame.forEach((r, i) => {
      const k = E.io(p(t, frame + (i >> 1) * 0.12, frame + (i >> 1) * 0.12 + 0.5 * speed));
      css(r, { o: k > 0 ? 1 : 0, tf: i < 2 ? `scaleX(${k.toFixed(4)})` : `scaleY(${k.toFixed(4)})` });
    });
    L.bars.forEach((r, i) => {
      const k = p(t, bars[i], bars[i] + 0.34 * speed);
      const e = E.back(k, 1.1);
      css(r, { o: clamp(k * 10), tf: `translateY(${((1 - e) * -760).toFixed(2)}px)` });
    });
  }
  // Tiny landing bump for each bar.
  const barImpact = (t, bars) => bars.reduce((s, b) => s + Math.sin(Math.PI * p(t, b + 0.3, b + 0.5)) * 1, 0);

  // ---------- icons ----------
  const ico = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const WARN = '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8v.2"/>';
  const APPS = [
    { n: '微信', c: '#3fb950', w: '异地登录提醒' },
    { n: '网上银行', c: '#d7a03b', w: '安全验证失败' },
    { n: '公司 VPN', c: '#5a8de0', w: '内网连不上' },
    { n: '国内网站', c: '#9b7fe0', w: '打开变慢' },
    { n: 'Claude', c: '#d97757', w: '时区与 IP 对不上' },
  ];

  const CHECKS = ['VM 外出站约束', '终端检测通道', 'DNS 与解析约束', '系统时区与语言', '浏览器时区与语言', '共享文件与宿主私有目录',
    '宿主管理接口', '代理故障关闭', 'UDP 出站约束', 'IPv6 出站约束', '出口符合已保存规则'];

  // ---------- build ----------
  const els = {};
  function build() {
    $$('[data-split]').forEach(split);

    const chips = $('#appChips'), wires = $('#wires');
    els.apps = APPS.map((a, i) => {
      const y = 360 + i * 98;
      const chip = document.createElement('div');
      chip.className = 'app-chip dark-card';
      chip.style.top = y + 'px';
      chip.innerHTML = `<i style="background:${a.c}"></i>${a.n}`;
      const warn = document.createElement('div');
      warn.className = 'warn';
      warn.style.top = (y + 14) + 'px';
      warn.innerHTML = `${ico(WARN)}${a.w}`;
      chips.append(chip, warn);
      const y0 = y + 39;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', `M972 ${y0} C 1150 ${y0}, 1170 590, 1330 590`);
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('r', 6);
      dot.setAttribute('fill', '#ffb08f');
      wires.append(path, dot);
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      return { chip, warn, path, dot, len };
    });

    const svgLogo = document.createElementNS(SVGNS, 'svg');
    svgLogo.classList.add('logo-svg');
    $('#logoWrap').appendChild(svgLogo);
    els.logo = buildLogo(svgLogo);
    const svgEnd = document.createElementNS(SVGNS, 'svg');
    svgEnd.classList.add('logo-svg');
    $('#endLogo').appendChild(svgEnd);
    els.endLogo = buildLogo(svgEnd);
    els.mini = buildLogo($('#miniLogo'));

    const box = $('#checks');
    box.style.gridTemplateRows = 'repeat(6, 38px)';
    box.style.gridAutoFlow = 'column';
    els.checks = CHECKS.map(name => {
      const d = document.createElement('div');
      d.className = 'ck';
      d.innerHTML = `<div class="flash"></div><div class="st"><div class="wait"></div><div class="spin"></div><div class="ok"><svg class="i" viewBox="0 0 24 24"><path d="M5.5 12.5l4 4 9-9"/></svg></div></div><span>${name}</span><span class="res"><span class="n">检查中…</span><span class="y">通过</span></span>`;
      box.appendChild(d);
      return d;
    });

    els.caps = $$('#caption .cap');
    els.dots = $$('#progressDots b');
    els.prog = $$('.prog .p');
    els.replies = $$('#reply [data-r]');
    els.termLines = $$('#term > .ln');
    els.navEnable = $$('[data-enable]');
    els.nodes = $$('#modal .node');
    const last = els.replies[3];
    last.lastChild.textContent = '';
    els.lastReply = last.lastChild;
  }

  // Window-local position of an element's centre (offsets ignore transforms).
  const win0 = () => $('#win');
  function center(el, dx = 0, dy = 0) {
    let x = 0, y = 0, n = el;
    const root = win0();
    while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return [x + el.offsetWidth / 2 + dx, y + el.offsetHeight / 2 + dy];
  }

  let cursorKeys, clicks;
  function measure() {
    const A = T.app;
    const proxy = center($('#btnProxy'), 10, 4);
    const launch = center($('#btnLaunch'), 6, 4);
    const node = center($('#nodeLA'), -120, 3);
    const use = center($('#btnUse'), 8, 4);
    const plus = center($('#projPlus'), 2, 3);
    // [time, x, y, opacity]
    cursorKeys = [
      [20.6, 1120, 690, 0], [21.0, 1060, 620, 1], [21.55, ...proxy, 1], [21.9, ...proxy, 1],
      [23.25, ...node, 1], [23.6, ...node, 1], [24.15, ...use, 1], [24.5, use[0] + 20, use[1] + 30, 1], [24.8, use[0] + 60, use[1] + 90, 0],
      [27.3, 1060, 640, 0], [27.55, 1010, 600, 1], [27.98, ...launch, 1], [28.3, ...launch, 1], [28.7, launch[0] + 70, launch[1] + 80, 0],
      [34.4, 520, 520, 0], [34.6, 420, 420, 1], [34.82, ...plus, 1], [35.15, ...plus, 1], [35.5, plus[0] + 60, plus[1] + 60, 0],
    ];
    cursorKeys.forEach(k => { k[0] += O; });
    clicks = [[A.clickProxy, proxy], [A.clickNode, node], [A.clickUse, use], [A.clickLaunch, launch], [A.clickTerminal, plus]];
  }

  // ---------- camera ----------
  // [time, zoom, focusX, focusY, anchorX, anchorY]
  const O = T.app.rise - 19.0; // camera and cursor keys below are authored for a 19.0 s start
  const BASE = [1.15, 640, 380, 960, 600];
  const CAM = [
    [19.0, ...BASE], [21.75, ...BASE],
    [22.55, 1.42, 764, 322, 960, 616], [24.45, 1.42, 764, 322, 960, 616],
    [25.25, 1.8, 620, 742, 960, 880], [26.65, 1.8, 620, 742, 960, 880],
    [27.35, ...BASE], [30.15, ...BASE],
    [30.9, 1.4, 764, 410, 960, 612], [33.25, 1.4, 764, 410, 960, 612],
    [34.1, ...BASE], [36.4, ...BASE],
    [42.6, 1.34, 700, 330, 960, 612],
  ].map(([at, ...rest]) => [at + O, ...rest]);
  function camAt(t) {
    if (t <= CAM[0][0]) return CAM[0].slice(1);
    for (let i = 0; i < CAM.length - 1; i++) {
      const a = CAM[i], b = CAM[i + 1];
      if (t <= b[0]) {
        const k = E.io(p(t, a[0], b[0]));
        return a.slice(1).map((v, j) => lerp(v, b[j + 1], k));
      }
    }
    return CAM[CAM.length - 1].slice(1);
  }
  function cursorAt(t) {
    const K = cursorKeys;
    if (t <= K[0][0]) return K[0].slice(1);
    for (let i = 0; i < K.length - 1; i++) {
      const a = K[i], b = K[i + 1];
      if (t <= b[0]) {
        const k = E.io(p(t, a[0], b[0]));
        return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
      }
    }
    return K[K.length - 1].slice(1);
  }

  // ---------- acts ----------
  // Fast, punchy reveal for the problem headlines.
  const punch = (el, t, at) => reveal(el, t, at, { stagger: 0.022, dur: 0.38, y: 26, b: 8 });
  const slam = (el, t, at, { from = 1.35, rot = 0, dur = 0.38 } = {}) => {
    const k = p(t, at, at + dur);
    const e = E.out5(k);
    css(el, { o: clamp(k * 5), tf: `scale(${lerp(from, 1, e).toFixed(4)}) rotate(${(rot * (1 - e * 0.6)).toFixed(2)}deg)`, f: blur((1 - clamp(k * 3)) * 10) });
  };

  function pain(t) {
    const P = T.pain;
    const layer = $('#night');
    css(layer, { o: t < P.end ? 1 : 0 });
    if (t >= P.end) return;

    // Hard cuts: every hit shakes the frame and flashes it for a few frames.
    const hits = [[P.slam, 1], [P.b2, 0.55], [P.b3, 0.55], [P.b4, 0.55], [P.vmMem, 0.45], ...P.losses.map(x => [x, 0.32]), [P.total, 0.3]];
    let shake = 0, flash = 0;
    hits.forEach(([h, k]) => {
      const q = p(t, h, h + 0.35), f = p(t, h, h + 0.13);
      if (q > 0 && q < 1) shake = Math.max(shake, (1 - q) * k);
      if (f > 0 && f < 1) flash = Math.max(flash, (1 - f) * k);
    });
    const sx = Math.sin(t * 97) * 12 * shake, sy = Math.cos(t * 83) * 8 * shake;
    css($('#flash'), { o: flash * 0.2 });
    css($('#nightGlow'), { o: t < P.b5 ? 0.45 + shake * 0.8 : 0 });

    const starts = [P.slam, P.b2, P.b3, P.b4, P.b5, P.end];
    $$('#night .beat').forEach((b, i) => {
      const a = starts[i], z = starts[i + 1];
      const k = E.out5(p(t, a, a + 0.4));
      css(b, { o: t >= a && t < z ? 1 : 0, tf: `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${(lerp(1.05, 1, k) + Math.max(0, t - a) * 0.006).toFixed(4)})` });
      const kick = b.querySelector('.kick');
      if (kick) css(kick, { o: E.out(p(t, a + 0.05, a + 0.3)) });
      const head = b.querySelector('.head');
      if (head) {
        const at = i === 0 ? P.losses[2] + 0.2 : a + 0.12;
        punch(head.children[0], t, at);
        punch(head.children[1], t, at + 0.22);
      }
    });

    // 01 · banned
    slam($('#alarm'), t, P.slam, { from: 1.5, dur: 0.42 });
    $$('#losses .loss').forEach((el, i) => slam(el, t, P.losses[i], { from: 1.4, rot: [-3, 2, -2][i], dur: 0.3 }));

    // 02 · bills
    const rk = E.out5(p(t, P.b2, P.b2 + 0.5));
    css($('#receipt'), { o: clamp(rk * 3), tf: `translateY(${((1 - rk) * 240 - Math.max(0, t - P.b2) * 6).toFixed(2)}px)` });
    $$('#receipt .rr').forEach((el, i) => {
      const k = E.out5(p(t, P.rows[i], P.rows[i] + 0.25));
      css(el, { o: k, tf: `translateX(${((1 - k) * -24).toFixed(2)}px)` });
    });
    slam($('#receipt .rt'), t, P.total, { from: 1.25, dur: 0.3 });
    css($('#receipt .rn'), { o: E.out(p(t, P.total + 0.35, P.total + 0.7)) });

    // 03 · the whole machine behind a global proxy
    css($('#pcLabel'), { o: E.out(p(t, P.b3 + 0.1, P.b3 + 0.4)) });
    slam($('#proxyNode'), t, P.wires + 0.15, { from: 0.6, dur: 0.45 });
    els.apps.forEach((a, i) => {
      const k = E.out5(p(t, P.b3 + 0.08 + i * 0.05, P.b3 + 0.4 + i * 0.05));
      css(a.chip, { o: k, tf: `translateX(${((1 - k) * -30).toFixed(2)}px)` });
      const w = E.io(p(t, P.wires + i * 0.06, P.wires + 0.5 + i * 0.06));
      a.path.style.strokeDashoffset = `${(a.len * (1 - w)).toFixed(2)}`;
      const pt = a.path.getPointAtLength(((t * 0.55 + i * 0.21) % 1) * a.len);
      a.dot.setAttribute('cx', pt.x.toFixed(2));
      a.dot.setAttribute('cy', pt.y.toFixed(2));
      a.dot.style.opacity = w >= 1 ? 0.9 : 0;
      const at = P.tags[i];
      const wk = Math.max(0, E.back(p(t, at, at + 0.35), 2));
      css(a.warn, { o: clamp(p(t, at, at + 0.12) * 1), tf: `scale(${wk.toFixed(4)})` });
      a.warn.style.transformOrigin = '100% 50%';
      a.chip.style.borderColor = t > at ? 'rgba(255,106,69,.65)' : 'rgba(255,240,225,.10)';
    });

    // 04 · a heavy VM that still needs everything set up
    slam($('#vmWin'), t, P.vm, { from: 1.12, dur: 0.4 });
    const dl = 0.11 + Math.max(0, t - P.vm) * 0.004;
    $('#vmDl').style.transform = `scaleX(${dl.toFixed(4)})`;
    $('#vmEta').textContent = t < P.vmMem ? '下载中 · 剩余 1 小时 52 分' : '下载中 · 剩余 2 小时 07 分';
    const mem = E.out5(p(t, P.vmMem, P.vmMem + 0.45));
    const memEl = $('#vmMem');
    memEl.style.transform = `scaleX(${lerp(0.25, 0.93, mem).toFixed(4)})`;
    memEl.style.background = mem > 0.3 ? '#ff6a45' : '#d9cfc5';
    $('#vmMemTxt').textContent = mem > 0.3 ? '14.9 GB / 16 GB · 主机开始卡顿' : '4 GB / 16 GB';
    css($('#vmTodo .lbl'), { o: E.out(p(t, P.vmTodo[0] - 0.2, P.vmTodo[0] + 0.1)) });
    $$('#vmTodo span').forEach((el, i) => slam(el, t, P.vmTodo[i], { from: 1.3, dur: 0.25 }));

    // and the question
    const [qa, qb] = $('#b5 .q').children;
    reveal(qa, t, P.b5 + 0.2, { stagger: 0.06, dur: 0.5, y: 20, b: 10 });
    reveal(qb, t, P.b5 + 0.65, { stagger: 0.06, dur: 0.5, y: 20, b: 10 });
    const qo = 1 - E.io(p(t, P.end - 0.35, P.end));
    css($('#b5 .q'), { tf: `scale(${(1 + Math.max(0, t - P.b5) * 0.015).toFixed(4)})`, f: blur((1 - qo) * 14) });
  }

  function room(t) {
    const R = T.room;
    const layer = $('#room');
    const o = E.out(p(t, R.start, R.start + 0.45));
    const gone = E.io(p(t, R.end - 0.6, R.end));
    css(layer, { o: t >= R.end ? 0 : o });
    if (t < R.start || t >= R.end) return;
    $('#roomLight').style.transform = `scale(${lerp(0.6, 1, E.out(p(t, R.start, R.start + 2.5))).toFixed(4)})`;

    logoAt(els.logo, t, { pixels: R.pixels, frame: R.frame, bars: R.bars, blink: [R.blink], speed: 0.7 });
    const bump = barImpact(t, R.bars);
    const lift = E.io(p(t, R.end - 0.9, R.end));
    css($('#logoWrap'), { o: 1 - gone, tf: `translateY(${(bump * 6 - lift * 40).toFixed(2)}px) scale(${(1 - lift * 0.06).toFixed(4)})` });

    reveal($('#wordmark'), t, R.word, { stagger: 0.035, dur: 0.6 });
    const [pa, pb] = $('#roomPos').children;
    reveal(pa, t, R.pos, { stagger: 0.035, dur: 0.6 });
    reveal(pb, t, R.pos + 0.4, { stagger: 0.07, dur: 0.6, y: 24 });
    const [sa, sb] = $('#roomSub').children;
    reveal(sa, t, R.sub, { stagger: 0.025, dur: 0.6, y: 10 });
    reveal(sb, t, R.sub + 0.75, { stagger: 0.04, dur: 0.6, y: 10 });
    ['#wordmark', '#roomPos', '#roomSub'].forEach(id => css($(id), { o: 1 - gone, tf: `translateY(${(-lift * 40).toFixed(2)}px)` }));
  }

  function app(t) {
    const A = T.app;
    const layer = $('#app');
    const lo = E.out(p(t, A.rise - 0.3, A.rise + 0.4)) * (1 - E.io(p(t, A.out + 0.4, A.end)));
    css(layer, { o: lo });
    if (lo <= 0) return;

    // captions + progress
    const capWin = [[A.step1, A.step2 - 0.2], [A.step2, A.step3 - 0.2], [A.step3, A.out]];
    els.caps.forEach((c, i) => {
      const [a, b] = capWin[i];
      const kin = E.out(p(t, a, a + 0.7)), kout = E.io(p(t, b - 0.35, b));
      css(c, { o: kin * (1 - kout), tf: `translateY(${((1 - kin) * 22 - kout * 14).toFixed(2)}px)`, f: blur((1 - kin) * 8 + kout * 8) });
      const [num, txt] = c.children;
      const k2 = E.out(p(t, a + 0.12, a + 0.9));
      css(txt.lastChild, { o: k2, tf: `translateY(${((1 - k2) * 10).toFixed(2)}px)` });
      els.dots[i].style.transform = `scaleX(${E.io(p(t, a, b)).toFixed(4)})`;
    });
    css($('#progressDots'), { o: win(t, A.step1, A.out, 0.6, 0.4) });

    // camera + window entrance / exit
    const [z, fx, fy, ax, ay] = camAt(t);
    const rise = E.out5(p(t, A.rise, A.rise + 1.3));
    const exit = E.io(p(t, A.out, A.end));
    const zz = z * lerp(0.94, 1, rise) * lerp(1, 0.9, exit);
    const tx = ax - fx * zz, ty = ay - fy * zz + (1 - rise) * 160 - exit * 20;
    css($('#cam'), { o: clamp(rise * 1.6) * (1 - exit), tf: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${zz.toFixed(5)})`, f: blur(exit * 10) });
    css($('#appFloor'), { o: rise * (1 - exit) * clamp(1 - (z - 1.15) * 3) });
    css($('#capShade'), { o: clamp((z - 1.15) * 4) });

    // --- step 1 · proxy ---
    const shade = win(t, A.modalOpen, A.modalClose + 0.35, 0.35, 0.35);
    css($('#modalShade'), { o: shade });
    const mo = E.out(p(t, A.modalOpen, A.modalOpen + 0.45)), mc = E.io(p(t, A.modalClose, A.modalClose + 0.3));
    css($('#modal'), { o: mo * (1 - mc), tf: `translateY(${((1 - mo) * 18 + mc * 10).toFixed(2)}px) scale(${(lerp(0.965, 1, mo) - mc * 0.02).toFixed(4)})` });
    const sel = E.out(p(t, A.clickNode, A.clickNode + 0.25));
    css(els.nodes[0].querySelector('.sel'), { o: sel });
    els.nodes[0].querySelector('.radio').style.borderColor = sel > 0.5 ? '#1d1b1a' : '#c9c3bc';
    els.nodes[0].querySelector('.radio i').style.transform = `scale(${Math.max(0, E.back(p(t, A.clickNode, A.clickNode + 0.3), 2)).toFixed(4)})`;
    els.nodes.forEach((n, i) => { css(n, { o: E.out(p(t, A.modalOpen + 0.15 + i * 0.06, A.modalOpen + 0.55 + i * 0.06)) }); });

    const press = (at) => 1 - Math.sin(Math.PI * p(t, at - 0.02, at + 0.16)) * 0.05;
    const ready = E.io(p(t, A.modalClose + 0.4, A.modalClose + 0.75));
    const swap = E.io(p(t, A.modalClose + 0.6, A.modalClose + 0.95));
    css($('#stateWait'), { o: 1 - ready, tf: `translateY(${(-ready * 8).toFixed(2)}px)` });
    css($('#stateReady'), { o: ready, tf: `translateY(${((1 - ready) * 8).toFixed(2)}px)` });
    css($('#btnProxy'), { o: 1 - swap, tf: `scale(${press(A.clickProxy).toFixed(4)})` });
    css($('#btnLaunch'), { o: swap, tf: `scale(${press(A.clickLaunch).toFixed(4)})` });
    const s1 = $('#st1 b'), s2 = $('#st2 b');
    const done1 = t > A.modalClose + 0.5, on2 = t > A.modalClose + 0.7;
    s1.className = done1 ? 'done' : 'on';
    s1.innerHTML = done1 ? '<svg class="i" viewBox="0 0 24 24"><path d="M5.5 12.5l4 4 9-9"/></svg>' : '1';
    s1.style.transform = `scale(${(1 + Math.sin(Math.PI * p(t, A.modalClose + 0.5, A.modalClose + 0.8)) * 0.18).toFixed(4)})`;
    s2.className = on2 ? 'on' : '';
    $('#st1 > span:last-child').className = done1 ? '' : 'strong';
    $('#st2 > span:last-child').className = on2 ? 'strong' : '';

    flip($('#proxyFlip'), t, [A.tzFlip - 0.3], 16);
    flip($('#tzFlip'), t, [A.tzFlip], 16);
    css($('#hlProxy'), { o: win(t, A.tzFlip - 0.35, A.tzFlip + 0.75, 0.3, 0.5) });
    css($('#hlTz'), { o: win(t, A.tzFlip - 0.05, A.tzFlip + 0.95, 0.3, 0.5) });

    // --- step 2 · launch ---
    const toLaunch = E.io(p(t, A.launch + 0.12, A.launch + 0.55));
    const heroOut = E.io(p(t, A.launch, A.launch + 0.25));
    const toTerm = E.io(p(t, A.terminal, A.terminal + 0.4));
    css($('#viewHero'), { o: 1 - heroOut, tf: `translateY(${(-heroOut * 14).toFixed(2)}px)` });
    css($('#viewLaunch'), { o: toLaunch * (1 - toTerm), tf: `translateY(${((1 - toLaunch) * 16 - toTerm * 10).toFixed(2)}px)` });

    const spin = `rotate(${(t * 420) % 360}deg)`;
    const stage = (row, start, end, label) => {
      const [wait, sp, ok] = row.querySelector('.st').children;
      const k = p(t, start, end);
      css(wait, { o: t < start ? 1 : 0 });
      css(sp, { o: t >= start && k < 1 ? 1 : 0, tf: spin });
      css(ok, { o: k >= 1 ? 1 : 0, tf: `scale(${Math.max(0, E.back(p(t, end, end + 0.3), 2)).toFixed(4)})` });
      return k;
    };
    els.prog.forEach((row, i) => {
      const [a, b] = i === 0 ? A.image : A.tools;
      const k = stage(row, a, b);
      const fill = i === 0 ? E.sine(k) : E.out(k);
      row.querySelector('.bar i').style.transform = `scaleX(${fill.toFixed(4)})`;
      row.querySelector('.pct').textContent = `${Math.round(fill * 100)}%`;
    });
    let passed = 0;
    els.checks.forEach((row, i) => {
      const at = A.checks + 0.15 + i * A.checkStep;
      stage(row, A.checks, at);
      if (t >= at) passed++;
      const [n, y] = row.querySelector('.res').children;
      const k = E.out(p(t, at, at + 0.25));
      css(n, { o: t < A.checks ? 0.5 : 1 - k });
      css(y, { o: k, tf: `translateX(${((1 - k) * 6).toFixed(2)}px)` });
      css(row.querySelector('.flash'), { o: Math.sin(Math.PI * p(t, at, at + 0.5)) });
    });
    const rel = E.out(p(t, A.released, A.released + 0.45));
    $('#ckCount').textContent = passed === 11 ? '11 / 11 通过' : `${passed} / 11`;
    $('#ckCount').style.color = passed === 11 ? '#1f5f35' : '#6c6763';
    css($('#phBusy'), { o: 1 - clamp(rel * 2.5), tf: `translateY(${(-rel * 16).toFixed(2)}px)`, f: blur(rel * 6) });
    css($('#phDone'), { o: clamp(rel * 1.6 - 0.4), tf: `translateY(${((1 - rel) * 14).toFixed(2)}px)` });
    css($('.ph .okb'), { o: rel, tf: `scale(${lerp(0.6, 1, Math.max(0, E.back(p(t, A.released, A.released + 0.45), 2))).toFixed(4)})` });
    $('.ph').style.background = `rgba(47,138,76,${(0.07 * Math.sin(Math.PI * p(t, A.released, A.released + 1.2))).toFixed(4)})`;

    // sidebar + status bar follow the environment state
    flip($('#envFlip'), t, [A.launch, A.released], 18);
    $('#envDot').style.background = t > A.released ? '#2f8a4c' : t > A.launch ? '#d29a2e' : '#b7b1ab';
    $('#envDot').style.boxShadow = t > A.released ? '0 0 0 3px rgba(47,138,76,.16)' : 'none';
    flip($('#netFlip'), t, [A.released + 0.15], 16);
    flip($('#latFlip'), t, [A.released + 0.35], 16);
    const netOk = t > A.released + 0.15;
    $('#netIco').style.color = netOk ? '#2f8a4c' : '#4a4642';
    $('#netTick').style.opacity = netOk ? 1 : 0;
    els.navEnable.forEach(n => { n.style.color = t > A.released ? '#2a2724' : '#b4aea8'; });
    css($('#stopIt'), { o: t > A.launch ? 1 : 0.4 });

    // --- step 3 · terminal ---
    css($('#viewTerm'), { o: toTerm });
    const term = E.out(p(t, A.clickTerminal, A.clickTerminal + 0.3));
    css($('#childHint'), { o: 1 - term });
    css($('#childTerm'), { o: term });
    $('#navHome').className = term > 0.5 ? '' : 'on';
    css($('#crumbLeaf'), { o: toTerm });
    css($('#syncIt'), { o: toTerm });
    els.termLines.forEach((ln, i) => {
      const k = E.out(p(t, A.terminal + 0.1 + i * 0.05, A.terminal + 0.45 + i * 0.05));
      css(ln, { o: k, tf: `translateY(${((1 - k) * 6).toFixed(2)}px)` });
    });
    const typed = (s, at, per) => s.slice(0, Math.max(0, Math.floor((t - at) / per) + 1) * (t >= at ? 1 : 0));
    $('#cmdText').textContent = typed('claude', A.typeClaude, 0.1);
    const blinkOn = Math.floor(t * 2.2) % 2 === 0;
    css($('#caret1'), { o: t < A.enterClaude ? (t > A.typeClaude && t < A.typeClaude + 0.7 ? 1 : blinkOn ? 1 : 0) : 0 });
    const cc = E.out(p(t, A.welcome, A.welcome + 0.5));
    css($('#ccBlock'), { o: cc, tf: `translateY(${((1 - cc) * 10).toFixed(2)}px)` });
    const prompt = '帮我给 hello-cage 写一份 README';
    $('#promptText').textContent = typed(prompt, A.typePrompt, (A.enterPrompt - 0.2 - A.typePrompt) / prompt.length);
    css($('#caret2'), { o: t < A.enterPrompt ? (t > A.typePrompt ? 1 : blinkOn ? 1 : 0) : 0 });
    els.replies.forEach((r, i) => {
      const k = E.out(p(t, A.reply[i], A.reply[i] + 0.35));
      css(r, { o: k, tf: `translateY(${((1 - k) * 6).toFixed(2)}px)` });
    });
    const final = 'README 写好了：简介、安装方式和本地运行步骤都在里面。';
    els.lastReply.textContent = ' ' + final.slice(0, Math.floor(p(t, A.reply[3], A.reply[3] + 1.1) * final.length));

    // cursor + clicks
    const [cx, cy, co] = cursorAt(t);
    const pressK = clicks.reduce((m, [at]) => Math.max(m, Math.sin(Math.PI * p(t, at - 0.04, at + 0.14))), 0);
    css($('#cursor'), { o: co, tf: `translate(${(cx - 248 - 5).toFixed(2)}px, ${(cy - 3).toFixed(2)}px) scale(${(1 - pressK * 0.16).toFixed(4)})` });
    let rip = null;
    clicks.forEach(([at, pos]) => { if (t >= at && t < at + 0.55) rip = [p(t, at, at + 0.55), pos]; });
    if (rip) {
      const [k, [x, y]] = rip;
      css($('#ripple'), { o: (1 - k) * 0.9, tf: `translate(${(x - 248).toFixed(2)}px, ${y.toFixed(2)}px) scale(${lerp(0.3, 1.5, E.out(k)).toFixed(4)})` });
    } else css($('#ripple'), { o: 0 });
  }

  function perks(t) {
    const P = T.perks;
    const o = E.io(p(t, P.start, P.start + 0.6)) * (1 - E.io(p(t, P.out, P.end)));
    css($('#perks'), { o });
    if (o <= 0) return;
    const [a, b] = $('#perksHead').children;
    reveal(a, t, P.head, { stagger: 0.05, dur: 0.6 });
    reveal(b, t, P.head + 0.2, { stagger: 0.045, dur: 0.6 });
    $$('#perkRow .perk').forEach((el, i) => {
      const k = E.out5(p(t, P.tiles[i], P.tiles[i] + 0.75));
      css(el, { o: clamp(k * 1.5), tf: `translateY(${((1 - k) * 70).toFixed(2)}px)` });
      el.querySelector('.pi').style.transform = `scale(${Math.max(0, E.back(p(t, P.tiles[i] + 0.15, P.tiles[i] + 0.55), 2.2)).toFixed(4)})`;
    });
    const drift = p(t, P.start, P.end);
    $('#perkRow').style.transform = `translateY(${(-drift * 14).toFixed(2)}px)`;
    $('#perksHead').style.transform = `translateY(${(-drift * 8).toFixed(2)}px)`;
  }

  function letter(t) {
    const L = T.letter;
    const layer = $('#letter');
    const o = E.io(p(t, L.start, L.start + 0.9)) * (1 - E.io(p(t, L.out, L.end)));
    css(layer, { o });
    if (o <= 0) return;
    const img = $('#art img');
    const k = p(t, L.start, L.end);
    img.style.transform = `scale(${lerp(1.12, 1.0, E.out(k)).toFixed(5)}) translate(${lerp(-10, 6, k).toFixed(2)}px, ${lerp(8, -4, k).toFixed(2)}px)`;
    const ar = E.out(p(t, L.start + 0.2, L.start + 1.8));
    css($('#art'), { o: ar, f: blur((1 - ar) * 14) });
    const sweep = E.io(p(t, L.start + 0.6, L.start + 3.2));
    css($('#artLight'), { o: Math.sin(Math.PI * sweep) * 0.9, tf: `translateX(${lerp(-70, 70, sweep).toFixed(2)}%)` });
    css($('#letterKicker'), { o: E.out(p(t, L.lines[0] - 0.6, L.lines[0] + 0.4)) * 1 });
    const ls = $$('#letterText [data-split]');
    ls.forEach((el, i) => reveal(el, t, L.lines[i], { stagger: 0.055, dur: 0.8, y: 14, b: 12 }));
    const drift = E.out(p(t, L.lines[0], L.end));
    $('#letterText').style.transform = `translateY(${(-drift * 14).toFixed(2)}px)`;
  }

  function end(t) {
    const N = T.end;
    const layer = $('#end');
    const o = E.io(p(t, N.start, N.start + 0.8));
    css(layer, { o });
    if (o <= 0) return;
    const a = N.start + 0.3;
    logoAt(els.endLogo, t, { pixels: a, frame: a + 0.55, bars: [a + 0.85, a + 1.0], blink: [N.blink], speed: 0.7 });
    css($('#endLogo'), { tf: `translateY(${(barImpact(t, [a + 0.85, a + 1.0]) * 4).toFixed(2)}px)` });
    const k = (d, dur = 0.8) => E.out(p(t, a + d, a + d + dur));
    const rise = (el, d) => { const v = k(d); css(el, { o: v, tf: `translateY(${((1 - v) * 16).toFixed(2)}px)`, f: blur((1 - v) * 6) }); };
    rise($('#endWord'), 1.2);
    rise($('#endSub'), 1.55);
    $$('#endPlat span').forEach((s, i) => rise(s, 1.95 + i * 0.12));
    rise($('#endUrl'), 2.5);
    rise($('#endGit'), 2.75);
    rise($('#endNote'), 3.1);
  }

  function chrome(t, frame) {
    const dark = t < T.room.start + 0.4 || (t > T.letter.start + 0.4 && t < T.letter.out + 0.4);
    const g = $('#grain');
    g.style.opacity = dark ? 0.55 : 0.3;
    g.style.transform = `translate(${Math.floor(hash(frame) * 200) - 100}px, ${Math.floor(hash(frame + 0.5) * 200) - 100}px)`;
    $('#vignette').style.opacity = dark ? 1 : 0.5;
  }

  function render(t) {
    t = clamp(t, 0, T.duration);
    pain(t);
    room(t);
    app(t);
    perks(t);
    letter(t);
    end(t);
    chrome(t, Math.round(t * T.fps));
  }

  // ---------- boot ----------
  const params = new URLSearchParams(location.search);
  const renderMode = params.has('render');
  if (renderMode) document.body.classList.add('render');

  function fit() {
    const stage = $('#stage');
    const s = renderMode ? 1 : Math.min(innerWidth / T.width, innerHeight / T.height);
    stage.style.position = 'absolute';
    stage.style.left = ((innerWidth - T.width * s) / 2) + 'px';
    stage.style.top = ((innerHeight - T.height * s) / 2) + 'px';
    stage.style.transform = `scale(${s})`;
  }

  build();
  fit();
  addEventListener('resize', fit);
  render(0);

  const ready = (async () => {
    await document.fonts.ready;
    const img = $('#art img');
    if (!img.complete) await new Promise(r => { img.onload = img.onerror = r; });
    try { await img.decode(); } catch { /* the frame still renders without the image */ }
    measure();
    render(0);
  })();

  window.__promo = {
    ready,
    duration: T.duration,
    fps: T.fps,
    seek: t => render(t),
  };

  if (renderMode) return;

  // Preview player.
  let now = parseFloat(params.get('t') || '0'), playing = !params.has('t'), last = null;
  const scrub = $('#scrub'), tc = $('#tc'), play = $('#play');
  scrub.max = T.duration;
  const show = () => { render(now); scrub.value = now; tc.textContent = now.toFixed(2).padStart(5, '0'); play.textContent = playing ? '暂停' : '播放'; };
  const loop = ts => {
    if (playing && last !== null) { now += (ts - last) / 1000; if (now >= T.duration) { now = T.duration; playing = false; } }
    last = ts;
    show();
    requestAnimationFrame(loop);
  };
  ready.then(() => requestAnimationFrame(loop));
  play.onclick = () => { if (now >= T.duration) now = 0; playing = !playing; };
  $('#restart').onclick = () => { now = 0; playing = true; };
  scrub.oninput = () => { now = parseFloat(scrub.value); playing = false; };
  addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); play.onclick(); }
    if (e.code === 'ArrowRight') { now = Math.min(T.duration, now + (e.shiftKey ? 0.1 : 1)); playing = false; }
    if (e.code === 'ArrowLeft') { now = Math.max(0, now - (e.shiftKey ? 0.1 : 1)); playing = false; }
  });
})();
