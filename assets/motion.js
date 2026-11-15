/* Motion for Mirai. Honors prefers-reduced-motion. */
(function () {
  "use strict";

  var reduce = false;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  var lenis = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function fmtUsd(n) {
    var abs = Math.abs(n);
    var s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? "−$" : "$") + s;
  }
  function fmtChg(n) {
    var sign = n >= 0 ? "+" : "";
    return sign + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  }

  function initFallbackScroll() {
    var current = window.scrollY || 0;
    var target = current;
    var running = false;
    var stopped = false;
    function maxY() {
      var d = document.documentElement;
      return Math.max(0, d.scrollHeight - d.clientHeight);
    }
    function tick() {
      if (stopped) { running = false; return; }
      running = true;
      current += (target - current) * 0.14;
      if (Math.abs(target - current) < 0.35) current = target;
      window.scrollTo(0, current);
      if (current !== target) requestAnimationFrame(tick);
      else running = false;
    }
    window.addEventListener("wheel", function (e) {
      if (stopped || e.ctrlKey || e.defaultPrevented) return;
      if (e.target && e.target.closest && e.target.closest("[data-lenis-prevent], .modal")) return;
      e.preventDefault();
      target = Math.max(0, Math.min(maxY(), target + e.deltaY * 1.05));
      if (!running) requestAnimationFrame(tick);
    }, { passive: false });
    window.addEventListener("scroll", function () {
      if (!running) {
        current = window.scrollY || 0;
        target = current;
      }
    }, { passive: true });
    lenis = {
      isFallback: true,
      stop: function () { stopped = true; },
      start: function () { stopped = false; current = window.scrollY || 0; target = current; },
      scrollTo: function (el, opts) {
        var off = (opts && opts.offset) || 0;
        var top = el.getBoundingClientRect().top + (window.scrollY || 0) + off;
        target = Math.max(0, Math.min(maxY(), top));
        if (!running) requestAnimationFrame(tick);
      },
      on: function () {},
      raf: function () {}
    };
    document.documentElement.classList.add("has-smooth");
  }

  function initSmoothScroll(LenisCtor) {
    if (reduce) return;
    if (typeof LenisCtor !== "function") {
      initFallbackScroll();
      return;
    }
    lenis = new LenisCtor({
      duration: 1.15,
      easing: function (t) {
        return 1 - Math.pow(1 - t, 3);
      },
      smoothWheel: true,
      wheelMultiplier: 0.9
    });
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
    document.documentElement.classList.add("has-lenis");

    $all('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (a.getAttribute("aria-disabled") === "true") {
          e.preventDefault();
          return;
        }
        var id = a.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -72 });
      });
    });

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-open-wallet]")) {
        if (lenis) lenis.stop();
      }
    });
    var modal = $("#walletModal");
    if (modal) {
      var resume = function () { if (lenis) lenis.start(); };
      var closer = $("#walletClose");
      var veil = modal.querySelector(".veil");
      if (closer) closer.addEventListener("click", resume);
      if (veil) veil.addEventListener("click", resume);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") resume();
      });
    }
  }

  function initReveals() {
    var blocks = $all(
      "#markets, #desk, #compare, #privacy, #steps, #liquidity, #faq, #liveBar, .colophon, .session-note"
    );
    blocks.forEach(function (el) {
      el.classList.add("reveal");
    });
    $all(".panel, .compare-card, .step, .faq details, .risk, .ledger-wrap").forEach(function (el, i) {
      el.classList.add("reveal-child");
      el.style.setProperty("--stagger", String((i % 6) * 70) + "ms");
    });
    $all(".step").forEach(function (el, i) {
      el.style.setProperty("--stagger", String(i * 120) + "ms");
    });

    if (reduce) {
      $all(".reveal, .reveal-child").forEach(function (el) {
        el.classList.add("is-in");
      });
      return;
    }

    if (!("IntersectionObserver" in window)) {
      $all(".reveal, .reveal-child").forEach(function (el) { el.classList.add("is-in"); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        if (entry.target.id === "steps") {
          $all(".step").forEach(function (step) { step.classList.add("is-in"); });
        }
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    $all(".reveal, .reveal-child").forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < (window.innerHeight || 800) * 0.92 && r.bottom > 0) {
        el.classList.add("is-in");
      } else {
        io.observe(el);
      }
    });
  }

  function initParallax() {
    var nodes = $all(".parallax");
    if (reduce || !nodes.length) return;

    var ticking = false;
    function paint() {
      ticking = false;
      var vh = window.innerHeight || 800;
      nodes.forEach(function (el) {
        var speed = parseFloat(el.getAttribute("data-speed") || "0.1");
        var rect = el.getBoundingClientRect();
        var mid = rect.top + rect.height / 2 - vh / 2;
        el.style.transform = "translate3d(0," + (mid * speed * -0.2) + "px,0)";
      });
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(paint);
      }
    }
    if (lenis && !lenis.isFallback && typeof lenis.on === "function") lenis.on("scroll", onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    paint();
  }

  function initProgress() {
    var bar = $("#scrollProgress");
    if (!bar) return;
    function update() {
      var doc = document.documentElement;
      var max = Math.max(1, doc.scrollHeight - doc.clientHeight);
      var y = window.scrollY || doc.scrollTop || 0;
      bar.style.width = Math.min(100, Math.max(0, (y / max) * 100)) + "%";
    }
    if (lenis && !lenis.isFallback && typeof lenis.on === "function") lenis.on("scroll", update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  function initAtmosphere() {
    var canvas = $("#atmosphere");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var dpr = 1;
    var w = 0;
    var h = 0;
    var particles = [];
    var raf = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth || 1200;
      h = window.innerHeight || 800;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.min(80, Math.max(24, Math.floor((w * h) / 22000)));
      particles = [];
      for (var i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.4 + 0.3,
          s: Math.random() * 0.28 + 0.04,
          c: Math.random() > 0.72 ? "rgba(255,46,77,0.42)" : "rgba(60,239,255,0.38)"
        });
      }
    }

    function drawGrid() {
      var vpX = w * 0.5;
      var vpY = h * 0.22;
      var horizon = h * 0.46;
      ctx.strokeStyle = "rgba(60,239,255,0.07)";
      ctx.lineWidth = 1;
      var rows = 16;
      var i;
      for (i = 0; i <= rows; i++) {
        var t = i / rows;
        t = t * t;
        var y = horizon + t * (h - horizon);
        var span = 0.2 + t * 1.15;
        ctx.beginPath();
        ctx.moveTo(vpX - (w * span) / 2, y);
        ctx.lineTo(vpX + (w * span) / 2, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(139,108,255,0.08)";
      for (i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(vpX + i * 10, vpY);
        ctx.lineTo(vpX + i * (w / 9), h + 40);
        ctx.stroke();
      }
    }

    function paint(move) {
      ctx.clearRect(0, 0, w, h);
      drawGrid();
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (move) {
          p.y -= p.s;
          if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        }
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    resize();
    window.addEventListener("resize", function () {
      resize();
      if (reduce) paint(false);
    });
    if (reduce) {
      paint(false);
      return;
    }
    function tick() {
      paint(true);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
  }

  function tickerHTML(quotes) {
    var symbols = ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"];
    var parts = symbols.map(function (sym) {
      var q = quotes[sym];
      if (!q) return "<span class=\"tick\">" + sym + "  …</span>";
      var dir = q.change >= 0 ? "chg-up" : "chg-down";
      return (
        "<span class=\"tick\">" +
        "<b>" + sym + "</b>  " + fmtUsd(q.price) +
        "  <span class=\"" + dir + "\">" + fmtChg(q.change) + "</span>" +
        "</span>"
      );
    });
    var unit = parts.join("<span class=\"tick-sep\" aria-hidden=\"true\">·</span>");
    return unit + "<span class=\"tick-sep\" aria-hidden=\"true\">·</span>";
  }

  function updateTicker(quotes) {
    var track = $("#tickerTrack");
    if (!track) return;
    var unit = tickerHTML(quotes || {});
    track.innerHTML = unit + unit + unit + unit;
  }

  var priceTimers = {};
  function flashPrices(prev, next) {
    if (!next) return;
    Object.keys(next).forEach(function (sym) {
      var cell = document.querySelector('.px-cell[data-symbol="' + sym + '"]');
      if (!cell) return;
      var to = next[sym].price;
      var from = prev && prev[sym] ? prev[sym].price : to;
      cell.setAttribute("data-price", String(to));
      if (reduce || !prev || !prev[sym] || from === to) {
        cell.textContent = fmtUsd(to);
        return;
      }
      var dir = to > from ? "flash-up" : "flash-down";
      cell.classList.remove("flash-up", "flash-down");
      void cell.offsetWidth;
      cell.classList.add(dir);
      if (priceTimers[sym]) cancelAnimationFrame(priceTimers[sym]);
      var start = performance.now();
      var dur = 650;
      function tick(now) {
        var t = Math.min(1, (now - start) / dur);
        var eased = 1 - Math.pow(1 - t, 3);
        cell.textContent = fmtUsd(from + (to - from) * eased);
        if (t < 1) priceTimers[sym] = requestAnimationFrame(tick);
        else {
          cell.textContent = fmtUsd(to);
          setTimeout(function () { cell.classList.remove("flash-up", "flash-down"); }, 700);
        }
      }
      priceTimers[sym] = requestAnimationFrame(tick);
    });
  }

  function boot(LenisCtor) {
    document.documentElement.classList.add(reduce ? "reduce-motion" : "motion-on");
    document.body.classList.add("is-ready");
    initAtmosphere();
    initSmoothScroll(LenisCtor || null);
    initReveals();
    initParallax();
    initProgress();
    updateTicker({});
  }

  function start(LenisCtor) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { boot(LenisCtor); });
    } else {
      boot(LenisCtor);
    }
  }

  if (reduce) {
    start(null);
  } else {
    import("https://cdn.jsdelivr.net/npm/lenis@1.3.11/dist/lenis.mjs")
      .then(function (mod) { start(mod && (mod.default || mod.Lenis || mod)); })
      .catch(function () { start(null); });
  }

  window.MiraiMotion = {
    onQuotes: function (quotes, prev) {
      updateTicker(quotes);
      flashPrices(prev, quotes);
    },
    reduced: reduce
  };
})();
