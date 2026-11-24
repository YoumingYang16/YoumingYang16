(() => {
  'use strict';
  if (window.LuluAssistant?.version === '3.0.0') return;

  const REPOSITORIES = 'https://github.com/YoumingYang16?tab=repositories';
  const instances = new WeakMap();
  let sequence = 0;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const finiteRatio = (value, fallback) => Number.isFinite(value) ? clamp(value, 0, 1) : fallback;

  function mount(element, options = {}) {
    const root = typeof element === 'string' ? document.querySelector(element) : element;
    if (!(root instanceof HTMLElement)) throw new TypeError('LuluAssistant.mount requires an existing element.');
    if (instances.has(root)) return instances.get(root);
    const id = `lulu-${++sequence}`;
    const asset = options.asset || root.dataset.asset || 'assets/lulu.webp';
    // Keep the old key so existing positions survive the move to a direct link.
    const storageKey = options.storageKey || root.dataset.storageKey || `lulu-assistant:v2:${location.pathname}`;
    const bottomOffset = Math.max(0, Number(options.bottomOffset ?? root.dataset.bottomOffset) || 0);
    const listeners = new AbortController();
    const signal = listeners.signal;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const state = { x: 0, y: 0, reducedMotion: motion.matches, ratios: { x: 1, y: 1 } };
    let pointer = null;
    let suppressClickUntil = 0;
    let resizeFrame = 0;
    let followFrame = 0;
    let followPoint = null;
    let announceTimer = 0;
    let destroyed = false;

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved?.version === 2 || saved?.version === 3) {
        state.ratios = { x: finiteRatio(saved.x, 1), y: finiteRatio(saved.y, 1) };
      }
    } catch (_) { /* Storage is optional. */ }

    root.classList.remove('is-open', 'is-collapsed', 'has-intro-hint');
    root.classList.add('lulu-assistant');
    root.removeAttribute('aria-label');
    root.removeAttribute('data-lulu-side');
    root.removeAttribute('data-lulu-hint-below');
    root.removeAttribute('data-lulu-hint-hidden');
    root.innerHTML = `
      <a class="lulu-launcher" href="${REPOSITORIES}" draggable="false" aria-label="查看 Youming 的 GitHub 仓库" aria-describedby="${id}-help">
        <span class="lulu-look"><img class="lulu-image" alt="" draggable="false"><span class="lulu-fallback" hidden aria-hidden="true"><svg viewBox="0 0 80 80" focusable="false"><circle cx="40" cy="42" r="31" fill="#ffc451"/><circle cx="29" cy="36" r="3" fill="#443126"/><circle cx="51" cy="36" r="3" fill="#443126"/><path d="M32 49q8 8 16 0" fill="none" stroke="#443126" stroke-width="3" stroke-linecap="round"/></svg></span></span>
      </a>
      <span class="lulu-sr-only" id="${id}-help">轻点或按 Enter 打开仓库。可拖动；方向键移动，Shift 加快，Home 回到右下角，Escape 取消当前拖动。</span>
      <span class="lulu-sr-only" data-lulu-status role="status" aria-live="polite"></span>`;

    const launcher = root.querySelector('.lulu-launcher');
    const image = root.querySelector('.lulu-image');
    const fallback = root.querySelector('.lulu-fallback');
    const status = root.querySelector('[data-lulu-status]');
    image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; }, { signal });
    image.src = asset;

    function viewport() {
      const view = window.visualViewport;
      return { width: view?.width || window.innerWidth, height: view?.height || window.innerHeight, left: view?.offsetLeft || 0, top: view?.offsetTop || 0 };
    }

    function bounds() {
      const view = viewport();
      const width = root.offsetWidth;
      const height = root.offsetHeight;
      const margin = Math.min(14, Math.max(6, view.width / 28));
      const minX = view.left + margin;
      const minY = view.top + margin;
      return { minX, minY, maxX: Math.max(minX, view.left + view.width - width - margin), maxY: Math.max(minY, view.top + view.height - height - margin - bottomOffset) };
    }

    function save() {
      const box = bounds();
      state.ratios = {
        x: box.maxX === box.minX ? 0 : (state.x - box.minX) / (box.maxX - box.minX),
        y: box.maxY === box.minY ? 0 : (state.y - box.minY) / (box.maxY - box.minY)
      };
      // Retire previous language/collapsed states; the mascot always remains visible.
      try { localStorage.setItem(storageKey, JSON.stringify({ version: 3, x: state.ratios.x, y: state.ratios.y })); } catch (_) { /* Optional persistence. */ }
    }

    function announce(text) {
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => { status.textContent = text; }, 120);
    }

    function setPosition(x, y) {
      const box = bounds();
      state.x = clamp(x, box.minX, box.maxX);
      state.y = clamp(y, box.minY, box.maxY);
      root.style.transform = `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0)`;
    }

    function restorePosition() {
      const box = bounds();
      setPosition(box.minX + state.ratios.x * (box.maxX - box.minX), box.minY + state.ratios.y * (box.maxY - box.minY));
    }

    function resetLook() {
      root.style.setProperty('--lulu-look-x', '0px');
      root.style.setProperty('--lulu-look-y', '0px');
      root.style.setProperty('--lulu-look-r', '0deg');
    }

    function finishPointer(event, cancelled = false) {
      if (!pointer || (event.pointerId != null && event.pointerId !== pointer.id)) return;
      const current = pointer;
      pointer = null;
      root.classList.remove('is-dragging');
      if (launcher.hasPointerCapture?.(current.id)) launcher.releasePointerCapture(current.id);
      if (cancelled) {
        suppressClickUntil = performance.now() + 700;
        setPosition(current.originX, current.originY);
        return;
      }
      if (current.dragging) {
        suppressClickUntil = performance.now() + 700;
        const box = bounds();
        let x = state.x;
        if (x - box.minX < 28) x = box.minX;
        if (box.maxX - x < 28) x = box.maxX;
        setPosition(x, state.y);
        save();
        announce('位置已记住。按 Enter 打开仓库。');
      }
    }

    launcher.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || pointer) return;
      // A new intentional click works even immediately after a completed drag.
      suppressClickUntil = 0;
      launcher.focus({ preventScroll: true });
      pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, originX: state.x, originY: state.y, dragging: false, threshold: event.pointerType === 'touch' ? 10 : 6 };
      launcher.setPointerCapture(event.pointerId);
    }, { signal });

    launcher.addEventListener('pointermove', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.startX;
      const dy = event.clientY - pointer.startY;
      if (!pointer.dragging && Math.hypot(dx, dy) >= pointer.threshold) {
        pointer.dragging = true;
        root.classList.add('is-dragging');
        resetLook();
      }
      if (pointer.dragging) {
        event.preventDefault();
        setPosition(pointer.originX + dx, pointer.originY + dy);
      }
    }, { signal });

    launcher.addEventListener('pointerup', event => finishPointer(event), { signal });
    launcher.addEventListener('pointercancel', event => finishPointer(event, true), { signal });
    launcher.addEventListener('lostpointercapture', event => { if (pointer) finishPointer(event, true); }, { signal });
    launcher.addEventListener('dragstart', event => event.preventDefault(), { signal });
    launcher.addEventListener('click', event => {
      if (performance.now() < suppressClickUntil && event.detail !== 0) {
        suppressClickUntil = 0;
        event.preventDefault();
      }
      // Normal clicks and keyboard Enter retain the anchor's native navigation.
    }, { signal });

    launcher.addEventListener('keydown', event => {
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (moves[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const [dx, dy] = moves[event.key];
        const amount = event.shiftKey ? 36 : 10;
        setPosition(state.x + dx * amount, state.y + dy * amount);
        save();
        announce('位置已移动。按 Enter 打开仓库。');
      } else if (event.key === 'Home' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        state.ratios = { x: 1, y: 1 };
        restorePosition();
        save();
        announce('已回到右下角。');
      }
    }, { signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && pointer) {
        event.preventDefault();
        finishPointer({ pointerId: pointer.id }, true);
      }
    }, { signal });

    function scheduleResize() {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (pointer) finishPointer({ pointerId: pointer.id }, true);
        restorePosition();
      });
    }
    window.addEventListener('resize', scheduleResize, { signal });
    window.visualViewport?.addEventListener('resize', scheduleResize, { signal });
    window.visualViewport?.addEventListener('scroll', scheduleResize, { signal });
    document.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || state.reducedMotion || pointer?.dragging) return;
      followPoint = { x: event.clientX, y: event.clientY };
      if (followFrame) return;
      followFrame = requestAnimationFrame(() => {
        followFrame = 0;
        if (!followPoint || state.reducedMotion || pointer?.dragging) return;
        const rect = launcher.getBoundingClientRect();
        const x = clamp((followPoint.x - rect.left - rect.width / 2) / 150, -1, 1);
        const y = clamp((followPoint.y - rect.top - rect.height / 2) / 180, -1, 1);
        root.style.setProperty('--lulu-look-x', `${(x * 3).toFixed(2)}px`);
        root.style.setProperty('--lulu-look-y', `${(y * 2).toFixed(2)}px`);
        root.style.setProperty('--lulu-look-r', `${(x * 1.4).toFixed(2)}deg`);
      });
    }, { passive: true, signal });
    const onMotion = event => { state.reducedMotion = event.matches; if (state.reducedMotion) resetLook(); };
    motion.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetLook(); }, { signal });

    const api = {
      resetPosition: () => { state.ratios = { x: 1, y: 1 }; restorePosition(); save(); },
      getState: () => ({ x: state.x, y: state.y, dragging: Boolean(pointer?.dragging), reducedMotion: state.reducedMotion, href: launcher.href }),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        if (pointer) finishPointer({ pointerId: pointer.id }, true);
        listeners.abort();
        motion.removeEventListener('change', onMotion);
        cancelAnimationFrame(resizeFrame); cancelAnimationFrame(followFrame);
        clearTimeout(announceTimer);
        root.innerHTML = '';
        root.classList.remove('lulu-assistant', 'is-ready', 'is-dragging');
        root.removeAttribute('style');
        instances.delete(root);
      }
    };
    instances.set(root, api);
    restorePosition();
    save();
    root.classList.add('is-ready');
    return api;
  }

  window.LuluAssistant = { version: '3.0.0', mount, get: element => instances.get(typeof element === 'string' ? document.querySelector(element) : element) };
  const autoMount = () => document.querySelectorAll('[data-lulu]').forEach(element => mount(element));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();
})();
