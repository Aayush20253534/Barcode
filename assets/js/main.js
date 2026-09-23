/* ==========================================================================
   BAR CODE — interaction layer
   Scroll-scrubbed hero film · smooth scroll · reveals · parallax ·
   horizontal drinks · gallery + lightbox · cursor · mobile menu
   ========================================================================== */
(() => {
  'use strict';

  const WA_URL = 'https://wa.me/919838070333?text=' +
    encodeURIComponent('Hello BAR CODE, I’d like to reserve a table. Please share the available options.');

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const damp = (k, dt) => 1 - Math.pow(1 - k, dt / 16.667);

  const root = document.documentElement;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const conn = navigator.connection || {};
  const SAVE_DATA = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
  const SLOW_NETWORK = SAVE_DATA || /3g$/.test(conn.effectiveType || '');
  const runIdle = (fn, timeout = 1200) => {
    if ('requestIdleCallback' in window) return window.requestIdleCallback(fn, { timeout });
    return window.setTimeout(fn, Math.min(timeout, 600));
  };

  // The film always starts from darkness unless a section was deep-linked
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!location.hash) window.scrollTo(0, 0);

  /* ---------- Reservation links: one source of truth ---------- */
  $$('[data-reserve]').forEach((a) => {
    a.href = WA_URL;
    a.target = '_blank';
    a.rel = 'noopener';
  });
  $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });

  /* ---------- Loader ---------- */
  const loader = (() => {
    const bar = $('.loader__bar span');
    const pct = $('.loader__pct');
    let done = false;
    let shown = 0;
    return {
      set(p) {
        const v = Math.round(clamp(p) * 100);
        if (v <= shown) return;
        shown = v;
        if (bar) bar.style.setProperty('--p', (v / 100).toFixed(2));
        if (pct) pct.textContent = String(v);
      },
      finish() {
        if (done) return;
        done = true;
        this.set(1);
        setTimeout(() => root.classList.add('is-ready'), REDUCED ? 0 : 280);
      },
    };
  })();
  setTimeout(() => loader.finish(), 5200); // never hold the visitor hostage

  /* ---------- Smooth scroll (desktop pointers only) ---------- */
  let lenis = null;
  if (!REDUCED && FINE && typeof window.Lenis === 'function') {
    lenis = new window.Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.95,
      smoothWheel: true,
      syncTouch: false,
    });
  }

  /* ==========================================================================
     HERO FILM — scroll-controlled image sequence with frame interpolation
     ========================================================================== */
  const FILM = {
    count: 283,
    base: { d: 'assets/hero/d/', m: 'assets/hero/m/' },
    end: { d: 'assets/hero/poster-d.webp', m: 'assets/hero/poster-m.webp' },
    filmShare: 0.86, // share of the hero scroll that plays the film; the rest holds the final frame
    shots: [
      [0.000, 'Darkness'],
      [0.085, 'The Bottle'],
      [0.198, 'The Mark'],
      [0.336, 'The Tilt'],
      [0.424, 'The Pour'],
      [0.530, 'The Fill'],
      [0.650, 'Carbonation'],
      [0.742, 'The Head'],
      [0.813, 'The Composition'],
      [0.940, 'Bar Code'],
    ],
  };

  const hero = (() => {
    const section = $('.hero');
    if (!section) return null;
    const sticky = $('.hero__sticky', section);
    const canvas = $('.hero__canvas', section);
    const opening = $('.hero__opening', section);
    const whispers = $$('.hero__whisper', section).map((el) => ({
      el, a: parseFloat(el.dataset.in), b: parseFloat(el.dataset.out),
    }));
    const hudNum = $('.hud__num', section);
    const hudName = $('.hud__name', section);
    const content = $('.hero__content', section);
    const nav = $('.nav');

    let isStatic = false;
    const goStatic = () => {
      isStatic = true;
      section.classList.add('is-static', 'is-end');
      return { section, update() {}, bottom: () => section.offsetTop + section.offsetHeight };
    };

    if (REDUCED || !canvas || !canvas.getContext) {
      const img = $('.hero__poster img', section);
      if (img && !img.complete) img.addEventListener('load', () => loader.finish(), { once: true });
      else loader.finish();
      return goStatic();
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    const N = FILM.count;
    let variant = '';
    let frames = [];
    let endImg = null;
    let token = 0;
    let current = -1;
    let target = 0;
    let needsDraw = true;
    let shotIndex = -1;
    let failed = 0;
    let phone = false;

    const pickVariant = () => (window.innerWidth / window.innerHeight < 0.9 ? 'm' : 'd');
    const src = (i) => FILM.base[variant] + String(i + 1).padStart(4, '0') + '.webp';

    // coarse-to-fine load order: every 12th frame first, then halve the gap
    function buildOrder(finest) {
      const seen = new Uint8Array(N);
      const order = [];
      const push = (i) => { if (!seen[i]) { seen[i] = 1; order.push(i); } };
      push(0); push(N - 1);
      [12, 6, 3, 1].forEach((s) => {
        if (s < finest) return;
        for (let i = 0; i < N; i += s) push(i);
      });
      if (finest > 1) for (let i = 0; i < N; i += finest) push(i);
      return order;
    }

    let prioritizeFrames = () => {};
    let requestEndFrame = () => {};
    function load() {
      const my = ++token;
      frames = new Array(N).fill(null);
      endImg = null;

      const finest = SAVE_DATA ? 4 : SLOW_NETWORK ? 3 : variant === 'm' ? 2 : 1;
      const critical = buildOrder(24);
      const medium = buildOrder(6);
      const full = buildOrder(finest);
      const criticalPending = new Set(critical);
      const queued = new Uint8Array(N);
      const inFlight = new Uint8Array(N);
      const loaded = new Uint8Array(N);
      let queue = [];
      let active = 0;
      let criticalSettled = 0;
      let criticalReady = false;
      let endRequested = false;
      let backfillScheduled = false;
      const CONCURRENCY = SAVE_DATA ? 2 : SLOW_NETWORK ? 3 : 4;

      requestEndFrame = () => {
        if (my !== token || endRequested) return;
        endRequested = true;
        const img = new Image();
        img.decoding = 'async';
        img.src = FILM.end[variant];
        endImg = img;
      };

      const enqueue = (indices, priority = false) => {
        if (my !== token) return;
        const add = [];
        for (const i of indices) {
          if (i < 0 || i >= N || loaded[i] || queued[i] || inFlight[i]) continue;
          queued[i] = 1;
          add.push(i);
        }
        if (!add.length) return;
        queue = priority ? add.concat(queue) : queue.concat(add);
        pump();
      };

      prioritizeFrames = (center) => {
        if (!criticalReady) return;
        const nearby = [center];
        for (let d = 1; d <= 6; d++) {
          nearby.push(center + d, center - d);
        }
        enqueue(nearby, true);
      };

      const scheduleBackfill = () => {
        if (backfillScheduled || my !== token) return;
        backfillScheduled = true;
        runIdle(() => {
          if (my !== token) return;
          enqueue(medium);
          requestEndFrame();
        }, 900);
        if (!SAVE_DATA) {
          window.setTimeout(() => runIdle(() => {
            if (my === token) enqueue(full);
          }, 1800), 2200);
        }
      };

      const pump = () => {
        if (my !== token) return;
        while (active < CONCURRENCY && queue.length) {
          const i = queue.shift();
          queued[i] = 0;
          if (loaded[i] || inFlight[i]) continue;
          inFlight[i] = 1;
          active++;
          const img = new Image();
          img.decoding = 'async';
          img.src = src(i);
          const settle = (ok) => {
            active--;
            if (my !== token) return;
            inFlight[i] = 0;
            loaded[i] = 1;
            if (ok) {
              frames[i] = img;
              needsDraw = true;
            } else {
              failed++;
            }
            if (criticalPending.delete(i)) {
              criticalSettled++;
              loader.set(criticalSettled / critical.length);
              if (criticalSettled === critical.length) {
                criticalReady = true;
                loader.finish();
                scheduleBackfill();
              }
            }
            if (i === 0 && !ok) { goStatic(); loader.finish(); token++; return; }
            pump();
          };
          const p = img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
          p.then(() => settle(true), () => settle(img.complete && img.naturalWidth > 0));
        }
      };
      enqueue(critical);
    }

    // Smartphone composition: portrait frames on screens <= 600 CSS px wide
    // are contained, scaled down and set a little above centre so the bottle
    // and glass sit between the navigation and the end-card copy.
    const PHONE_MAX_W = 600;
    const PHONE_MAX_H = 0.5; // share of the hero height the frame may fill (short phones)
    const PHONE_Y = 0.3;     // share of the spare height left above the frame
    const PHONE_GAP = 16;    // CSS px kept clear of the nav and the end copy
    // The mobile film itself is mastered against true black. Keep the phone
    // canvas on the same black level; otherwise the contained 9:16 frame is
    // visible as a #000 rectangle against the site's #080808 obsidian.
    const PHONE_BG = '#000000';
    const phoneScale = () => {
      const vw = window.innerWidth;
      return vw <= 390 ? 0.56 : vw <= 430 ? 0.6 : 0.66;
    };

    function phoneFit(cw, ch, iw, ih) {
      const s = Math.min(Math.min(cw / iw, ch / ih) * phoneScale(), ch * PHONE_MAX_H / ih);
      const w = iw * s;
      const h = ih * s;
      return { x: (cw - w) * 0.5, y: (ch - h) * PHONE_Y, w, h };
    }

    // The hold-phase stage move (.hero__stage in CSS) was tuned for tablets;
    // on phones it is solved here so the settled composition lands between
    // the nav and the end copy instead of under the nav or over the title.
    function layoutPhone() {
      if (!phone || !content) {
        sticky.style.removeProperty('--stage-lift');
        sticky.style.removeProperty('--stage-shrink');
        return;
      }
      const H = sticky.clientHeight;
      const film = phoneFit(sticky.clientWidth, H, 9, 16); // m frames are 450x800
      const top = (nav ? nav.offsetHeight : 0) + PHONE_GAP;
      const room = Math.max(0, content.offsetTop - PHONE_GAP - top);
      const k = clamp(room / film.h, 0.4, 1);
      const y = top + Math.max(0, room - film.h * k) * 0.5;
      const oy = H * 0.2; // transform-origin: 50% 20%
      sticky.style.setProperty('--stage-lift', (y - oy - (film.y - oy) * k).toFixed(1) + 'px');
      sticky.style.setProperty('--stage-shrink', (1 - k).toFixed(4));
    }

    function resize() {
      const w = sticky.clientWidth;
      const h = sticky.clientHeight;
      const maxW = variant === 'm' ? 1000 : 1920;
      const scale = Math.min(window.devicePixelRatio || 1, maxW / w, 2);
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      needsDraw = true;
      phone = variant === 'm' && window.innerWidth <= PHONE_MAX_W;
      layoutPhone();
    }

    function setVariant() {
      const v = pickVariant();
      if (v === variant) return;
      variant = v;
      load();
    }

    // horizontal focus for desktop cover-cropping on narrower windows
    function focusX(film) {
      if (variant === 'm') return 0.5;
      if (film < 0.32) return 0.5;
      if (film < 0.36) return 0.5 + (film - 0.32) / 0.04 * 0.05;
      if (film < 0.64) return 0.55;
      return 0.55 + smooth(clamp((film - 0.64) / 0.3)) * 0.11;
    }

    function drawCover(img, alpha, fx) {
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) return null;
      ctx.globalAlpha = alpha;

      // Phones: smaller contained composition. Every frame and the end
      // still go through phoneFit so they line up exactly.
      if (phone) {
        const r = phoneFit(cw, ch, iw, ih);
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
        return r;
      }

      // Desktop keeps the cinematic edge-to-edge crop. Tablets use a
      // contained portrait composition so the bottle and glass stay fully
      // visible instead of being enlarged by cover-cropping.
      const mobile = variant === 'm';
      const s = mobile
        ? Math.min(cw / iw, ch / ih)
        : Math.max(cw / iw, ch / ih);
      const w = iw * s;
      const h = ih * s;
      const x = mobile ? (cw - w) * 0.5 : (cw - w) * fx;
      const y = mobile ? (ch - h) * 0.5 : (ch - h) * 0.45;

      ctx.drawImage(img, x, y, w, h);
      return null;
    }

    // Portrait source frames are intentionally contained on phones. Their
    // near-black photographed background is not exactly the same shade as
    // the site's obsidian background, which can expose the source image as a
    // visible rectangle. Feather the four source-image edges back into the
    // hero background so the bottle feels suspended in the page instead of
    // sitting inside a box. This is canvas-only and phone-only; desktop and
    // tablet composition remains untouched.
    function blendPhoneFrameEdges(r) {
      if (!phone || !r) return;

      const fadeX = Math.max(12, r.w * 0.13);
      const fadeTop = Math.max(10, r.h * 0.055);
      const fadeBottom = Math.max(14, r.h * 0.1);
      const transparent = 'rgba(8, 8, 8, 0)';

      ctx.save();
      ctx.globalAlpha = 1;

      let g = ctx.createLinearGradient(r.x, 0, r.x + fadeX, 0);
      g.addColorStop(0, PHONE_BG);
      g.addColorStop(1, transparent);
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, fadeX, r.h);

      g = ctx.createLinearGradient(r.x + r.w - fadeX, 0, r.x + r.w, 0);
      g.addColorStop(0, transparent);
      g.addColorStop(1, PHONE_BG);
      ctx.fillStyle = g;
      ctx.fillRect(r.x + r.w - fadeX, r.y, fadeX, r.h);

      g = ctx.createLinearGradient(0, r.y, 0, r.y + fadeTop);
      g.addColorStop(0, PHONE_BG);
      g.addColorStop(1, transparent);
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, fadeTop);

      g = ctx.createLinearGradient(0, r.y + r.h - fadeBottom, 0, r.y + r.h);
      g.addColorStop(0, transparent);
      g.addColorStop(1, PHONE_BG);
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y + r.h - fadeBottom, r.w, fadeBottom);

      ctx.restore();
    }

    function nearest(i) {
      if (frames[i]) return i;
      for (let d = 1; d < N; d++) {
        if (i - d >= 0 && frames[i - d]) return i - d;
        if (i + d < N && frames[i + d]) return i + d;
      }
      return -1;
    }

    function render(p) {
      const film = clamp(p / FILM.filmShare);
      const hold = clamp((p - FILM.filmShare) / (1 - FILM.filmShare));
      const f = film * (N - 1);
      const i0 = Math.min(N - 1, Math.floor(f));
      const t = f - i0;
      prioritizeFrames(i0);
      if (film > 0.72 || hold > 0) requestEndFrame();

      const a = nearest(i0);
      const fx = focusX(film);
      let phoneRect = null;

      // Contained mobile frames can leave unused canvas space. Clear it
      // before drawing so those areas stay clean black between frames.
      if (variant === 'm') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = PHONE_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (a >= 0) {
        phoneRect = drawCover(frames[a], 1, fx) || phoneRect;
        // frame interpolation: blend toward the next frame by the fractional position
        if (a === i0 && t > 0.002 && i0 + 1 < N && frames[i0 + 1]) {
          phoneRect = drawCover(frames[i0 + 1], t, fx) || phoneRect;
        }
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = PHONE_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      // resolve into the crisp 2K master still during the hold
      if (hold > 0 && endImg && endImg.complete && endImg.naturalWidth) {
        phoneRect = drawCover(endImg, smooth(clamp(hold * 2.4)), fx) || phoneRect;
      }
      ctx.globalAlpha = 1;

      if (phoneRect) blendPhoneFrameEdges(phoneRect);

      // overlay choreography
      const end = smooth(clamp((p - 0.83) / 0.1));
      sticky.style.setProperty('--p', p.toFixed(4));
      sticky.style.setProperty('--end', end.toFixed(3));
      sticky.style.setProperty('--hold', smooth(clamp((p - 0.87) / 0.09)).toFixed(3));
      section.classList.toggle('is-end', p > 0.9);
      section.classList.toggle('is-scrolled', p > 0.008);

      if (opening) opening.style.opacity = (1 - smooth(clamp(p / 0.03))).toFixed(3);

      for (const w of whispers) {
        const fade = 0.028;
        const o = smooth(clamp((film - w.a) / fade)) * (1 - smooth(clamp((film - (w.b - fade)) / fade)));
        w.el.style.opacity = o.toFixed(3);
        const y = (1 - o) * 18 * (film < w.a + fade ? 1 : -1);
        w.el.style.transform = variant === 'm'
          ? `translate3d(0, ${y.toFixed(1)}px, 0)`
          : `translate3d(0, calc(-50% + ${y.toFixed(1)}px), 0)`;
      }

      let s = 0;
      for (let k = 0; k < FILM.shots.length; k++) if (film >= FILM.shots[k][0]) s = k;
      if (s !== shotIndex) {
        shotIndex = s;
        if (hudNum) hudNum.textContent = String(s + 1).padStart(2, '0');
        if (hudName) {
          hudName.textContent = FILM.shots[s][1];
          hudName.classList.remove('is-swap');
          void hudName.offsetWidth;
          hudName.classList.add('is-swap');
        }
      }
    }

    function progress() {
      const r = section.getBoundingClientRect();
      const total = r.height - sticky.offsetHeight;
      return total > 0 ? clamp(-r.top / total) : 0;
    }

    function update(dt) {
      if (isStatic) return;
      const r = section.getBoundingClientRect();
      if (r.bottom < -50 && current === 1) return;
      target = progress();
      if (current < 0) current = target;
      const k = variant === 'm' ? 0.2 : 0.12;
      const next = current + (target - current) * damp(k, dt);
      const moved = Math.abs(next - current) > 0.00002;
      current = Math.abs(target - next) < 0.00005 ? target : next;
      if (moved || needsDraw) {
        needsDraw = false;
        render(current);
      }
    }

    setVariant();
    resize();
    let rt;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => { setVariant(); resize(); }, 120);
    };
    if ('ResizeObserver' in window) {
      new ResizeObserver(onResize).observe(sticky);
      // the end copy reflows with web fonts and rotation; keep the phone hold layout in step
      if (content) new ResizeObserver(() => layoutPhone()).observe(content);
    }
    window.addEventListener('orientationchange', onResize);

    return { section, update, bottom: () => section.offsetTop + section.offsetHeight };
  })();

  /* ==========================================================================
     Navigation
     ========================================================================== */
  const nav = $('#nav');
  function updateNav(y) {
    if (!nav) return;
    const threshold = hero
      ? (hero.section.classList.contains('is-static') ? hero.bottom() - 120 : hero.bottom() - window.innerHeight * 0.6)
      : 40;
    nav.classList.toggle('is-solid', y > threshold);
  }

  // active link
  const navLinks = $$('[data-nav]');
  if (navLinks.length && 'IntersectionObserver' in window) {
    const map = new Map(navLinks.map((a) => [a.dataset.nav, a]));
    const sio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const link = map.get(en.target.id);
        if (!link) return;
        if (en.isIntersecting) {
          navLinks.forEach((a) => a.classList.toggle('is-active', a === link));
        } else if (link.classList.contains('is-active')) {
          link.classList.remove('is-active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['experience', 'atmosphere', 'drinks', 'food', 'gallery', 'visit'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) sio.observe(el);
    });
    // Atmosphere belongs to the Experience chapter
    const atm = document.getElementById('atmosphere');
    if (atm) map.set('atmosphere', map.get('experience'));
  }

  /* ---------- Mobile menu ---------- */
  const toggle = $('.nav__toggle');
  const menu = $('#menu');
  const toggleLabel = $('.nav__toggle-label');
  let menuOpen = false;

  function openMenu() {
    if (!menu || menuOpen) return;
    menuOpen = true;
    menu.inert = false;
    menu.classList.add('is-open');
    root.classList.add('menu-open');
    toggle.setAttribute('aria-expanded', 'true');
    if (toggleLabel) toggleLabel.textContent = 'Close';
    document.body.classList.add('is-locked');
    if (lenis) lenis.stop();
    const first = $('.menu__links a', menu);
    setTimeout(() => first && first.focus({ preventScroll: true }), 350);
  }
  function closeMenu(returnFocus) {
    if (!menu || !menuOpen) return;
    menuOpen = false;
    menu.classList.remove('is-open');
    menu.inert = true;
    root.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (toggleLabel) toggleLabel.textContent = 'Menu';
    document.body.classList.remove('is-locked');
    if (lenis) lenis.start();
    if (returnFocus) toggle.focus({ preventScroll: true });
  }
  if (toggle && menu) {
    toggle.addEventListener('click', () => (menuOpen ? closeMenu(true) : openMenu()));
    document.addEventListener('keydown', (e) => {
      if (!menuOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
      if (e.key === 'Tab') {
        const items = [toggle, ...$$('a, button', menu)];
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    });
    matchMedia('(min-width: 900px)').addEventListener('change', (e) => { if (e.matches) closeMenu(false); });
  }

  /* ---------- In-page anchors ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (!id || id.length < 2) return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    const wasOpen = menuOpen;
    closeMenu(false);
    const go = () => {
      if (lenis) {
        lenis.scrollTo(id === '#top' ? 0 : el, { offset: 0, duration: 1.9, easing: (t) => 1 - Math.pow(1 - t, 4) });
      } else {
        const y = id === '#top' ? 0 : el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: y, behavior: REDUCED ? 'auto' : 'smooth' });
      }
      if (id !== '#top') history.replaceState(null, '', id);
      else history.replaceState(null, '', location.pathname + location.search);
    };
    wasOpen ? setTimeout(go, 420) : go();
    if (a.classList.contains('skip-link')) {
      el.setAttribute('tabindex', '-1');
      setTimeout(() => el.focus({ preventScroll: true }), 50);
    }
  });

  /* ==========================================================================
     Reveals
     ========================================================================== */
  const revealEls = $$('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const rio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        rio.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach((el) => rio.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* ==========================================================================
     Parallax
     ========================================================================== */
  const parallax = REDUCED ? [] : $$('[data-parallax]').map((el) => ({
    el, box: el.parentElement, speed: parseFloat(el.dataset.parallax) || 0.1, on: false,
  }));
  if (parallax.length && 'IntersectionObserver' in window) {
    const pio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const item = parallax.find((p) => p.box === en.target);
        if (item) item.on = en.isIntersecting;
      });
    }, { rootMargin: '25% 0px' });
    parallax.forEach((p) => pio.observe(p.box));
  }
  function updateParallax() {
    const vh = window.innerHeight;
    for (const p of parallax) {
      if (!p.on) continue;
      const r = p.box.getBoundingClientRect();
      const offset = r.top + r.height / 2 - vh / 2;
      const max = r.height * 0.075;
      const y = clamp(-offset * p.speed, -max, max);
      p.el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    }
  }

  /* ==========================================================================
     Drinks — pinned horizontal travel on desktop, native swipe on touch
     ========================================================================== */
  const drinks = (() => {
    const sec = $('.drinks');
    if (!sec) return null;
    const track = $('.drinks__track', sec);
    const mq = matchMedia('(min-width: 1024px)');
    let enabled = false;
    let dist = 0;
    let cur = -1;

    function setup() {
      enabled = mq.matches && !REDUCED;
      sec.classList.toggle('is-pinned', enabled);
      track.style.transform = '';
      if (!enabled) { sec.style.height = ''; return; }
      track.style.width = 'max-content';
      dist = Math.max(0, track.scrollWidth - window.innerWidth);
      sec.style.height = `${Math.round(dist + window.innerHeight)}px`;
      cur = -1;
    }
    function update(dt) {
      if (!enabled) return;
      const r = sec.getBoundingClientRect();
      if (r.top > window.innerHeight || r.bottom < 0) return;
      const total = r.height - window.innerHeight;
      const p = total > 0 ? clamp(-r.top / total) : 0;
      cur = cur < 0 ? p : cur + (p - cur) * damp(0.14, dt);
      track.style.transform = `translate3d(${(-cur * dist).toFixed(1)}px, 0, 0)`;
      sec.style.setProperty('--dp', cur.toFixed(4));
    }
    setup();
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => { setup(); if (lenis) lenis.resize(); }, 150);
    });
    // images inside the track change its width once they arrive
    $$('img', sec).forEach((img) => { if (!img.complete) img.addEventListener('load', () => setup(), { once: true }); });
    return { update };
  })();

  /* ==========================================================================
     Gallery — filters + lightbox
     ========================================================================== */
  const gItems = $$('.g-item');
  const chips = $$('.chip');
  chips.forEach((chip) => chip.addEventListener('click', () => {
    const f = chip.dataset.filter;
    chips.forEach((c) => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    gItems.forEach((it) => {
      const show = f === 'all' || it.dataset.cat === f;
      it.classList.toggle('is-hidden', !show);
      it.classList.remove('is-entering');
      if (show && !REDUCED) { void it.offsetWidth; it.classList.add('is-entering'); }
    });
    if (lenis) lenis.resize();
  }));

  const dlg = $('.lightbox');
  if (dlg && typeof dlg.showModal === 'function') {
    const media = $('.lightbox__media', dlg);
    const cap = $('.lightbox__cap', dlg);
    const count = $('.lightbox__count', dlg);
    let list = [];
    let idx = 0;
    let trigger = null;

    const show = () => {
      const it = list[idx];
      const img = new Image();
      img.src = it.dataset.full;
      img.alt = ($('img', it) || {}).alt || '';
      img.decoding = 'async';
      media.replaceChildren(img);
      cap.textContent = it.dataset.caption || '';
      count.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    };
    const step = (d) => { idx = (idx + d + list.length) % list.length; show(); };

    gItems.forEach((it) => it.addEventListener('click', () => {
      list = gItems.filter((g) => !g.classList.contains('is-hidden'));
      idx = Math.max(0, list.indexOf(it));
      trigger = it;
      show();
      dlg.showModal();
      if (lenis) lenis.stop();
    }));
    $('.lightbox__close', dlg).addEventListener('click', () => dlg.close());
    $('.lightbox__prev', dlg).addEventListener('click', () => step(-1));
    $('.lightbox__next', dlg).addEventListener('click', () => step(1));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    });
    dlg.addEventListener('close', () => {
      if (lenis) lenis.start();
      if (trigger) trigger.focus({ preventScroll: true });
    });
    let sx = 0;
    dlg.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    dlg.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ==========================================================================
     Lazy media — map + finale film loop
     ========================================================================== */
  if ('IntersectionObserver' in window) {
    const map = $('.visit__map iframe');
    if (map) {
      const mio = new IntersectionObserver(([en]) => {
        if (!en.isIntersecting) return;
        map.src = map.dataset.src;
        mio.disconnect();
      }, { rootMargin: '600px 0px' });
      mio.observe(map);
    }

    const video = $('.finale__video');
    if (video && !REDUCED && !SAVE_DATA) {
      const source = $('source', video);
      const vio = new IntersectionObserver(([en]) => {
        if (en.isIntersecting) {
          if (!source.src) { source.src = source.dataset.src; video.load(); }
          const p = video.play();
          if (p && p.catch) p.catch(() => {});
        } else {
          video.pause();
        }
      }, { rootMargin: '200px 0px' });
      vio.observe(video);
    }
  }

  /* ---------- Floating mobile reservation ---------- */
  const mBar = $('.m-reserve');
  const finale = $('.finale');
  let finaleInView = false;
  if (finale && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { finaleInView = en.isIntersecting; }, { rootMargin: '0px 0px -20% 0px' }).observe(finale);
  }
  function updateMobileBar(y) {
    if (!mBar) return;
    const start = hero ? hero.bottom() - window.innerHeight * 0.2 : window.innerHeight * 0.6;
    mBar.classList.toggle('is-visible', y > start && !finaleInView && !menuOpen);
  }

  /* ==========================================================================
     Cursor + magnetic CTAs (fine pointers only)
     ========================================================================== */
  let cursorTick = () => {};
  if (FINE && !REDUCED) {
    const cur = $('.cursor');
    const dot = $('.cursor__dot');
    const ring = $('.cursor__ring');
    if (cur && dot && ring) {
      root.classList.add('has-cursor');
      cur.classList.add('is-hidden');
      let mx = -100; let my = -100; let rx = -100; let ry = -100;
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        mx = e.clientX; my = e.clientY;
        dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
        cur.classList.remove('is-hidden');
      }, { passive: true });
      document.addEventListener('mouseleave', () => cur.classList.add('is-hidden'));
      document.addEventListener('pointerover', (e) => {
        cur.classList.toggle('is-hover', !!e.target.closest('a, button, [data-cursor], .g-item'));
      });
      window.addEventListener('pointerdown', () => cur.classList.add('is-down'));
      window.addEventListener('pointerup', () => cur.classList.remove('is-down'));
      cursorTick = (dt) => {
        const k = damp(0.2, dt);
        rx += (mx - rx) * k;
        ry += (my - ry) * k;
        ring.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`;
      };
    }

    $$('[data-magnetic]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate3d(${(x * 0.2).toFixed(1)}px, ${(y * 0.3).toFixed(1)}px, 0)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ==========================================================================
     Master loop
     ========================================================================== */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (lenis) lenis.raf(now);
    const y = window.scrollY;
    if (hero) hero.update(dt);
    if (drinks) drinks.update(dt);
    updateParallax();
    updateNav(y);
    updateMobileBar(y);
    cursorTick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // a refreshed page may land mid-document — make sure the layout is measured once fonts settle
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (lenis) lenis.resize(); });
  }
})();
