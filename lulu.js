(() => {
  'use strict';
  if (window.LuluAssistant?.version === '2.0.0') return;

  const instances = new WeakMap();
  let sequence = 0;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const finiteRatio = (value, fallback) => Number.isFinite(value) ? clamp(value, 0, 1) : fallback;

  function mount(element, options = {}) {
    const root = typeof element === 'string' ? document.querySelector(element) : element;
    if (!(root instanceof HTMLElement)) throw new TypeError('LuluAssistant.mount requires an existing element.');
    if (instances.has(root)) return instances.get(root);

    const id = `lulu-${++sequence}`;
    const owner = options.owner || root.dataset.owner || 'Youming';
    const asset = options.asset || root.dataset.asset || 'assets/lulu.webp';
    const projectSelector = options.projects || root.dataset.projects || '#projects';
    const storageKey = options.storageKey || root.dataset.storageKey || `lulu-assistant:v2:${location.pathname}`;
    const bottomOffset = Math.max(0, Number(options.bottomOffset ?? root.dataset.bottomOffset) || 0);
    const listeners = new AbortController();
    const signal = listeners.signal;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const state = { x: 0, y: 0, language: 'zh', collapsed: false, open: false, reducedMotion: motion.matches, ratios: { x: 1, y: 1 } };
    let pointer = null;
    let suppressClickUntil = 0;
    let resizeFrame = 0;
    let followFrame = 0;
    let followPoint = null;
    let announceTimer = 0;
    let hintTimer = 0;
    let destroyed = false;

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved?.version === 2) {
        state.ratios = { x: finiteRatio(saved.x, 1), y: finiteRatio(saved.y, 1) };
        state.collapsed = saved.collapsed === true;
        state.language = saved.language === 'en' ? 'en' : 'zh';
      }
    } catch (_) { /* Storage may be unavailable; the assistant remains usable. */ }

    root.classList.add('lulu-assistant');
    root.classList.toggle('is-collapsed', state.collapsed);
    root.setAttribute('aria-label', '噜噜，页面小伙伴');
    root.innerHTML = `
      <button class="lulu-launcher" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}-panel" aria-describedby="${id}-help">
        <span class="lulu-look"><img class="lulu-image" alt="" draggable="false"><span class="lulu-fallback" hidden aria-hidden="true">噜</span></span>
        <span class="lulu-name" aria-hidden="true">噜噜</span>
        <span class="lulu-hint" aria-hidden="true">拖动我，点一下打招呼</span>
      </button>
      <section class="lulu-panel" id="${id}-panel" role="dialog" aria-modal="false" aria-labelledby="${id}-title" hidden>
        <header class="lulu-panel-header">
          <div><h2 class="lulu-panel-title" id="${id}-title">嗨，我是噜噜</h2><p class="lulu-panel-subtitle">陪你逛逛这个主页</p></div>
          <button class="lulu-close" type="button" aria-label="关闭面板">×</button>
        </header>
        <p class="lulu-greeting" aria-live="polite"></p>
        <button class="lulu-primary" type="button" data-lulu-action="projects">看看项目</button>
        <div class="lulu-secondary-actions">
          <button class="lulu-secondary" type="button" data-lulu-action="language">English greeting</button>
          <button class="lulu-secondary" type="button" data-lulu-action="collapse">收起噜噜</button>
        </div>
      </section>
      <span class="lulu-sr-only" id="${id}-help">可以拖动噜噜。聚焦后用方向键移动，按住 Shift 移动更快，按 Enter 或空格打开面板，按 Escape 关闭。Home 恢复默认位置。</span>
      <span class="lulu-sr-only" data-lulu-status role="status" aria-live="polite"></span>`;

    const launcher = root.querySelector('.lulu-launcher');
    const image = root.querySelector('.lulu-image');
    const fallback = root.querySelector('.lulu-fallback');
    const panel = root.querySelector('.lulu-panel');
    const greeting = root.querySelector('.lulu-greeting');
    const projectsButton = root.querySelector('[data-lulu-action="projects"]');
    const languageButton = root.querySelector('[data-lulu-action="language"]');
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
      return { view, width, height, minX, minY, maxX: Math.max(minX, view.left + view.width - width - margin), maxY: Math.max(minY, view.top + view.height - height - margin - bottomOffset) };
    }

    function updateRatios() {
      const box = bounds();
      state.ratios = {
        x: box.maxX === box.minX ? 0 : (state.x - box.minX) / (box.maxX - box.minX),
        y: box.maxY === box.minY ? 0 : (state.y - box.minY) / (box.maxY - box.minY)
      };
    }

    function save() {
      updateRatios();
      try { localStorage.setItem(storageKey, JSON.stringify({ version: 2, x: state.ratios.x, y: state.ratios.y, collapsed: state.collapsed, language: state.language })); } catch (_) { /* Optional persistence. */ }
    }

    function announce(text) {
      window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => { status.textContent = text; }, 120);
    }

    function positionPanel() {
      if (!state.open) return;
      const box = bounds();
      panel.style.maxWidth = `${Math.max(0, box.view.width - 28)}px`;
      panel.style.maxHeight = `${Math.max(0, box.view.height - 28)}px`;
      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;
      const absLeft = clamp(state.x + box.width / 2 - panelWidth / 2, box.view.left + 14, box.view.left + box.view.width - panelWidth - 14);
      const above = state.y - panelHeight - 12;
      const below = state.y + box.height + 12;
      let absTop = above >= box.view.top + 14 ? above : below;
      absTop = clamp(absTop, box.view.top + 14, box.view.top + box.view.height - panelHeight - 14);
      panel.style.left = `${Math.round(absLeft - state.x)}px`;
      panel.style.top = `${Math.round(absTop - state.y)}px`;
    }

    function setPosition(x, y) {
      const box = bounds();
      state.x = clamp(x, box.minX, box.maxX);
      state.y = clamp(y, box.minY, box.maxY);
      root.dataset.luluSide = state.x + box.width / 2 >= box.view.left + box.view.width / 2 ? 'right' : 'left';
      const hintHeight = root.querySelector('.lulu-hint').offsetHeight;
      const hintBelow = state.y - box.view.top < hintHeight + 19;
      root.toggleAttribute('data-lulu-hint-below', hintBelow);
      root.toggleAttribute('data-lulu-hint-hidden', hintBelow && box.view.top + box.view.height - state.y - box.height < hintHeight + 19);
      root.style.transform = `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0)`;
      positionPanel();
    }

    function restorePosition() {
      const box = bounds();
      setPosition(box.minX + state.ratios.x * (box.maxX - box.minX), box.minY + state.ratios.y * (box.maxY - box.minY));
    }

    function projectTarget() {
      try { return document.querySelector(projectSelector); } catch (_) { return null; }
    }

    function renderText() {
      launcher.setAttribute('aria-label', state.collapsed ? '唤醒噜噜' : '打开噜噜面板，也可以拖动');
      greeting.lang = state.language === 'en' ? 'en' : 'zh-CN';
      greeting.textContent = state.language === 'en'
        ? `Hey, I'm Lulu. Welcome to ${owner}'s homepage! I can take you straight to the projects.`
        : `你好呀，我是噜噜。欢迎来到 ${owner} 的主页！我可以带你直接去看作品。`;
      languageButton.textContent = state.language === 'en' ? '切换中文问候' : 'English greeting';
      languageButton.setAttribute('aria-label', state.language === 'en' ? '切换为中文问候' : '切换为英文问候');
      const available = Boolean(projectTarget());
      projectsButton.disabled = !available;
      projectsButton.textContent = available ? '看看项目' : '项目正在准备中';
      positionPanel();
    }

    function resetLook() {
      root.style.setProperty('--lulu-look-x', '0px');
      root.style.setProperty('--lulu-look-y', '0px');
      root.style.setProperty('--lulu-look-r', '0deg');
    }

    function setCollapsed(value, { focus = false, persist = true } = {}) {
      if (state.collapsed === value) return;
      setOpen(false, { focus: false });
      const before = bounds();
      const centerY = state.y + before.height / 2;
      const right = state.x + before.width / 2 >= before.view.left + before.view.width / 2;
      state.collapsed = value;
      root.classList.toggle('is-collapsed', value);
      const after = bounds();
      setPosition(right ? after.maxX : after.minX, centerY - after.height / 2);
      resetLook();
      renderText();
      if (persist) save();
      if (focus) launcher.focus({ preventScroll: true });
    }

    function setOpen(value, { focus = false } = {}) {
      if (value && state.collapsed) setCollapsed(false);
      state.open = value;
      panel.hidden = !value;
      root.classList.toggle('is-open', value);
      root.classList.remove('has-intro-hint');
      launcher.setAttribute('aria-expanded', String(value));
      if (value) {
        renderText();
        positionPanel();
        if (focus) (projectsButton.disabled ? languageButton : projectsButton).focus({ preventScroll: true });
      } else if (focus) launcher.focus({ preventScroll: true });
    }

    function finishPointer(event, cancelled = false) {
      if (!pointer || (event.pointerId != null && event.pointerId !== pointer.id)) return;
      const current = pointer;
      pointer = null;
      root.classList.remove('is-dragging');
      if (launcher.hasPointerCapture?.(current.id)) launcher.releasePointerCapture(current.id);
      if (cancelled) {
        suppressClickUntil = performance.now() + 500;
        setPosition(current.originX, current.originY);
        return;
      }
      if (current.dragging) {
        suppressClickUntil = performance.now() + 500;
        const box = bounds();
        let x = state.x;
        if (x - box.minX < 28) x = box.minX;
        if (box.maxX - x < 28) x = box.maxX;
        setPosition(x, state.y);
        save();
        announce('噜噜的位置已经记住了。');
      }
    }

    launcher.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || pointer) return;
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
        root.classList.remove('has-intro-hint');
        setOpen(false);
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
        return;
      }
      if (state.collapsed) setCollapsed(false);
      setOpen(!state.open, { focus: event.detail === 0 });
    }, { signal });

    launcher.addEventListener('keydown', event => {
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (moves[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const [dx, dy] = moves[event.key];
        const amount = event.shiftKey ? 36 : 10;
        setPosition(state.x + dx * amount, state.y + dy * amount);
        save();
        announce('噜噜已移动。按 Enter 打开面板。');
      } else if (event.key === 'Home' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        state.ratios = { x: 1, y: 1 };
        restorePosition();
        save();
        announce('噜噜回到右下角了。');
      }
    }, { signal });

    root.querySelector('.lulu-close').addEventListener('click', () => setOpen(false, { focus: true }), { signal });
    root.querySelector('[data-lulu-action="collapse"]').addEventListener('click', () => {
      setCollapsed(true, { focus: true });
      announce('噜噜已收起，点一下就能唤醒。');
    }, { signal });
    languageButton.addEventListener('click', () => {
      state.language = state.language === 'zh' ? 'en' : 'zh';
      renderText();
      save();
    }, { signal });
    projectsButton.addEventListener('click', () => {
      const target = projectTarget();
      if (!target) { renderText(); return; }
      setOpen(false);
      target.scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth', block: 'start' });
      const hadTabIndex = target.hasAttribute('tabindex');
      if (!hadTabIndex) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true, signal });
      }
      target.focus({ preventScroll: true });
      announce('带你来看作品啦。');
      root.dispatchEvent(new CustomEvent('lulu:navigate', { bubbles: true, detail: { target: projectSelector } }));
    }, { signal });

    document.addEventListener('pointerdown', event => {
      if (state.open && !event.composedPath().includes(root)) setOpen(false);
    }, { signal });
    document.addEventListener('focusin', event => {
      if (state.open && !root.contains(event.target)) setOpen(false);
    }, { signal });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (pointer) { event.preventDefault(); finishPointer({ pointerId: pointer.id }, true); }
      else if (state.open && root.contains(document.activeElement)) { event.preventDefault(); setOpen(false, { focus: true }); }
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
      if (event.pointerType !== 'mouse' || state.reducedMotion || state.collapsed || pointer?.dragging) return;
      followPoint = { x: event.clientX, y: event.clientY };
      if (followFrame) return;
      followFrame = requestAnimationFrame(() => {
        followFrame = 0;
        if (!followPoint || state.reducedMotion || state.collapsed || pointer?.dragging) return;
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
      open: () => setOpen(true, { focus: true }),
      close: () => setOpen(false),
      collapse: () => setCollapsed(true),
      show: () => setCollapsed(false),
      resetPosition: () => { state.ratios = { x: 1, y: 1 }; restorePosition(); save(); },
      getState: () => ({ x: state.x, y: state.y, language: state.language, collapsed: state.collapsed, open: state.open, dragging: Boolean(pointer?.dragging), reducedMotion: state.reducedMotion }),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        if (pointer) finishPointer({ pointerId: pointer.id }, true);
        listeners.abort();
        motion.removeEventListener('change', onMotion);
        cancelAnimationFrame(resizeFrame); cancelAnimationFrame(followFrame);
        clearTimeout(announceTimer); clearTimeout(hintTimer);
        root.innerHTML = '';
        root.classList.remove('lulu-assistant', 'is-ready', 'is-open', 'is-collapsed', 'is-dragging', 'has-intro-hint');
        root.removeAttribute('style'); root.removeAttribute('aria-label'); root.removeAttribute('data-lulu-side'); root.removeAttribute('data-lulu-hint-below'); root.removeAttribute('data-lulu-hint-hidden');
        instances.delete(root);
      }
    };
    instances.set(root, api);
    renderText();
    restorePosition();
    root.classList.add('is-ready');
    if (!state.collapsed) {
      root.classList.add('has-intro-hint');
      hintTimer = window.setTimeout(() => root.classList.remove('has-intro-hint'), 3500);
    }
    return api;
  }

  window.LuluAssistant = { version: '2.0.0', mount, get: element => instances.get(typeof element === 'string' ? document.querySelector(element) : element) };
  const autoMount = () => document.querySelectorAll('[data-lulu]').forEach(element => mount(element));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();
})();
