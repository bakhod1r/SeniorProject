/* ================================================================
   Senior Stack — Reading-Comfort Pack
   Ten features in one IIFE:
     F1 progress bar (top)       F6 bionic reading
     F2 read-time (per-article)  F7 scroll-position save
     F3 focus mode (F key)       F8 reading-width toggle
     F4 sepia palette (CSS only) F9 auto-hide header
     F5 mark-as-read             F10 per-section read stats

   Conventions reused: window.document$.subscribe, sp- localStorage
   prefix, .sp-* BEM classes, INPUT/TEXTAREA keyboard guard.
   ================================================================ */
(function () {
  "use strict";

  // ---------- Storage helpers -----------------------------------
  const K = {
    focus:     "sp-focus-mode",
    bionic:    "sp-bionic",
    autohide:  "sp-autohide",
    readSet:   "sp-read-set",
    readWidth: "sp-read-width",
    readFont:  "sp-reading-font",
    readBg:    "sp-reading-bg",
    scroll:    "sp-scroll:",   // prefix
  };

  // Selectable reading typefaces — the site's own Intel One Mono plus a
  // curated "top 10" of popular reading faces. Google-hosted fonts are
  // lazy-loaded only when the reader actually picks them, so the default
  // experience stays request-free. Code/`pre` always stay monospace (CSS).
  const MONO_STACK = '"Intel One Mono", ui-monospace, "SF Mono", Menlo, monospace';
  const FONTS = [
    { id: "mono",        label: "Mono · Intel One Mono", stack: MONO_STACK },
    { id: "inter",       label: "Inter",        stack: '"Inter", system-ui, sans-serif',            google: "Inter:wght@400;500;700" },
    { id: "roboto",      label: "Roboto",       stack: '"Roboto", system-ui, sans-serif',           google: "Roboto:wght@400;500;700" },
    { id: "opensans",    label: "Open Sans",    stack: '"Open Sans", system-ui, sans-serif',        google: "Open+Sans:wght@400;600;700" },
    { id: "lato",        label: "Lato",         stack: '"Lato", system-ui, sans-serif',             google: "Lato:wght@400;700" },
    { id: "sourcesans",  label: "Source Sans",  stack: '"Source Sans 3", system-ui, sans-serif',    google: "Source+Sans+3:wght@400;600;700" },
    { id: "nunito",      label: "Nunito Sans",  stack: '"Nunito Sans", system-ui, sans-serif',      google: "Nunito+Sans:wght@400;600;700" },
    { id: "merriweather",label: "Merriweather", stack: '"Merriweather", Georgia, serif',            google: "Merriweather:wght@400;700" },
    { id: "lora",        label: "Lora",         stack: '"Lora", Georgia, serif',                    google: "Lora:wght@400;600;700" },
    { id: "georgia",     label: "Georgia",      stack: 'Georgia, "Times New Roman", serif' },
    { id: "jetbrains",   label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, monospace', google: "JetBrains+Mono:wght@400;700" },
  ];
  const DEFAULT_FONT = "mono";

  // Selectable page backgrounds — stay within the dark family so the
  // theme's element backgrounds (tables, code, blockquotes) keep working.
  // Applied as `data-sp-bg` on <html>; CSS lives in reading.css.
  const BACKGROUNDS = [
    { id: "default", label: "Default", swatch: "#0a0a0c" },
    { id: "black",   label: "Black",   swatch: "#000000" },
    { id: "warm",    label: "Warm",    swatch: "#14120d" },
    { id: "ocean",   label: "Ocean",   swatch: "#0b1622" },
  ];
  const DEFAULT_BG = "default";

  function fontById(id) {
    for (let i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i];
    return FONTS[0];
  }

  // Inject a Google Fonts <link> once per family, on demand.
  const loadedFonts = {};
  function ensureFontLoaded(font) {
    if (!font || !font.google || loadedFonts[font.id]) return;
    loadedFonts[font.id] = true;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + font.google + "&display=swap";
    document.head.appendChild(link);
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function isHome() {
    return !!document.querySelector("[data-home]");
  }

  // ---------- F1: Reading progress bar --------------------------
  let progressBar = null;
  let progressTicking = false;

  function ensureProgressBar() {
    if (progressBar && document.body.contains(progressBar)) return progressBar;
    progressBar = document.createElement("div");
    progressBar.className = "sp-progress";
    progressBar.setAttribute("role", "progressbar");
    progressBar.setAttribute("aria-label", "Reading progress");
    progressBar.setAttribute("aria-valuemin", "0");
    progressBar.setAttribute("aria-valuemax", "100");
    document.body.appendChild(progressBar);
    return progressBar;
  }

  function updateProgress() {
    progressTicking = false;
    if (!progressBar) return;
    const h = document.documentElement;
    const max = h.scrollHeight - window.innerHeight;
    if (max <= 0) { progressBar.style.transform = "scaleX(0)"; return; }
    const pct = Math.max(0, Math.min(1, h.scrollTop / max));
    progressBar.style.transform = "scaleX(" + pct + ")";
    progressBar.setAttribute("aria-valuenow", String(Math.round(pct * 100)));
  }

  function onProgressScroll() {
    if (progressTicking) return;
    progressTicking = true;
    requestAnimationFrame(updateProgress);
  }

  function initProgressBar() {
    if (isHome()) {
      if (progressBar) progressBar.style.display = "none";
      return;
    }
    ensureProgressBar();
    progressBar.style.display = "";
    updateProgress();
  }

  // ---------- F2: Estimated read time ---------------------------
  const READ_TIME_CLASS = "sp-readtime";
  const WPM = 200;

  function countWords(root) {
    const SKIP = new Set(["PRE", "CODE", "SCRIPT", "STYLE"]);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        let p = node.parentNode;
        while (p && p !== root) {
          if (SKIP.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
          if (p.classList && (p.classList.contains("mermaid") ||
                              p.classList.contains("sp-report") ||
                              p.classList.contains("sp-readtime"))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n = 0;
    while (walker.nextNode()) {
      const txt = walker.currentNode.nodeValue;
      if (!txt) continue;
      const parts = txt.split(/\s+/);
      for (let i = 0; i < parts.length; i++) if (parts[i]) n++;
    }
    return n;
  }

  function injectReadTime() {
    if (isHome()) return;
    const content = document.querySelector(".md-content__inner");
    if (!content) return;
    if (content.querySelector("." + READ_TIME_CLASS)) return;
    const typeset = content.querySelector(".md-typeset") || content;
    const words = countWords(typeset);
    if (words < 100) return;
    const mins = Math.max(1, Math.ceil(words / WPM));
    const p = document.createElement("p");
    p.className = READ_TIME_CLASS;
    p.textContent =
      "≈ " + mins + " min read · " +
      words.toLocaleString("en-US") + " words";
    const h1 = typeset.querySelector("h1");
    if (h1 && h1.parentNode === typeset) {
      h1.insertAdjacentElement("afterend", p);
    } else {
      typeset.insertBefore(p, typeset.firstChild);
    }
  }

  // ---------- F3: Focus mode ------------------------------------
  function applyFocus(on) {
    if (on) document.documentElement.setAttribute("data-focus", "1");
    else document.documentElement.removeAttribute("data-focus");
    const cb = document.querySelector('.sp-reader-panel input[data-toggle="focus"]');
    if (cb) cb.checked = !!on;
  }
  function isFocusOn() {
    return document.documentElement.getAttribute("data-focus") === "1";
  }
  function toggleFocus() {
    const next = !isFocusOn();
    lsSet(K.focus, next ? "on" : "off");
    applyFocus(next);
    if (next && panelEl && !panelEl.hidden) {
      panelEl.hidden = true;
      if (panelToggleEl) panelToggleEl.setAttribute("aria-expanded", "false");
    }
  }

  // ---------- F5: Mark-as-read ----------------------------------
  function readSet() {
    const arr = readJSON(K.readSet, []);
    return new Set(Array.isArray(arr) ? arr : []);
  }
  function writeReadSet(set) {
    writeJSON(K.readSet, Array.from(set));
  }
  function currentPath() {
    return location.pathname.replace(/\/+$/, "/") || "/";
  }
  function isPageRead(set) {
    return set.has(currentPath());
  }
  function setPageRead(on) {
    const set = readSet();
    const path = currentPath();
    if (on) set.add(path); else set.delete(path);
    writeReadSet(set);
    markSidebar();
    refreshAllStats();
    const cb = document.querySelector('.sp-reader-panel input[data-toggle="read"]');
    if (cb) cb.checked = on;
  }
  function markSidebar() {
    const set = readSet();
    const links = document.querySelectorAll(".md-sidebar--primary .md-nav__link[href]");
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      let pathname;
      try {
        pathname = new URL(a.getAttribute("href"), location.href).pathname.replace(/\/+$/, "/") || "/";
      } catch (e) { continue; }
      if (set.has(pathname)) a.classList.add("sp-read");
      else a.classList.remove("sp-read");
    }
  }

  // ---------- F6: Bionic reading --------------------------------
  const BIONIC_CLASS = "sp-bionic-fix";
  const BIONIC_CHAR_LIMIT = 50000;

  function applyBionicAttr(on) {
    if (on) document.documentElement.setAttribute("data-bionic", "1");
    else document.documentElement.removeAttribute("data-bionic");
    const cb = document.querySelector('.sp-reader-panel input[data-toggle="bionic"]');
    if (cb) cb.checked = !!on;
  }
  function isBionicOn() {
    return document.documentElement.getAttribute("data-bionic") === "1";
  }
  function bionicifyWord(word) {
    if (!word || word.length < 2) return null;
    const n = Math.min(4, Math.ceil(word.length / 2));
    return { head: word.slice(0, n), tail: word.slice(n) };
  }
  function bionicifyTextNode(node) {
    const txt = node.nodeValue;
    if (!txt || !/\S/.test(txt)) return;
    const frag = document.createDocumentFragment();
    const parts = txt.split(/(\s+)/);
    let changed = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
      const split = bionicifyWord(part);
      if (split) {
        const b = document.createElement("b");
        b.className = BIONIC_CLASS;
        b.textContent = split.head;
        frag.appendChild(b);
        if (split.tail) frag.appendChild(document.createTextNode(split.tail));
        changed = true;
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    if (changed && node.parentNode) node.parentNode.replaceChild(frag, node);
  }
  function bionicifyContent() {
    const root = document.querySelector(".md-content .md-typeset");
    if (!root) return;
    if (root.textContent.length > BIONIC_CHAR_LIMIT) return;
    const SKIP = new Set(["PRE", "CODE", "SCRIPT", "STYLE", "A", "B", "STRONG", "H1"]);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        let p = node.parentNode;
        while (p && p !== root) {
          if (SKIP.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
          if (p.classList && (p.classList.contains("mermaid") ||
                              p.classList.contains("sp-report") ||
                              p.classList.contains("sp-readtime") ||
                              p.classList.contains(BIONIC_CLASS))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    for (let i = 0; i < targets.length; i++) bionicifyTextNode(targets[i]);
  }
  function unbionicifyContent() {
    const fixes = document.querySelectorAll("." + BIONIC_CLASS);
    for (let i = 0; i < fixes.length; i++) {
      const b = fixes[i];
      const parent = b.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(b.textContent), b);
      parent.normalize();
    }
  }
  function refreshBionic() {
    unbionicifyContent();
    if (isBionicOn()) bionicifyContent();
  }
  function toggleBionic() {
    const next = !isBionicOn();
    lsSet(K.bionic, next ? "on" : "off");
    applyBionicAttr(next);
    refreshBionic();
  }

  // ---------- F7: Scroll position save --------------------------
  const SCROLL_THRESHOLD = 200;
  let scrollSaveTimer = null;
  const restoredPaths = new Set();
  let lastSavedPath = null;
  let lastSavedScroll = 0;

  function scrollKey() { return K.scroll + currentPath(); }

  function saveScroll() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    if (y < SCROLL_THRESHOLD) {
      lsSet(scrollKey(), "");
      return;
    }
    lsSet(scrollKey(), String(Math.round(y)));
  }

  function onScrollSave() {
    if (scrollSaveTimer) return;
    scrollSaveTimer = setTimeout(function () {
      scrollSaveTimer = null;
      saveScroll();
    }, 400);
  }

  function maybeRestoreScroll() {
    if (isHome()) return;
    const path = currentPath();
    if (restoredPaths.has(path)) return;
    restoredPaths.add(path);
    if (location.hash) return;
    const raw = lsGet(scrollKey());
    if (!raw) return;
    const y = parseInt(raw, 10);
    if (isNaN(y) || y < SCROLL_THRESHOLD) return;
    setTimeout(function () {
      window.scrollTo({ top: y, behavior: "auto" });
    }, 50);
  }

  // ---------- F8: Reading width ---------------------------------
  function applyReadWidth(value) {
    const v = (value === "60ch" || value === "75ch" || value === "90ch") ? value : "none";
    document.documentElement.style.setProperty("--sp-read-width", v);
    const btns = document.querySelectorAll(".sp-reader-panel__btns button[data-width]");
    for (let i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-width") === v ? "true" : "false");
    }
  }
  function setReadWidth(v) {
    lsSet(K.readWidth, v);
    applyReadWidth(v);
  }

  // ---------- Reading font (typeface switch) --------------------
  function applyReadingFont(value) {
    const font = fontById(value);
    const html = document.documentElement;
    if (font.id === DEFAULT_FONT) {
      html.removeAttribute("data-sp-font");
      html.style.removeProperty("--sp-reading-font-stack");
    } else {
      ensureFontLoaded(font);
      html.setAttribute("data-sp-font", font.id);
      html.style.setProperty("--sp-reading-font-stack", font.stack);
    }
    const sel = document.querySelector(".sp-reader-panel select[data-font-select]");
    if (sel && sel.value !== font.id) sel.value = font.id;
  }
  function setReadingFont(v) {
    lsSet(K.readFont, v);
    applyReadingFont(v);
  }

  // ---------- Reading background (page tint) --------------------
  function applyReadingBg(value) {
    const html = document.documentElement;
    const id = (value && BACKGROUNDS.some(function (b) { return b.id === value; }))
      ? value : DEFAULT_BG;
    if (id === DEFAULT_BG) html.removeAttribute("data-sp-bg");
    else html.setAttribute("data-sp-bg", id);
    const btns = document.querySelectorAll(".sp-bg-swatches button[data-bg]");
    for (let i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-bg") === id ? "true" : "false");
    }
  }
  function setReadingBg(v) {
    lsSet(K.readBg, v);
    applyReadingBg(v);
  }

  // ---------- F9: Auto-hide header ------------------------------
  let lastScrollY = 0;
  let autoHideAttached = false;

  function applyAutoHideAttr(on) {
    if (on) document.documentElement.setAttribute("data-autohide", "1");
    else {
      document.documentElement.removeAttribute("data-autohide");
      document.documentElement.classList.remove("sp-nav-hidden");
    }
    const cb = document.querySelector('.sp-reader-panel input[data-toggle="autohide"]');
    if (cb) cb.checked = !!on;
  }
  function isAutoHideOn() {
    return document.documentElement.getAttribute("data-autohide") === "1";
  }
  function onAutoHideScroll() {
    if (!isAutoHideOn()) return;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const html = document.documentElement;
    if (y > lastScrollY + 8 && y > 60) {
      html.classList.add("sp-nav-hidden");
    } else if (y < lastScrollY - 4) {
      html.classList.remove("sp-nav-hidden");
    }
    lastScrollY = y;
  }
  function toggleAutoHide() {
    const next = !isAutoHideOn();
    lsSet(K.autohide, next ? "on" : "off");
    applyAutoHideAttr(next);
  }

  // ---------- F10: Per-section read stats -----------------------
  // Manifest is fetched once per origin from the URL declared by the
  // <link id="sp-read-manifest"> tag in <head>. Browsers cache the
  // response, so subsequent page navigations don't re-download or re-parse.
  let manifestPromise = null;
  function loadManifest() {
    if (manifestPromise) return manifestPromise;
    const link = document.getElementById("sp-read-manifest");
    const href = link && link.getAttribute("href");
    if (!href) {
      manifestPromise = Promise.resolve(null);
      return manifestPromise;
    }
    manifestPromise = fetch(href, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        return m && Array.isArray(m.sections) ? m : null;
      })
      .catch(function () { return null; });
    return manifestPromise;
  }

  function computeStats(set, manifest) {
    const m = manifest;
    if (!m) return null;
    const out = [];
    let oRead = 0, oTotal = 0;
    for (let i = 0; i < m.sections.length; i++) {
      const s = m.sections[i];
      const paths = s.paths || [];
      let read = 0;
      for (let j = 0; j < paths.length; j++) if (set.has(paths[j])) read++;
      const total = paths.length;
      const pct = total > 0 ? Math.round((read / total) * 100) : 0;
      out.push({ key: s.key, label: s.label, read: read, total: total, pct: pct });
      oRead += read;
      oTotal += total;
    }
    return {
      overall: {
        read: oRead,
        total: oTotal,
        pct: oTotal > 0 ? Math.round((oRead / oTotal) * 100) : 0,
      },
      sections: out,
    };
  }

  function sidebarLabelText(link) {
    const ellipsis = link.querySelector(".md-ellipsis");
    return ((ellipsis ? ellipsis.textContent : link.textContent) || "").trim();
  }
  function renderSidebarSectionStats(stats) {
    if (!stats) return;
    const sidebar = document.querySelector(".md-sidebar--primary");
    if (!sidebar) return;
    const prior = sidebar.querySelectorAll(".sp-sec-stat");
    for (let i = 0; i < prior.length; i++) prior[i].remove();
    const byKey = {}, byLabel = {};
    for (let i = 0; i < stats.sections.length; i++) {
      const s = stats.sections[i];
      byKey[s.key] = s;
      byLabel[s.label] = s;
    }
    const items = sidebar.querySelectorAll(".md-nav--primary > ul.md-nav__list > li.md-nav__item");
    for (let i = 0; i < items.length; i++) {
      const li = items[i];
      let lbl = null;
      const kids = li.children;
      for (let j = 0; j < kids.length; j++) {
        if (kids[j].classList && kids[j].classList.contains("md-nav__link")) {
          lbl = kids[j];
          break;
        }
      }
      if (!lbl) continue;
      const text = sidebarLabelText(lbl);
      const st = byKey[text] || byLabel[text];
      if (!st) continue;
      const span = document.createElement("span");
      span.className = "sp-sec-stat";
      span.textContent = st.read + "/" + st.total + " · " + st.pct + "%";
      const icon = lbl.querySelector(".md-nav__icon");
      if (icon && icon.parentNode === lbl) lbl.insertBefore(span, icon);
      else lbl.appendChild(span);
    }
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function renderHomeStatsCard(stats) {
    if (!stats) return;
    const slot = document.querySelector("[data-sp-home-stats]");
    if (!slot) return;
    const o = stats.overall;
    if (!o.total) {
      slot.hidden = true;
      slot.innerHTML = "";
      return;
    }
    const sorted = stats.sections.slice().sort(function (a, b) {
      if (b.pct !== a.pct) return b.pct - a.pct;
      return a.label.localeCompare(b.label);
    });
    let html = "";
    html += '<div class="sp-home-stats__head">';
    html +=   '<span class="sp-home-stats__label">// reading progress</span>';
    html +=   '<span class="sp-home-stats__total">' + o.read + " / " + o.total + " pages · <strong>" + o.pct + "%</strong></span>";
    html += '</div>';
    html += '<div class="sp-home-stats__bar"><div class="sp-home-stats__bar-fill" style="width:' + o.pct + '%"></div></div>';
    html += '<ul class="sp-home-stats__sections">';
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      html += '<li>';
      html +=   '<span class="sp-home-stats__sec-label">' + escapeHTML(s.label) + '</span>';
      html +=   '<span class="sp-home-stats__sec-bar"><span style="width:' + s.pct + '%"></span></span>';
      html +=   '<span class="sp-home-stats__sec-count">' + s.read + "/" + s.total + " · " + s.pct + '%</span>';
      html += '</li>';
    }
    html += '</ul>';
    slot.innerHTML = html;
    slot.hidden = false;
  }

  function refreshAllStats() {
    loadManifest().then(function (manifest) {
      const stats = computeStats(readSet(), manifest);
      if (!stats) return;
      renderSidebarSectionStats(stats);
      renderHomeStatsCard(stats);
    });
  }

  // ---------- Reader-settings panel -----------------------------
  let panelEl = null;
  let panelToggleEl = null;

  function buildReaderPanel() {
    if (panelToggleEl && document.body.contains(panelToggleEl)) return;

    let fontOptions = "";
    for (let i = 0; i < FONTS.length; i++) {
      fontOptions += '<option value="' + FONTS[i].id + '">' + escapeHTML(FONTS[i].label) + '</option>';
    }

    let bgButtons = "";
    for (let i = 0; i < BACKGROUNDS.length; i++) {
      const b = BACKGROUNDS[i];
      bgButtons +=
        '<button type="button" class="sp-bg-swatch" data-bg="' + b.id + '" ' +
          'aria-pressed="false" title="' + escapeHTML(b.label) + '" aria-label="' + escapeHTML(b.label) + '" ' +
          'style="background:' + b.swatch + '"></button>';
    }

    panelToggleEl = document.createElement("button");
    panelToggleEl.type = "button";
    panelToggleEl.className = "sp-reader-panel__toggle";
    panelToggleEl.setAttribute("aria-label", "Reader settings");
    panelToggleEl.setAttribute("aria-expanded", "false");
    panelToggleEl.setAttribute("title", "Reader settings");
    panelToggleEl.textContent = "⚙";

    panelEl = document.createElement("div");
    panelEl.className = "sp-reader-panel";
    panelEl.hidden = true;
    panelEl.innerHTML =
      '<h4>Reader settings</h4>' +
      '<section>' +
        '<span>Font size</span>' +
        '<div class="sp-reader-panel__btns sp-fontsize" role="group" aria-label="Adjust font size">' +
          '<button type="button" class="sp-fontsize__btn sp-fontsize__btn--minus" ' +
            'aria-label="Decrease font size" title="Decrease font (Ctrl/Cmd+Shift+-)">A&minus;</button>' +
          '<button type="button" class="sp-fontsize__btn sp-fontsize__btn--reset" ' +
            'aria-label="Reset font size"    title="Reset font (Ctrl/Cmd+Shift+0)">A</button>' +
          '<button type="button" class="sp-fontsize__btn sp-fontsize__btn--plus" ' +
            'aria-label="Increase font size" title="Increase font (Ctrl/Cmd+Shift++)">A+</button>' +
        '</div>' +
      '</section>' +
      '<section>' +
        '<span>Reading width</span>' +
        '<div class="sp-reader-panel__btns">' +
          '<button type="button" data-width="60ch" aria-pressed="false">60</button>' +
          '<button type="button" data-width="75ch" aria-pressed="false">75</button>' +
          '<button type="button" data-width="90ch" aria-pressed="false">90</button>' +
          '<button type="button" data-width="none" aria-pressed="false">∞</button>' +
        '</div>' +
      '</section>' +
      '<section>' +
        '<span>Reading font</span>' +
        '<select class="sp-reader-panel__select" data-font-select aria-label="Reading font">' +
          fontOptions +
        '</select>' +
      '</section>' +
      '<section>' +
        '<span>Background</span>' +
        '<div class="sp-bg-swatches" role="group" aria-label="Page background">' +
          bgButtons +
        '</div>' +
      '</section>' +
      '<label><input type="checkbox" data-toggle="focus"> Focus mode (F)</label>' +
      '<label><input type="checkbox" data-toggle="bionic"> Bionic reading</label>' +
      '<label><input type="checkbox" data-toggle="autohide"> Auto-hide header</label>' +
      '<label><input type="checkbox" data-toggle="eink"> E-ink mode (Shift+E)</label>' +
      '<hr>' +
      '<label><input type="checkbox" data-toggle="read"> Mark this page as read</label>';

    document.body.appendChild(panelToggleEl);
    document.body.appendChild(panelEl);

    panelToggleEl.addEventListener("click", function (e) {
      e.stopPropagation();
      const open = panelEl.hidden;
      panelEl.hidden = !open;
      panelToggleEl.setAttribute("aria-expanded", open ? "true" : "false");
    });

    panelEl.addEventListener("click", function (e) { e.stopPropagation(); });

    document.addEventListener("click", function (e) {
      if (panelEl.hidden) return;
      if (e.target === panelToggleEl) return;
      if (panelEl.contains(e.target)) return;
      panelEl.hidden = true;
      panelToggleEl.setAttribute("aria-expanded", "false");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panelEl.hidden) {
        panelEl.hidden = true;
        panelToggleEl.setAttribute("aria-expanded", "false");
      }
    });

    const widthBtns = panelEl.querySelectorAll(".sp-reader-panel__btns button[data-width]");
    for (let i = 0; i < widthBtns.length; i++) {
      widthBtns[i].addEventListener("click", function () {
        setReadWidth(this.getAttribute("data-width"));
      });
    }

    const fontSelect = panelEl.querySelector("select[data-font-select]");
    if (fontSelect) {
      fontSelect.addEventListener("change", function () {
        setReadingFont(this.value);
      });
    }

    const bgBtns = panelEl.querySelectorAll(".sp-bg-swatches button[data-bg]");
    for (let i = 0; i < bgBtns.length; i++) {
      bgBtns[i].addEventListener("click", function () {
        setReadingBg(this.getAttribute("data-bg"));
      });
    }

    panelEl.querySelector('input[data-toggle="focus"]').addEventListener("change", function () {
      lsSet(K.focus, this.checked ? "on" : "off");
      applyFocus(this.checked);
      if (this.checked) {
        panelEl.hidden = true;
        panelToggleEl.setAttribute("aria-expanded", "false");
      }
    });
    panelEl.querySelector('input[data-toggle="bionic"]').addEventListener("change", function () {
      lsSet(K.bionic, this.checked ? "on" : "off");
      applyBionicAttr(this.checked);
      refreshBionic();
    });
    panelEl.querySelector('input[data-toggle="autohide"]').addEventListener("change", function () {
      lsSet(K.autohide, this.checked ? "on" : "off");
      applyAutoHideAttr(this.checked);
    });
    panelEl.querySelector('input[data-toggle="read"]').addEventListener("change", function () {
      setPageRead(this.checked);
    });

    // Wire up the externally-owned controls injected into the panel:
    // font-size buttons (fontsize.js) and e-ink checkbox (eink.js).
    if (window.SP_FontSize && window.SP_FontSize.bindWidget) {
      window.SP_FontSize.bindWidget();
    }
    if (window.SP_Eink && window.SP_Eink.bindPanel) {
      window.SP_Eink.bindPanel();
    }
  }

  function syncPanelState() {
    if (!panelEl) return;
    const focusCb    = panelEl.querySelector('input[data-toggle="focus"]');
    const bionicCb   = panelEl.querySelector('input[data-toggle="bionic"]');
    const autohideCb = panelEl.querySelector('input[data-toggle="autohide"]');
    const einkCb     = panelEl.querySelector('input[data-toggle="eink"]');
    const readCb     = panelEl.querySelector('input[data-toggle="read"]');
    if (focusCb)    focusCb.checked    = (lsGet(K.focus) === "on");
    if (bionicCb)   bionicCb.checked   = (lsGet(K.bionic) === "on");
    if (autohideCb) autohideCb.checked = (lsGet(K.autohide) === "on");
    if (einkCb)     einkCb.checked     = (document.documentElement.getAttribute("data-eink") === "1");
    if (readCb)     readCb.checked     = isPageRead(readSet());
  }

  // ---------- Body-level listeners (attach once) -----------------
  function attachBodyListeners() {
    window.addEventListener("scroll", onProgressScroll, { passive: true });
    window.addEventListener("scroll", onScrollSave, { passive: true });
    window.addEventListener("scroll", onAutoHideScroll, { passive: true });
    window.addEventListener("resize", onProgressScroll, { passive: true });

    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "f" && e.key !== "F") return;
      const t = e.target;
      const tag = (t && t.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (t && t.isContentEditable) return;
      toggleFocus();
      e.preventDefault();
    });

    autoHideAttached = true;
  }

  // ---------- Per-page init (re-runs on instant nav) ------------
  function initAll() {
    if (!document.body) return;

    buildReaderPanel();

    // F8 — reading width (load + apply before anything else, prevents flicker)
    const storedWidth = lsGet(K.readWidth);
    applyReadWidth(storedWidth || "none");

    // Reading font (load + apply early to prevent flicker)
    applyReadingFont(lsGet(K.readFont) || DEFAULT_FONT);

    // Reading background tint (load + apply early to prevent flicker)
    applyReadingBg(lsGet(K.readBg) || DEFAULT_BG);

    // F3 — focus
    applyFocus(lsGet(K.focus) === "on");

    // F9 — auto-hide
    applyAutoHideAttr(lsGet(K.autohide) === "on");

    // F1 — progress bar
    initProgressBar();

    // F2 — read-time (per page)
    injectReadTime();

    // F5 — mark-as-read sidebar + checkbox
    markSidebar();

    // F10 — per-section read stats (pill + sidebar pills + home card)
    refreshAllStats();

    // F6 — bionic (reapply on each page swap if on)
    applyBionicAttr(lsGet(K.bionic) === "on");
    if (isBionicOn()) bionicifyContent();

    // Panel checkbox sync per-page (the "read" one depends on path)
    syncPanelState();

    // F7 — scroll restore for this path (once per session)
    maybeRestoreScroll();

    if (!autoHideAttached) attachBodyListeners();
  }

  // ---------- Boot ----------------------------------------------
  if (typeof window.document$ !== "undefined" && window.document$.subscribe) {
    window.document$.subscribe(initAll);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
})();
