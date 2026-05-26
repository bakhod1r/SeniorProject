/* ================================================================
   Senior Project — small client-side enhancements
   - Inject "Report a problem" link at the end of every content page
   - Render Mermaid diagrams (Material 9.7 + Mermaid 11 native integration
     is broken — we load Mermaid 10 ourselves and call run())
   - Re-runs on Material's instant navigation (document$)
   ================================================================ */
(function () {
  const REPO = "bakhod1r/SeniorProject";
  const REPORT_CLASS = "sp-report";

  // ---- Mermaid bootstrap ------------------------------------------------
  // pymdownx.superfences with fence_div_format produces <div class="mermaid">
  // containing the diagram source as text. We load Mermaid 10 and call run()
  // on every page (including SPA instant nav).
  let mermaidReady = null;
  function loadMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/mermaid@10/dist/mermaid.min.js";
      s.onload = () => {
        if (typeof mermaid === "undefined") {
          reject(new Error("mermaid global missing after script load"));
          return;
        }
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          themeVariables: {
            background: "#0a0a0a",
            primaryColor: "#0a0a0a",
            primaryTextColor: "#d4d4d4",
            primaryBorderColor: "#39ff7a",
            lineColor: "#39ff7a",
            secondaryColor: "#1a1a1a",
            tertiaryColor: "#0e0e0e",
            fontFamily: "Intel One Mono, ui-monospace, monospace",
          },
        });
        resolve(mermaid);
      };
      s.onerror = () => reject(new Error("failed to load mermaid"));
      document.head.appendChild(s);
    });
    return mermaidReady;
  }

  function fixMermaidSize(block) {
    // Mermaid hard-codes width="100%" + max-width on the SVG, which squashes
    // wide graphs. Use the inline style's max-width as the natural width and
    // set explicit width/height attributes so the parent .mermaid container
    // can scroll horizontally.
    const svg = block.querySelector("svg");
    if (!svg) return;
    const styleMaxW = svg.style.maxWidth;
    if (styleMaxW && styleMaxW.endsWith("px")) {
      const naturalW = parseFloat(styleMaxW);
      const vb = svg.viewBox && svg.viewBox.baseVal;
      const naturalH = vb && vb.height ? naturalW * (vb.height / vb.width) : naturalW;
      svg.setAttribute("width", naturalW);
      svg.setAttribute("height", naturalH);
      svg.style.maxWidth = "none";
    }
  }

  // Render one block at a time on idle callbacks so we never block the main
  // thread for more than one diagram's worth of work. Heavy types (mindmap,
  // sankey, large graph) used to freeze the page when run() was called with
  // all nodes at once, triggering Chrome's "Page Unresponsive" dialog.
  function renderBlock(block) {
    return loadMermaid()
      .then((m) => m.run({ nodes: [block] }))
      .then(() => fixMermaidSize(block))
      .catch((err) => {
        block.style.display = "none";
        console.warn("[sp] mermaid render failed:", err);
      });
  }

  const mermaidQueue = [];
  let mermaidDraining = false;
  function scheduleIdle(fn) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(fn, { timeout: 500 });
    } else {
      setTimeout(fn, 16);
    }
  }
  function drainMermaidQueue() {
    if (mermaidDraining) return;
    mermaidDraining = true;
    const step = () => {
      const next = mermaidQueue.shift();
      if (!next) { mermaidDraining = false; return; }
      renderBlock(next).then(() => scheduleIdle(step));
    };
    scheduleIdle(step);
  }
  function enqueueMermaid(block) {
    if (block.dataset.spMermaidQueued === "1") return;
    block.dataset.spMermaidQueued = "1";
    mermaidQueue.push(block);
    drainMermaidQueue();
  }

  function renderMermaid() {
    // Material's superfences renders mermaid blocks as <pre class="mermaid">
    // or <div class="mermaid">. Skip ones already rendered (have a child SVG)
    // so SPA navigation re-render is idempotent.
    const blocks = Array.from(document.querySelectorAll(".mermaid")).filter(
      (b) => !b.querySelector("svg") && b.textContent.trim().length > 0
    );
    if (blocks.length === 0) return;

    // Lazy-render: only kick off the work when a diagram scrolls near the
    // viewport. The first one is enqueued eagerly so the top-of-page diagram
    // shows up without scrolling.
    if (typeof IntersectionObserver === "undefined") {
      blocks.forEach(enqueueMermaid);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        enqueueMermaid(entry.target);
      });
    }, { rootMargin: "400px 0px" });
    blocks.forEach((b) => io.observe(b));
  }

  function inject() {
    // Skip the home page (it has its own custom footer)
    if (document.querySelector("[data-home]")) return;

    const content = document.querySelector(".md-content__inner");
    if (!content) return;

    // Avoid double-injection on SPA navigation
    if (content.querySelector("." + REPORT_CLASS)) return;

    const url = location.href;
    const title = document.title || "Senior Project";
    const issueTitle = encodeURIComponent("[doc] " + title);
    const issueBody = encodeURIComponent(
      "**Page URL:** " + url + "\n\n" +
      "**Problem description:**\n" +
      "<!-- describe the issue here -->\n\n" +
      "**Expected:**\n\n" +
      "**Actual:**\n"
    );
    const issueUrl =
      "https://github.com/" + REPO +
      "/issues/new?title=" + issueTitle +
      "&body=" + issueBody +
      "&labels=docs";

    const editUrl =
      "https://github.com/" + REPO + "/edit/main/" +
      // best-effort path from URL
      location.pathname.replace(/^\//, "").replace(/\/$/, "/index.md");

    const discussUrl = "https://github.com/" + REPO + "/discussions";

    const wrap = document.createElement("aside");
    wrap.className = REPORT_CLASS;
    wrap.innerHTML =
      '<hr class="sp-report-rule">' +
      '<div class="sp-report-row">' +
        '<span class="sp-report-prompt">$&nbsp;</span>' +
        '<span class="sp-report-text">found a problem on this page?</span>' +
        '<a class="sp-report-link" href="' + issueUrl + '" target="_blank" rel="noopener">' +
          '<span class="sp-report-arrow">&gt;</span>&nbsp;report it' +
        '</a>' +
        '<span class="sp-report-sep">·</span>' +
        '<a class="sp-report-link sp-report-link--soft" href="' + editUrl + '" target="_blank" rel="noopener">' +
          '<span class="sp-report-arrow">&gt;</span>&nbsp;edit on github' +
        '</a>' +
        '<span class="sp-report-sep">·</span>' +
        '<a class="sp-report-link sp-report-link--soft" href="' + discussUrl + '" target="_blank" rel="noopener">' +
          '<span class="sp-report-arrow">&gt;</span>&nbsp;discuss' +
        '</a>' +
      '</div>';
    content.appendChild(wrap);
  }

  function run() {
    inject();
    renderMermaid();
  }

  // Initial run + re-run on Material instant nav
  if (typeof document$ !== "undefined" && document$.subscribe) {
    document$.subscribe(run);
  } else {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }
})();

/* ================================================================
   GA4 custom event tracking
   - 404 pages
   - External (outbound) link clicks
   - Search queries
   - Scroll depth (25/50/75/100)
   - Reading time on page
   Material's built-in google provider loads gtag only after consent.
   We guard every send with a typeof check so nothing fires before then.
   ================================================================ */
(function () {
  function send(name, params) {
    if (typeof gtag !== "function") return;
    gtag("event", name, params || {});
  }

  // ---- 404 tracking ---------------------------------------------------
  function track404() {
    const title = (document.title || "").toLowerCase();
    const looks404 =
      title.includes("404") ||
      document.body.classList.contains("not-found") ||
      !!document.querySelector("[data-404]");
    if (!looks404) return;
    send("page_not_found", {
      page_location: location.href,
      page_referrer: document.referrer || "(direct)",
    });
  }

  // ---- External link tracking ----------------------------------------
  function trackExternalLinks() {
    const host = location.hostname;
    document.body.addEventListener("click", function (e) {
      const a = e.target.closest("a[href]");
      if (!a) return;
      let url;
      try {
        url = new URL(a.href, location.href);
      } catch (_) {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.hostname === host) return;
      send("click_external", {
        link_url: url.href,
        link_domain: url.hostname,
        link_text: (a.innerText || "").trim().slice(0, 100),
      });
    }, { passive: true });
  }

  // ---- Search query tracking -----------------------------------------
  function trackSearch() {
    const input = document.querySelector(".md-search__input");
    if (!input || input.dataset.spTracked === "1") return;
    input.dataset.spTracked = "1";
    let timer = null;
    input.addEventListener("input", function () {
      const q = input.value.trim();
      if (q.length < 3) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        send("search", { search_term: q });
      }, 800);
    });
  }

  // ---- Scroll depth (25 / 50 / 75 / 100) -----------------------------
  function trackScrollDepth() {
    const marks = [25, 50, 75, 100];
    const seen = new Set();
    function onScroll() {
      const h = document.documentElement;
      const scrolled = h.scrollTop + window.innerHeight;
      const total = h.scrollHeight;
      if (total <= window.innerHeight) return;
      const pct = (scrolled / total) * 100;
      for (const m of marks) {
        if (pct >= m && !seen.has(m)) {
          seen.add(m);
          send("scroll_depth", { percent: m });
        }
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---- Reading time on page (sent on unload / nav) -------------------
  function trackReadingTime() {
    const start = Date.now();
    let active = true;
    let total = 0;

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (active) total += Date.now() - start;
        active = false;
      } else {
        active = true;
      }
    });

    function flush() {
      const seconds = Math.round((active ? Date.now() - start : total) / 1000);
      if (seconds < 5 || seconds > 3600) return;
      send("reading_time", {
        seconds: seconds,
        page_path: location.pathname,
      });
    }
    window.addEventListener("beforeunload", flush);
  }

  // ---- Per-navigation hooks (Material instant nav) -------------------
  function onPage() {
    track404();
    trackSearch();
    trackScrollDepth();
    trackReadingTime();
  }

  // Body-level listener once; per-page hooks via document$
  if (typeof document$ !== "undefined" && document$.subscribe) {
    trackExternalLinks();
    document$.subscribe(onPage);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      trackExternalLinks();
      onPage();
    });
  } else {
    trackExternalLinks();
    onPage();
  }
})();

/* ============================================================
   Accessibility patches for Material partials we don't own:
   - search dialog needs an accessible name
   - instant-nav progress bar needs an accessible name
   - cookie-consent h4 jumps heading order from h2 → h4 (no h3)
   ============================================================ */
(() => {
  const patch = () => {
    const search = document.querySelector('[data-md-component="search"][role="dialog"]');
    if (search && !search.hasAttribute('aria-label')) {
      search.setAttribute('aria-label', 'Search');
    }
    const progress = document.querySelector('[data-md-component="progress"][role="progressbar"]');
    if (progress && !progress.hasAttribute('aria-label')) {
      progress.setAttribute('aria-label', 'Page loading progress');
    }
    // Cookie consent uses <h4> directly under H2 nav cards; promote semantically to h3.
    const consentHeading = document.querySelector('#__consent .md-consent__form h4');
    if (consentHeading && !consentHeading.hasAttribute('aria-level')) {
      consentHeading.setAttribute('role', 'heading');
      consentHeading.setAttribute('aria-level', '3');
    }
  };

  if (window.document$ && typeof window.document$.subscribe === 'function') {
    window.document$.subscribe(patch);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patch);
  } else {
    patch();
  }
})();
