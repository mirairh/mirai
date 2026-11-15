/* Mirai desk: live Robinhood Chain token prices (DexScreener) and candles (GeckoTerminal). */

/* Fill these when the profiles exist. Until then the UI shows “soon”. */
var MIRAI_LINKS = { github: "https://github.com/mirairh/mirai", x: "https://x.com/mirairh_" };

(function () {
  "use strict";

  var FEE_RATE = 0.001;
  var MMR = 0.025;
  var REFRESH_MS = 20000;

  var MARKETS = [
    {
      symbol: "TSLA",
      name: "Tesla, Inc.",
      token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
      pool: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3"
    },
    {
      symbol: "AMZN",
      name: "Amazon.com, Inc.",
      token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
      pool: "0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef"
    },
    {
      symbol: "PLTR",
      name: "Palantir Technologies",
      token: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
      pool: "0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623"
    },
    {
      symbol: "NFLX",
      name: "Netflix, Inc.",
      token: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
      pool: "0x59895C0302F41aEaa129D2fa2442CEc01E7eF45E"
    },
    {
      symbol: "AMD",
      name: "Advanced Micro Devices",
      token: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
      pool: "0xde9f85fdd9e05a943a52f2c69ffafe3064a3287df03d02c9b431bc92d4781274"
    }
  ];

  var INTERVALS = {
    "15m": { path: "minute", aggregate: 15, limit: 200, label: "15 minutes" },
    "1h": { path: "hour", aggregate: 1, limit: 200, label: "1 hour" },
    "4h": { path: "hour", aggregate: 4, limit: 200, label: "4 hours" },
    "1d": { path: "day", aggregate: 1, limit: 200, label: "1 day" }
  };

  var HOLDINGS = [
    { kind: "cash", label: "USD collateral", amount: 2480.15 },
    { kind: "spot", symbol: "TSLA", qty: 1.2 },
    { kind: "perp", symbol: "AMZN", side: "long", lev: 2, margin: 400, entry: 214.62 }
  ];

  var state = {
    symbol: "TSLA",
    interval: "1h",
    mode: "spot",
    side: "long",
    size: 10,
    leverage: 2,
    hidden: true,
    privacy: "you",
    quotes: {},
    candles: [],
    updatedAt: null,
    quoteError: null,
    candleError: null
  };

  var refreshTimer = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function fmtUsd(n, digits) {
    var d = digits == null ? 2 : digits;
    var abs = Math.abs(n);
    var s = abs.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return (n < 0 ? "−$" : "$") + s;
  }
  function fmtNum(n, digits) {
    return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }
  function def(symbol) {
    return MARKETS.filter(function (m) { return m.symbol === symbol; })[0] || MARKETS[0];
  }
  function quote(symbol) {
    return state.quotes[symbol || state.symbol] || null;
  }
  function livePrice(symbol) {
    var q = quote(symbol);
    return q && q.price > 0 ? q.price : null;
  }
  function fmtCompact(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.0$/, "") + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 1 : 1).replace(/\.0$/, "") + "K";
    return fmtNum(n, 0);
  }

  function usCashOpen(date) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date || new Date());
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    var day = map.weekday;
    if (day === "Sat" || day === "Sun") return false;
    var minutes = Number(map.hour) * 60 + Number(map.minute);
    return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  }

  function fmtTime(date) {
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  function fetchQuotes() {
    var pairs = MARKETS.map(function (m) { return m.pool; }).join(",");
    var url = "https://api.dexscreener.com/latest/dex/pairs/robinhood/" + pairs;
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("DexScreener " + res.status);
      return res.json();
    }).then(function (data) {
      var byPool = {};
      (data.pairs || []).forEach(function (p) {
        if (p && p.pairAddress) byPool[p.pairAddress.toLowerCase()] = p;
      });
      var next = {};
      MARKETS.forEach(function (m) {
        var p = byPool[m.pool.toLowerCase()];
        if (!p || !p.priceUsd) return;
        next[m.symbol] = {
          symbol: m.symbol,
          name: m.name,
          price: Number(p.priceUsd),
          change: Number((p.priceChange && p.priceChange.h24) != null ? p.priceChange.h24 : 0),
          volume: Number((p.volume && p.volume.h24) || 0),
          liquidity: Number((p.liquidity && p.liquidity.usd) || 0),
          quote: (p.quoteToken && p.quoteToken.symbol) || "USDG",
          url: p.url || ""
        };
      });
      if (!Object.keys(next).length) throw new Error("No live pairs returned");
      state.prevQuotes = state.quotes;
      state.quotes = next;
      state.updatedAt = new Date();
      state.quoteError = null;
    }).catch(function (err) {
      state.quoteError = err && err.message ? err.message : "Could not reach DexScreener";
    });
  }

  function fetchCandles() {
    var m = def(state.symbol);
    var spec = INTERVALS[state.interval] || INTERVALS["1h"];
    var url = "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/" +
      m.pool + "/ohlcv/" + spec.path +
      "?aggregate=" + spec.aggregate +
      "&limit=" + spec.limit +
      "&currency=usd";
    var requested = state.symbol + ":" + state.interval;
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("GeckoTerminal " + res.status);
      return res.json();
    }).then(function (data) {
      if (state.symbol + ":" + state.interval !== requested) return;
      var list = (((data.data || {}).attributes) || {}).ohlcv_list || [];
      var candles = list.map(function (row) {
        return {
          t: Number(row[0]),
          o: Number(row[1]),
          h: Number(row[2]),
          l: Number(row[3]),
          c: Number(row[4]),
          v: Number(row[5] || 0)
        };
      }).filter(function (c) {
        return isFinite(c.t) && isFinite(c.c) && isFinite(c.h) && isFinite(c.l);
      });
      candles.sort(function (a, b) { return a.t - b.t; });
      var px = livePrice(state.symbol);
      if (px && candles.length) {
        var last = candles[candles.length - 1];
        last.c = px;
        last.h = Math.max(last.h, px);
        last.l = Math.min(last.l, px);
      }
      state.candles = candles;
      state.candleError = candles.length ? null : "No candles returned for this interval";
    }).catch(function (err) {
      if (state.symbol + ":" + state.interval !== requested) return;
      state.candleError = err && err.message ? err.message : "Could not reach GeckoTerminal";
    });
  }

  var chartAnim = { raf: null, key: "", reduce: false };
  try { chartAnim.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  function paintChart(progress) {
    var canvas = $("#priceChart");
    if (!canvas) return;
    var wrap = canvas.parentElement;
    var dpr = window.devicePixelRatio || 1;
    var w = wrap.clientWidth || 600;
    var h = wrap.clientHeight || 280;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var candles = state.candles;
    var meta = $("#chartMeta");
    var px = livePrice(state.symbol);
    var interval = INTERVALS[state.interval] || INTERVALS["1h"];
    var p = progress == null ? 1 : progress;

    if (!candles.length) {
      ctx.fillStyle = "#8a90a8";
      ctx.font = "14px 'JetBrains Mono', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(state.candleError || "Loading candles…", w / 2, h / 2);
      if (meta) meta.innerHTML = "<span>" + (state.candleError || "Loading candles") + "</span>";
      return;
    }

    var min = Infinity;
    var max = -Infinity;
    candles.forEach(function (c) {
      if (c.l < min) min = c.l;
      if (c.h > max) max = c.h;
    });
    if (px) {
      if (px < min) min = px;
      if (px > max) max = px;
    }
    var pad = (max - min) * 0.12 || (px || max) * 0.01;
    min -= pad;
    max += pad;

    var left = 16;
    var right = 16;
    var top = 18;
    var bottom = 22;
    function x(i) {
      return left + (i / Math.max(candles.length - 1, 1)) * (w - left - right);
    }
    function y(v) {
      return top + (1 - (v - min) / (max - min)) * (h - top - bottom);
    }

    ctx.strokeStyle = "rgba(60,239,255,0.12)";
    ctx.lineWidth = 1;
    for (var g = 0; g < 5; g++) {
      var gy = top + g * ((h - top - bottom) / 4);
      ctx.beginPath();
      ctx.moveTo(left, gy);
      ctx.lineTo(w - right, gy);
      ctx.stroke();
    }

    if (px && p > 0.85) {
      ctx.globalAlpha = Math.min(1, (p - 0.85) / 0.15);
      ctx.strokeStyle = "rgba(255,46,77,0.45)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(left, y(px));
      ctx.lineTo(w - right, y(px));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    var shown = Math.max(1, Math.floor(candles.length * p));
    var slot = (w - left - right) / Math.max(candles.length, 1);
    var bodyW = Math.max(1, Math.min(7, slot * 0.62));
    var i;
    for (i = 0; i < shown; i++) {
      var c = candles[i];
      var cx = x(i);
      var up = c.c >= c.o;
      ctx.strokeStyle = up ? "#3cefff" : "#ff2e4d";
      ctx.fillStyle = up ? "rgba(60,239,255,0.22)" : "rgba(255,46,77,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y(c.h));
      ctx.lineTo(cx, y(c.l));
      ctx.stroke();
      var y1 = y(Math.max(c.o, c.c));
      var y2 = y(Math.min(c.o, c.c));
      var bh = Math.max(1, y2 - y1);
      ctx.fillRect(cx - bodyW / 2, y1, bodyW, bh);
      ctx.strokeRect(cx - bodyW / 2, y1, bodyW, bh);
    }

    // Ink close-line drawn in with the same progress
    ctx.beginPath();
    for (i = 0; i < shown; i++) {
      if (i === 0) ctx.moveTo(x(i), y(candles[i].c));
      else ctx.lineTo(x(i), y(candles[i].c));
    }
    ctx.strokeStyle = "#8b6cff";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (shown > 0) {
      var tipX = x(shown - 1);
      var tipY = y(candles[shown - 1].c);
      ctx.beginPath();
      ctx.arc(tipX, tipY, p < 1 ? 3.2 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "#3cefff";
      ctx.fill();
    }

    ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "#8a90a8";
    ctx.textAlign = "left";
    ctx.fillText(fmtUsd(max, 2), left + 2, 14);
    ctx.fillText(fmtUsd(min, 2), left + 2, h - 6);
    if (px && p > 0.7) {
      ctx.globalAlpha = Math.min(1, (p - 0.7) / 0.3);
      ctx.textAlign = "right";
      ctx.fillStyle = "#eef0f8";
      ctx.fillText(state.symbol + "  " + fmtUsd(px, 2), w - right, y(px) - 8);
      ctx.globalAlpha = 1;
    }

    if (meta) {
      var first = new Date(candles[0].t * 1000);
      var last = new Date(candles[candles.length - 1].t * 1000);
      var range = first.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
        " – " + last.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      meta.innerHTML =
        "<span>" + candles.length + " " + interval.label + " candles · GeckoTerminal</span>" +
        "<span>" + range + "</span>";
    }
  }

  function drawChart(opts) {
    var instant = opts && opts.instant;
    var candles = state.candles;
    var key = state.symbol + "|" + state.interval + "|" +
      (candles[0] ? candles[0].t : "x") + "|" + candles.length;
    if (!candles.length) {
      if (chartAnim.raf) cancelAnimationFrame(chartAnim.raf);
      chartAnim.key = "";
      paintChart(1);
      return;
    }
    if (instant || chartAnim.reduce || key === chartAnim.key) {
      paintChart(1);
      return;
    }
    chartAnim.key = key;
    if (chartAnim.raf) cancelAnimationFrame(chartAnim.raf);
    var start = performance.now();
    var dur = 1200;
    function tick(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      paintChart(eased);
      if (t < 1) chartAnim.raf = requestAnimationFrame(tick);
    }
    chartAnim.raf = requestAnimationFrame(tick);
  }

  function renderLiveBar() {
    var status = $("#liveStatus");
    var source = $("#liveSource");
    var bar = $("#liveBar");
    var cashOpen = usCashOpen();
    if (bar) bar.classList.toggle("is-error", !!state.quoteError && !state.updatedAt);
    if (bar) bar.classList.toggle("is-closed", !cashOpen);
    if (status) {
      if (state.updatedAt) {
        var label = "Live · updated " + fmtTime(state.updatedAt);
        if (!cashOpen) label += " · US cash session closed";
        if (state.quoteError) label += " · last good print held";
        status.textContent = label;
      } else if (state.quoteError) {
        status.textContent = "Live prices unavailable · " + state.quoteError;
      } else {
        status.textContent = "Fetching live prices…";
      }
    }
    if (source) {
      source.textContent = "Robinhood Chain token prices via DexScreener · candles via GeckoTerminal";
    }
    var session = $("#sessionNote");
    if (session) {
      session.hidden = cashOpen;
    }
  }

  function renderMarkets() {
    var tb = $("#marketRows");
    if (!tb) return;
    tb.innerHTML = MARKETS.map(function (m) {
      var q = quote(m.symbol);
      var sel = m.symbol === state.symbol ? "true" : "false";
      if (!q) {
        return (
          "<tr data-symbol=\"" + m.symbol + "\" aria-selected=\"" + sel + "\">" +
          "<td><span class=\"sym\">" + m.symbol + "</span> <span class=\"name\">" + m.name + "</span></td>" +
          "<td class=\"num right\">…</td>" +
          "<td class=\"num right\">…</td>" +
          "<td class=\"num right\">…</td>" +
          "<td class=\"num right\">…</td>" +
          "</tr>"
        );
      }
      var up = q.change >= 0;
      var cls = up ? "chg-up" : "chg-down";
      var sign = up ? "+" : "";
      return (
        "<tr data-symbol=\"" + m.symbol + "\" aria-selected=\"" + sel + "\">" +
        "<td><span class=\"sym\">" + m.symbol + "</span> <span class=\"name\">" + m.name + "</span></td>" +
        "<td class=\"num right px-cell\" data-symbol=\"" + m.symbol + "\" data-price=\"" + q.price + "\">" + fmtUsd(q.price, 2) + "</td>" +
        "<td class=\"num right " + cls + "\">" + sign + fmtNum(q.change, 2) + "%</td>" +
        "<td class=\"num right\">$" + fmtCompact(q.volume) + "</td>" +
        "<td class=\"num right\">$" + fmtCompact(q.liquidity) + "</td>" +
        "</tr>"
      );
    }).join("");
    $all("#marketRows tr").forEach(function (tr) {
      tr.addEventListener("click", function () {
        setSymbol(tr.getAttribute("data-symbol"));
      });
    });
  }

  function liquidationPrice(entry, side, lev) {
    var room = 1 / lev - MMR;
    if (room <= 0) return side === "long" ? entry * 0.02 : entry * 1.98;
    if (side === "long") return entry * (1 - room);
    return entry * (1 + room);
  }

  function renderTicket() {
    var m = def(state.symbol);
    var price = livePrice(m.symbol);
    var size = clamp(Number(state.size) || 0, 0, 1e9);
    var fee, youGet, liq, note;
    var elGet = $("#outGet");
    var elFee = $("#outFee");
    var elLiq = $("#outLiq");
    var elNote = $("#outNote");
    var elPx = $("#outPrice");
    if (elPx) elPx.textContent = price ? (m.symbol + "  " + fmtUsd(price, 2)) : m.symbol;
    if (!price) {
      if (elGet) elGet.textContent = "Waiting for a live print";
      if (elFee) elFee.textContent = "—";
      if (elLiq) elLiq.textContent = "—";
      if (elNote) elNote.textContent = "The ticket prices off the live token once the board loads. Preview only — no order is routed.";
    } else if (state.mode === "spot") {
      fee = size * FEE_RATE;
      var qty = size > 0 ? (size - fee) / price : 0;
      youGet = fmtNum(qty, 4) + " " + m.symbol;
      liq = "—";
      note = "Priced off the live " + m.symbol + " token. A spot buy is a token holding, not a share of the issuer. Preview only — nothing is sent on-chain.";
      if (elGet) elGet.textContent = youGet;
      if (elFee) elFee.textContent = fmtUsd(fee, 2) + "  (10 bps, preview)";
      if (elLiq) elLiq.textContent = liq;
      if (elNote) elNote.textContent = note;
    } else {
      var notional = size * state.leverage;
      fee = notional * FEE_RATE;
      youGet = (state.side === "long" ? "Long " : "Short ") +
        state.leverage.toFixed(state.leverage % 1 ? 1 : 0) + "× · " +
        fmtUsd(notional, 2) + " notional";
      liq = size > 0 ? fmtUsd(liquidationPrice(price, state.side, state.leverage), 2) : "—";
      note = "Priced off the live " + m.symbol + " token. At the liquidation price, this sketch would lose the full margin. Preview only — nothing is sent on-chain.";
      if (elGet) elGet.textContent = youGet;
      if (elFee) elFee.textContent = fmtUsd(fee, 2) + "  (10 bps, preview)";
      if (elLiq) elLiq.textContent = liq;
      if (elNote) elNote.textContent = note;
    }
    var levWrap = $("#leverageField");
    var sideWrap = $("#sideField");
    if (levWrap) levWrap.hidden = state.mode !== "perps";
    if (sideWrap) sideWrap.hidden = state.mode !== "perps";
    var tag = $("#deskSymbol");
    if (tag) tag.textContent = m.symbol;
  }

  function mask(text) {
    return state.hidden ? "••••••" : text;
  }

  function holdingValue(h) {
    if (h.kind === "cash") return h.amount;
    var px = livePrice(h.symbol);
    if (!px) return null;
    if (h.kind === "spot") return h.qty * px;
    var dir = h.side === "long" ? 1 : -1;
    var pnl = ((px - h.entry) / h.entry) * h.lev * h.margin * dir;
    return h.margin + pnl;
  }

  function renderHoldings() {
    var tb = $("#holdingRows");
    var tot = $("#holdingTotal");
    if (!tb) return;
    var sum = 0;
    var ready = true;
    tb.innerHTML = HOLDINGS.map(function (h) {
      var val = holdingValue(h);
      if (val == null) ready = false;
      else sum += val;
      var name, detail;
      var px = livePrice(h.symbol);
      if (h.kind === "cash") {
        name = h.label;
        detail = "Available";
      } else if (h.kind === "spot") {
        name = h.symbol + " token";
        detail = px
          ? fmtNum(h.qty, 2) + " tokens @ live " + fmtUsd(px, 2)
          : fmtNum(h.qty, 2) + " tokens · waiting for a live print";
      } else {
        name = h.symbol + " " + h.lev + "× " + h.side;
        detail = "Margin " + fmtUsd(h.margin, 2) + " · entry " + fmtUsd(h.entry, 2) +
          (px ? " · mark " + fmtUsd(px, 2) : "");
      }
      return (
        "<tr>" +
        "<td>" + name + "<div class=\"fine\">" + (state.hidden ? "Hidden" : detail) + "</div></td>" +
        "<td class=\"num right\">" + (val == null ? "…" : mask(fmtUsd(val, 2))) + "</td>" +
        "</tr>"
      );
    }).join("");
    if (tot) tot.textContent = !ready ? "…" : mask(fmtUsd(sum, 2));
    var btn = $("#toggleHoldings");
    if (btn) btn.setAttribute("aria-pressed", state.hidden ? "true" : "false");
    if (btn) btn.textContent = state.hidden ? "Show figures" : "Hide figures";
  }

  function renderCompare() {
    var slider = $("#moveSlider");
    var read = $("#moveRead");
    var spotEl = $("#cmpSpot");
    var perpEl = $("#cmpPerp");
    var spotNote = $("#cmpSpotNote");
    var perpNote = $("#cmpPerpNote");
    if (!slider) return;
    var pct = Number(slider.value) || 0;
    var px = livePrice(state.symbol);
    if (read) {
      var sign = pct > 0 ? "+" : "";
      read.textContent = px
        ? "If " + state.symbol + " moves " + sign + pct.toFixed(1) + "% from the live print of " + fmtUsd(px, 2)
        : "If the token moves " + sign + pct.toFixed(1) + "%";
    }
    var stake = 1000;
    var spotPnl = stake * (pct / 100);
    var room = (1 / 2 - MMR) * 100;
    var liquidated = pct <= -room;
    var perpPnl = liquidated ? -stake : stake * 2 * (pct / 100);
    function paint(el, pnl) {
      el.textContent = (pnl >= 0 ? "+" : "") + fmtUsd(pnl, 2);
      el.classList.toggle("chg-up", pnl > 0);
      el.classList.toggle("chg-down", pnl < 0);
    }
    if (spotEl) paint(spotEl, spotPnl);
    if (perpEl) {
      if (liquidated) {
        perpEl.textContent = "Liquidated";
        perpEl.classList.add("chg-down");
        perpEl.classList.remove("chg-up");
      } else {
        paint(perpEl, perpPnl);
      }
    }
    if (spotNote) {
      spotNote.textContent = px
        ? "End value of a " + fmtUsd(stake, 0) + " holding of " + state.symbol + ", marked from the live print: " + fmtUsd(stake + spotPnl, 2) + "."
        : "End value of a " + fmtUsd(stake, 0) + " holding: " + fmtUsd(stake + spotPnl, 2) + ".";
    }
    if (perpNote) {
      perpNote.textContent = liquidated
        ? "A 2× long is closed once the price has fallen about " + fmtNum(room, 1) + "%. The " + fmtUsd(stake, 0) + " margin is lost."
        : "End equity of a " + fmtUsd(stake, 0) + " margin, 2× long on " + state.symbol + ": " + fmtUsd(stake + perpPnl, 2) + ".";
    }
  }

  function renderLiquidity() {
    var tb = $("#liqRows");
    if (!tb) return;
    var max = 0;
    MARKETS.forEach(function (m) {
      var q = quote(m.symbol);
      if (q && q.liquidity > max) max = q.liquidity;
    });
    tb.innerHTML = MARKETS.map(function (m) {
      var q = quote(m.symbol);
      if (!q) {
        return "<tr><td class=\"sym\">" + m.symbol + "</td><td class=\"num right\">…</td><td></td></tr>";
      }
      var pct = max ? Math.round((q.liquidity / max) * 100) : 0;
      return (
        "<tr>" +
        "<td class=\"sym\">" + m.symbol + "</td>" +
        "<td class=\"num right\">" + fmtUsd(q.liquidity, 0) + "</td>" +
        "<td><div class=\"bar\" aria-hidden=\"true\"><span style=\"width:" + pct + "%\"></span></div></td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderAll(opts) {
    var prev = state.prevQuotes || {};
    renderLiveBar();
    renderMarkets();
    renderTicket();
    renderHoldings();
    renderCompare();
    renderLiquidity();
    drawChart(opts);
    if (window.MiraiMotion && window.MiraiMotion.onQuotes) {
      window.MiraiMotion.onQuotes(state.quotes, prev);
    }
  }

  function setSeg(group, value, attr) {
    $all(group).forEach(function (btn) {
      var on = btn.getAttribute(attr) === String(value);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-on", on);
    });
  }

  function setSymbol(symbol) {
    if (!symbol || symbol === state.symbol) {
      state.symbol = symbol || state.symbol;
      renderMarkets();
      return;
    }
    state.symbol = symbol;
    state.candles = [];
    renderAll();
    fetchCandles().then(renderAll);
  }

  function setIntervalKey(key) {
    if (!INTERVALS[key] || key === state.interval) return;
    state.interval = key;
    state.candles = [];
    setSeg("[data-interval]", state.interval, "data-interval");
    renderAll();
    fetchCandles().then(renderAll);
  }

  function refresh() {
    return fetchQuotes().then(function () {
      renderAll();
      return fetchCandles();
    }).then(renderAll);
  }


  /* Official Robinhood Chain mainnet (docs.robinhood.com/chain/connecting). */
  var RH_CHAIN = {
    chainId: "0x1237",
    decimal: 4663,
    params: {
      chainId: "0x1237",
      chainName: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
      blockExplorerUrls: ["https://robinhoodchain.blockscout.com"]
    }
  };

  var wallet = {
    provider: null,
    address: null,
    chainId: null,
    providers: [],
    onAccounts: null,
    onChain: null
  };

  function applyLinks() {
    var links = window.MIRAI_LINKS || { github: "https://github.com/mirairh/mirai", x: "https://x.com/mirairh_" };
    var labels = { github: "GitHub", x: "X" };
    $all("[data-link]").forEach(function (a) {
      var key = a.getAttribute("data-link");
      var url = links[key];
      var ready = url && url !== "#";
      var name = labels[key] || key;
      if (ready) {
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.removeAttribute("aria-disabled");
        a.setAttribute("aria-label", name);
        a.setAttribute("title", name);
        if (a.classList.contains("text-link")) a.textContent = name;
      } else {
        a.href = "#";
        a.removeAttribute("target");
        a.setAttribute("aria-disabled", "true");
        a.setAttribute("aria-label", name + " (soon)");
        a.setAttribute("title", name + " (soon)");
        if (a.classList.contains("text-link")) a.textContent = name + " (soon)";
        a.addEventListener("click", function (e) { e.preventDefault(); });
      }
    });
  }

  function shortAddr(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function normChainId(id) {
    if (id == null || id === "") return "";
    var n = typeof id === "string" && id.slice(0, 2).toLowerCase() === "0x"
      ? parseInt(id, 16)
      : Number(id);
    if (!isFinite(n)) return String(id).toLowerCase();
    return "0x" + n.toString(16);
  }

  function isRhChain(id) {
    return normChainId(id) === RH_CHAIN.chainId;
  }

  function guessInjectedName(provider) {
    if (!provider) return "Injected wallet";
    if (provider.isRabby) return "Rabby";
    if (provider.isOkxWallet || provider.isOKExWallet) return "OKX Wallet";
    if (provider.isCoinbaseWallet) return "Coinbase Wallet";
    if (provider.isBraveWallet) return "Brave Wallet";
    if (provider.isMetaMask) return "MetaMask";
    return "Injected wallet";
  }

  function discoverWallets() {
    var found = [];
    var seen = {};
    function add(info, provider) {
      if (!provider) return;
      var key = (info && (info.uuid || info.rdns)) || "";
      if (!key) {
        try { key = String(provider); } catch (e) { key = "p" + found.length; }
      }
      if (seen[key]) return;
      seen[key] = true;
      found.push({ info: info || { name: guessInjectedName(provider), icon: "", rdns: "", uuid: key }, provider: provider });
    }
    function onAnnounce(event) {
      var detail = event && event.detail;
      if (!detail || !detail.provider) return;
      add(detail.info || {}, detail.provider);
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); }
    catch (e) {}
    window.removeEventListener("eip6963:announceProvider", onAnnounce);

    if (!found.length) {
      var okx = window.okxwallet;
      var eth = window.ethereum;
      if (okx) add({ name: "OKX Wallet", rdns: "com.okex.wallet", uuid: "fallback-okx", icon: "" }, okx);
      if (eth && eth !== okx) {
        add({ name: guessInjectedName(eth), rdns: "injected", uuid: "fallback-injected", icon: "" }, eth);
      }
    }
    wallet.providers = found;
    return found;
  }

  function setWalletError(msg) {
    var el = $("#walletError");
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = msg;
  }

  function unbindProvider() {
    if (!wallet.provider) return;
    var p = wallet.provider;
    if (wallet.onAccounts && p.removeListener) {
      try { p.removeListener("accountsChanged", wallet.onAccounts); } catch (e) {}
      try { p.removeListener("chainChanged", wallet.onChain); } catch (e) {}
    }
    wallet.onAccounts = null;
    wallet.onChain = null;
  }

  function bindProvider(provider) {
    unbindProvider();
    wallet.provider = provider;
    wallet.onAccounts = function (accs) {
      if (!accs || !accs.length) {
        clearWallet();
        return;
      }
      wallet.address = accs[0];
      renderWalletChrome();
    };
    wallet.onChain = function (id) {
      wallet.chainId = id;
      renderWalletChrome();
    };
    if (provider && typeof provider.on === "function") {
      provider.on("accountsChanged", wallet.onAccounts);
      provider.on("chainChanged", wallet.onChain);
    }
  }

  function clearWallet() {
    unbindProvider();
    wallet.provider = null;
    wallet.address = null;
    wallet.chainId = null;
    renderWalletChrome();
  }

  function renderWalletChrome() {
    var connected = $("#walletConnected");
    var connectBtn = $("#connectBtn") || $("[data-open-wallet]");
    var addr = $("#walletAddr");
    var net = $("#walletNet");
    var chip = $("#walletChip");
    var switchBtn = $("#walletSwitch");
    var on = !!(wallet.address && wallet.provider);
    if (connected) connected.hidden = !on;
    if (connectBtn) connectBtn.hidden = on;
    if (!on) {
      var drop = $("#walletDrop");
      if (drop) drop.hidden = true;
      if (chip) chip.setAttribute("aria-expanded", "false");
      notifyWallet();
      return;
    }
    if (addr) addr.textContent = shortAddr(wallet.address);
    var ok = isRhChain(wallet.chainId);
    if (net) net.textContent = ok ? "Robinhood Chain" : "Wrong network";
    if (chip) chip.classList.toggle("is-wrong", !ok);
    if (switchBtn) switchBtn.hidden = ok;
    notifyWallet();
  }

  function notifyWallet() {
    if (!window.MiraiDesk || typeof window.MiraiDesk.getWallet !== "function") return;
    try {
      document.dispatchEvent(new CustomEvent("mirai:wallet", { detail: window.MiraiDesk.getWallet() }));
    } catch (err) {}
  }

  function closeWalletModal() {
    var modal = $("#walletModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
    setWalletError("");
  }

  function openWalletModal() {
    var modal = $("#walletModal");
    if (!modal) return;
    setWalletError("");
    var list = discoverWallets();
    var box = $("#walletList");
    var empty = $("#walletEmpty");
    if (box) {
      box.innerHTML = "";
      if (list.length) {
        box.hidden = false;
        list.forEach(function (entry) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "wallet-item";
          var name = (entry.info && entry.info.name) || "Wallet";
          if (entry.info && entry.info.icon) {
            var img = document.createElement("img");
            img.src = entry.info.icon;
            img.alt = "";
            img.width = 28;
            img.height = 28;
            btn.appendChild(img);
          } else {
            var mark = document.createElement("span");
            mark.className = "wallet-fallback";
            mark.textContent = name.charAt(0);
            btn.appendChild(mark);
          }
          var label = document.createElement("span");
          label.textContent = name;
          btn.appendChild(label);
          btn.addEventListener("click", function () { connectWith(entry); });
          box.appendChild(btn);
        });
      } else {
        box.hidden = true;
      }
    }
    if (empty) empty.hidden = list.length > 0;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    var closer = $("#walletClose");
    if (closer) closer.focus();
  }

  function isUserReject(err) {
    var code = err && err.code;
    return code === 4001 || code === 5000 || (err && /reject|denied|cancel/i.test(err.message || ""));
  }

  function isMissingChain(err) {
    if (!err) return false;
    if (err.code === 4902) return true;
    var orig = err.data && err.data.originalError;
    return !!(orig && orig.code === 4902);
  }

  function ensureChain(provider) {
    return provider.request({ method: "eth_chainId" }).then(function (id) {
      wallet.chainId = id;
      if (isRhChain(id)) return id;
      return provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: RH_CHAIN.chainId }]
      }).then(function () {
        return provider.request({ method: "eth_chainId" });
      }).catch(function (err) {
        if (isMissingChain(err)) {
          return provider.request({
            method: "wallet_addEthereumChain",
            params: [RH_CHAIN.params]
          }).then(function () {
            return provider.request({ method: "eth_chainId" });
          });
        }
        throw err;
      });
    }).then(function (id) {
      wallet.chainId = id;
    });
  }

  function connectWith(entry) {
    var provider = entry && entry.provider;
    if (!provider || typeof provider.request !== "function") {
      setWalletError("That wallet cannot be reached from this page.");
      return;
    }
    setWalletError("");
    // eth_requestAccounts only — never send a transaction from this flow.
    provider.request({ method: "eth_requestAccounts" }).then(function (accounts) {
      var addr = accounts && accounts[0];
      if (!addr) throw new Error("No account was returned.");
      wallet.address = addr;
      bindProvider(provider);
      return ensureChain(provider).catch(function (err) {
        if (isUserReject(err)) return;
        throw err;
      });
    }).then(function () {
      return provider.request({ method: "eth_chainId" });
    }).then(function (id) {
      wallet.chainId = id;
      renderWalletChrome();
      closeWalletModal();
    }).catch(function (err) {
      if (isUserReject(err)) {
        setWalletError("Connection was declined in the wallet.");
        return;
      }
      setWalletError((err && err.message) ? err.message : "Could not connect the wallet.");
    });
  }

  function disconnectWallet() {
    var provider = wallet.provider;
    var done = Promise.resolve();
    if (provider && typeof provider.request === "function") {
      done = provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }]
      }).catch(function () { /* not all wallets support revoke; local disconnect is enough */ });
    }
    return done.then(function () {
      clearWallet();
    });
  }

  function tryRestore() {
    var list = discoverWallets();
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve();
      var entry = list[i++];
      var provider = entry.provider;
      if (!provider || typeof provider.request !== "function") return next();
      return provider.request({ method: "eth_accounts" }).then(function (accounts) {
        if (accounts && accounts[0]) {
          wallet.address = accounts[0];
          bindProvider(provider);
          return provider.request({ method: "eth_chainId" }).then(function (id) {
            wallet.chainId = id;
            renderWalletChrome();
          });
        }
        return next();
      }).catch(next);
    }
    return next();
  }

  function initWallet() {
    var modal = $("#walletModal");
    $all("[data-open-wallet]").forEach(function (btn) {
      btn.addEventListener("click", openWalletModal);
    });
    if (modal) {
      var veil = modal.querySelector(".veil");
      if (veil) veil.addEventListener("click", closeWalletModal);
      var closer = $("#walletClose");
      if (closer) closer.addEventListener("click", closeWalletModal);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !modal.hidden) closeWalletModal();
      });
    }
    var chip = $("#walletChip");
    var drop = $("#walletDrop");
    if (chip && drop) {
      chip.addEventListener("click", function () {
        var open = drop.hidden;
        drop.hidden = !open;
        chip.setAttribute("aria-expanded", open ? "true" : "false");
      });
      document.addEventListener("click", function (e) {
        var slot = e.target && e.target.closest && e.target.closest(".wallet-slot");
        if (!slot) {
          drop.hidden = true;
          chip.setAttribute("aria-expanded", "false");
        }
      });
    }
    var sw = $("#walletSwitch");
    if (sw) {
      sw.addEventListener("click", function () {
        if (!wallet.provider) return;
        ensureChain(wallet.provider).then(function () {
          return wallet.provider.request({ method: "eth_chainId" });
        }).then(function (id) {
          wallet.chainId = id;
          renderWalletChrome();
        }).catch(function (err) {
          if (!isUserReject(err)) {
            console.warn("Could not switch network", err);
          }
        });
      });
    }
    var disc = $("#walletDisconnect");
    if (disc) disc.addEventListener("click", disconnectWallet);
    renderWalletChrome();
    tryRestore();
  }

  function bind() {
    $all("[data-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.mode = btn.getAttribute("data-mode");
        setSeg("[data-mode]", state.mode, "data-mode");
        renderTicket();
      });
    });
    $all("[data-side]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.side = btn.getAttribute("data-side");
        setSeg("[data-side]", state.side, "data-side");
        renderTicket();
      });
    });
    $all("[data-lev]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.leverage = Number(btn.getAttribute("data-lev"));
        setSeg("[data-lev]", String(state.leverage), "data-lev");
        renderTicket();
      });
    });
    $all("[data-interval]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setIntervalKey(btn.getAttribute("data-interval"));
      });
    });
    var size = $("#sizeInput");
    if (size) {
      size.value = String(state.size);
      size.addEventListener("input", function () {
        state.size = size.value;
        renderTicket();
      });
    }
    var hide = $("#toggleHoldings");
    if (hide) {
      hide.addEventListener("click", function () {
        state.hidden = !state.hidden;
        renderHoldings();
      });
    }
    var slider = $("#moveSlider");
    if (slider) {
      slider.addEventListener("input", renderCompare);
    }
    $all("[data-privacy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.privacy = btn.getAttribute("data-privacy");
        setSeg("[data-privacy]", state.privacy, "data-privacy");
        var box = $("#seeBox");
        if (box) {
          box.classList.toggle("is-private", state.privacy === "you");
          box.classList.toggle("is-public", state.privacy === "others");
        }
      });
    });

    window.addEventListener("resize", function () {
      drawChart({ instant: true });
    });
  }

  window.MiraiDesk = {
    openWallet: openWalletModal,
    switchChain: function () {
      if (!wallet.provider) return Promise.resolve(false);
      return ensureChain(wallet.provider).then(function () {
        return wallet.provider.request({ method: "eth_chainId" });
      }).then(function (id) {
        wallet.chainId = id;
        renderWalletChrome();
        return true;
      });
    },
    getWallet: function () {
      var on = !!(wallet.address && wallet.provider);
      return {
        connected: on,
        address: on ? wallet.address : null,
        chainId: on ? wallet.chainId : null,
        onRobinhood: on && isRhChain(wallet.chainId),
        provider: on ? wallet.provider : null
      };
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    applyLinks();
    initWallet();
    bind();
    setSeg("[data-mode]", state.mode, "data-mode");
    setSeg("[data-side]", state.side, "data-side");
    setSeg("[data-lev]", String(state.leverage), "data-lev");
    setSeg("[data-privacy]", state.privacy, "data-privacy");
    setSeg("[data-interval]", state.interval, "data-interval");
    var box = $("#seeBox");
    if (box) {
      box.classList.add("is-private");
      box.classList.remove("is-public");
    }
    renderAll();
    refresh();
    refreshTimer = setInterval(refresh, REFRESH_MS);
  });
})();
