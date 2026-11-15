/* ============================================================================
 * MIRAI SWAP / POOLS CONFIG
 * This is the only place token addresses, decimals, and the price reference
 * live. Wire a router later by editing this object — the page never sends a
 * transaction while execution stays off.
 *
 * MIRAI.address is null until deploy ("CA soon"). Leave ca: "soon" until then.
 * USDC.address is null on purpose: Robinhood Chain's published dollar token is
 * USDG (docs.robinhood.com/chain/contracts). Do not paste an unverified USDC.
 * ETH is the native gas token. wrapped is the canonical WETH address.
 * ========================================================================== */
var MIRAI_SWAP = {
  execution: "off",
  chainId: "0x1237",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  refreshMs: 20000,
  /* Generic swap gas, used only to turn the live gas price into a fee estimate. */
  swapGasUnits: 180000,
  autoSlippageBps: 50,
  defaultDeadlineMin: 30,
  /* Uniswap v3 fee units (hundredths of a bip): 500 = 0.05%, 3000 = 0.30%, 10000 = 1%.
     Choices in the add-liquidity form only — not a claim that these pools exist. */
  feeTiers: [500, 3000, 10000],
  reference: {
    quoteSymbol: "USDG",
    quoteName: "Global Dollar",
    quoteAddress: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    /* Used only if the token-pairs search does not return a WETH/USDG market. */
    fallbackPair: "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca"
  },
  tokens: {
    ETH: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: null,
      native: true,
      wrapped: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
    },
    USDC: {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      address: null,
      native: false
    },
    MIRAI: {
      symbol: "MIRAI",
      name: "Mirai",
      decimals: 18,
      /* Contract (CA). null until deploy — the page shows "CA: soon" and the Copy button stays off.
         Set a 0x address here after launch. That is the only switch for the copy control. */
      address: null,
      ca: "soon",
      native: false,
      /* Whole-token supply as a decimal string, e.g. "1000000000". null until the figure is real. */
      supply: null,
      /* USD market cap. null until a live $MIRAI price and a published supply exist. Do not guess. */
      marketCapUsd: null,
      curve: {
        /* "soon" keeps an empty bar and "—" amounts. Use "live" or "graduated" only with real numbers. */
        status: "soon",
        progress: null,
        onCurve: null,
        circulating: null
      }
    }
  },
  pools: [
    { id: "mirai-eth", base: "MIRAI", quote: "ETH", opensAtLaunch: true },
    { id: "mirai-usdc", base: "MIRAI", quote: "USDC", opensAtLaunch: true },
    { id: "eth-usdc", base: "ETH", quote: "USDC", opensAtLaunch: false }
  ]
};

(function () {
  "use strict";

  var CFG = MIRAI_SWAP;
  var state = {
    from: "ETH",
    to: "USDC",
    exact: "from",
    slip: "auto",
    customSlip: "",
    deadline: String(CFG.defaultDeadlineMin),
    invert: false,
    picking: "from",
    detail: "",
    poolQuery: "",
    poolSort: "featured",
    ethUsd: null,
    priceScaled: null,
    ref: null,
    priceError: null,
    gasWei: null,
    feeWei: null,
    gasError: null,
    wallet: { connected: false },
    balances: {},
    balanceStatus: {},
    liq: { poolId: "mirai-eth", fee: 3000, range: "full", exact: "a" },
    note: ""
  };
  var marketSeq = 0;
  var gasSeq = 0;
  var balanceSeq = 0;

  function $(sel) {
    if (!sel) return null;
    if (sel.charAt(0) === "#") return document.getElementById(sel.slice(1));
    return document.querySelector(sel);
  }
  function token(id) {
    return CFG.tokens[id];
  }
  function each(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }
  function pow10(n) {
    var x = 1n;
    var i;
    for (i = 0; i < n; i++) x *= 10n;
    return x;
  }
  function repeat(ch, n) {
    var s = "";
    var i;
    for (i = 0; i < n; i++) s += ch;
    return s;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c];
    });
  }
  function shortAddr(addr) {
    if (!addr || addr.length < 10) return "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }
  function hexToBig(hex) {
    if (!hex || hex === "0x") return 0n;
    return BigInt(hex);
  }
  function parseUnits(value, decimals) {
    var s = String(value == null ? "" : value).trim().replace(/,/g, "");
    if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
    var parts = s.split(".");
    var whole = parts[0] || "0";
    var frac = parts[1] || "";
    if (frac.length > decimals) frac = frac.slice(0, decimals);
    while (frac.length < decimals) frac += "0";
    var raw = (whole + frac).replace(/^0+/, "") || "0";
    try { return BigInt(raw); } catch (e) { return null; }
  }
  function formatUnits(units, decimals, maxFrac, grouped) {
    if (units == null) return "";
    var neg = units < 0n;
    if (neg) units = -units;
    var raw = units.toString();
    var whole;
    var frac;
    if (raw.length <= decimals) {
      whole = "0";
      frac = repeat("0", decimals - raw.length) + raw;
    } else {
      whole = raw.slice(0, raw.length - decimals);
      frac = raw.slice(raw.length - decimals);
    }
    if (maxFrac == null) maxFrac = decimals;
    frac = frac.slice(0, maxFrac).replace(/0+$/, "");
    if (grouped) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = frac ? whole + "." + frac : whole;
    return (neg ? "−" : "") + out;
  }
  function fracFor(units, decimals) {
    if (units == null || units === 0n) return 2;
    var raw = units.toString();
    if (raw.length > decimals) return Math.min(6, decimals);
    var frac = raw.padStart(decimals, "0");
    var i = 0;
    while (i < frac.length && frac.charAt(i) === "0") i++;
    return Math.min(decimals, Math.max(6, i + 2));
  }
  function formatUsdNumber(n) {
    if (n == null || !isFinite(n)) return "—";
    var digits = Math.abs(n) >= 1 ? 2 : 4;
    return (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }
  function formatUsd8(usd8) {
    if (usd8 == null) return "—";
    if (usd8 === 0n) return "$0.00";
    if (usd8 > 0n && usd8 < 1000000n) return "< $0.01";
    return "$" + formatUnits(usd8, 8, 2, true);
  }
  function formatCompactUsd(n) {
    if (n == null || !isFinite(n)) return "—";
    var abs = Math.abs(n);
    var digits = abs >= 100 ? 1 : 2;
    var sign = n < 0 ? "−" : "";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(digits) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(digits) + "M";
    if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(digits) + "K";
    return formatUsdNumber(n);
  }
  function formatTier(fee) {
    var pct = fee / 10000;
    if (pct >= 1) return pct.toFixed(0) + "%";
    return pct.toFixed(2) + "%";
  }
  function formatPctFromBps(bps) {
    var pct = bps / 100;
    var s = pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return s + "%";
  }
  function markLetter(id) {
    if (id === "ETH") return "E";
    if (id === "USDC") return "U";
    if (id === "MIRAI") return "M";
    return String(id || "?").charAt(0);
  }
  function involvesMirai() {
    var a = token(state.from);
    var b = token(state.to);
    return state.from === "MIRAI" || state.to === "MIRAI" ||
      !!(a && a.ca === "soon") || !!(b && b.ca === "soon");
  }
  function canPrice(a, b) {
    if (!state.priceScaled || !a || !b) return false;
    if (a.symbol === "MIRAI" || b.symbol === "MIRAI" || a.ca === "soon" || b.ca === "soon") return false;
    if (a.symbol === b.symbol) return false;
    return (a.symbol === "ETH" || a.symbol === "USDC") && (b.symbol === "ETH" || b.symbol === "USDC");
  }
  function toUsd8(units, t) {
    if (units == null || !t || !state.priceScaled) return null;
    if (t.symbol === "USDC") {
      if (t.decimals <= 8) return units * pow10(8 - t.decimals);
      return units / pow10(t.decimals - 8);
    }
    if (t.symbol === "ETH" || t.native) {
      return units * state.priceScaled / pow10(t.decimals);
    }
    return null;
  }
  function fromUsd8(usd8, t) {
    if (usd8 == null || !t || !state.priceScaled || state.priceScaled === 0n) return null;
    if (t.symbol === "USDC") {
      if (t.decimals <= 8) return usd8 / pow10(8 - t.decimals);
      return usd8 * pow10(t.decimals - 8);
    }
    if (t.symbol === "ETH" || t.native) {
      return usd8 * pow10(t.decimals) / state.priceScaled;
    }
    return null;
  }
  function convertUnits(units, fromT, toT) {
    if (!canPrice(fromT, toT)) return null;
    var usd8 = toUsd8(units, fromT);
    if (usd8 == null) return null;
    return fromUsd8(usd8, toT);
  }
  function parseAmount(raw, decimals) {
    var s = String(raw == null ? "" : raw).trim().replace(/,/g, "");
    if (!s) return { ok: false, kind: "empty" };
    if (!/^\d*\.?\d*$/.test(s) || s === ".") return { ok: false, kind: "invalid" };
    if (s.replace(".", "").length > 40) return { ok: false, kind: "huge" };
    var units = parseUnits(s, decimals);
    if (units == null) return { ok: false, kind: "invalid" };
    if (units === 0n) return { ok: false, kind: "zero", units: 0n };
    return { ok: true, kind: "ok", units: units };
  }
  function currentBps() {
    if (state.slip === "auto") return CFG.autoSlippageBps;
    if (state.slip === "custom") {
      var s = String(state.customSlip || "").trim();
      if (!s || !/^\d*\.?\d*$/.test(s) || s === ".") return null;
      var n = Number(s);
      if (!isFinite(n) || n < 0 || n > 50) return null;
      return Math.round(n * 100);
    }
    var map = { "0.1": 10, "0.5": 50, "1": 100 };
    return map[state.slip] == null ? null : map[state.slip];
  }
  function currentDeadline() {
    var n = Number(state.deadline);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > 4320) return null;
    return n;
  }
  function setEthPrice(n) {
    if (!(n > 0) || !isFinite(n)) return;
    state.ethUsd = n;
    state.priceScaled = parseUnits(n.toFixed(8), 8);
  }
  function labelDex(p) {
    var id = String((p && p.dexId) || "");
    var name = id ? id.charAt(0).toUpperCase() + id.slice(1) : "Pool";
    var labels = p && p.labels && p.labels.length ? " " + p.labels.join(" ") : "";
    return name + labels;
  }
  function ethPriceFromPair(p) {
    if (!p || !p.baseToken) return null;
    var weth = CFG.tokens.ETH.wrapped.toLowerCase();
    var base = String(p.baseToken.address || "").toLowerCase();
    var priceUsd = Number(p.priceUsd);
    var priceNative = Number(p.priceNative);
    if (base === weth && priceUsd > 0 && isFinite(priceUsd)) return priceUsd;
    if (base !== weth && priceNative > 0 && isFinite(priceNative)) {
      var eth = 1 / priceNative;
      if (eth > 0 && isFinite(eth)) return eth;
    }
    return null;
  }
  function pickReference(list) {
    var weth = CFG.tokens.ETH.wrapped.toLowerCase();
    var usdg = CFG.reference.quoteAddress.toLowerCase();
    var best = null;
    var bestLiq = -1;
    each(list || [], function (p) {
      if (!p || !p.baseToken || !p.quoteToken) return;
      var b = String(p.baseToken.address || "").toLowerCase();
      var q = String(p.quoteToken.address || "").toLowerCase();
      if (!((b === weth && q === usdg) || (b === usdg && q === weth))) return;
      var liq = Number(p.liquidity && p.liquidity.usd);
      if (!isFinite(liq)) liq = 0;
      if (liq > bestLiq) {
        bestLiq = liq;
        best = p;
      }
    });
    return best;
  }
  function applyPair(p) {
    var price = ethPriceFromPair(p);
    if (!price) return false;
    setEthPrice(price);
    var change = p.priceChange && p.priceChange.h24;
    state.ref = {
      price: price,
      change: change == null || change === "" ? null : Number(change),
      tvl: Number(p.liquidity && p.liquidity.usd),
      volume: Number(p.volume && p.volume.h24),
      dex: labelDex(p),
      url: p.url || (p.pairAddress ? "https://dexscreener.com/robinhood/" + p.pairAddress : ""),
      pair: "WETH/USDG"
    };
    if (!isFinite(state.ref.tvl)) state.ref.tvl = null;
    if (!isFinite(state.ref.volume)) state.ref.volume = null;
    if (state.ref.change != null && !isFinite(state.ref.change)) state.ref.change = null;
    state.priceError = null;
    return true;
  }
  function rememberPriceFailure(message) {
    state.priceError = state.ethUsd ? "Last good print held" : (message || "Live ETH price unavailable");
  }

  function quoteSwap(exactRaw) {
    var fromT = token(state.from);
    var toT = token(state.to);
    var exactT = state.exact === "from" ? fromT : toT;
    var otherT = state.exact === "from" ? toT : fromT;
    var parsed = parseAmount(exactRaw, exactT.decimals);
    if (!parsed.ok) {
      return { parsed: parsed, fromUnits: null, toUnits: null, otherText: "" };
    }
    if (!canPrice(fromT, toT)) {
      return { parsed: parsed, blocked: true, fromUnits: null, toUnits: null, otherText: "" };
    }
    var otherUnits = convertUnits(parsed.units, exactT, otherT);
    if (otherUnits == null) {
      return { parsed: parsed, blocked: true, fromUnits: null, toUnits: null, otherText: "" };
    }
    var fromUnits = state.exact === "from" ? parsed.units : otherUnits;
    var toUnits = state.exact === "from" ? otherUnits : parsed.units;
    return {
      parsed: parsed,
      fromUnits: fromUnits,
      toUnits: toUnits,
      otherText: formatUnits(otherUnits, otherT.decimals, fracFor(otherUnits, otherT.decimals), false)
    };
  }

  function slipLabel() {
    var bps = currentBps();
    if (bps == null) return "—";
    if (state.slip === "auto") return "Auto · " + formatPctFromBps(bps);
    return formatPctFromBps(bps);
  }

  function actionFor(quote) {
    var parsed = quote.parsed || { kind: "empty" };
    if (involvesMirai()) {
      return { id: "launch", label: "Trading opens at launch", enabled: false, hint: "MIRAI has no contract address yet (CA: soon). This button will not send a transaction." };
    }
    var w = state.wallet || {};
    if (!w.connected) {
      return { id: "connect", label: "Connect wallet", enabled: true, hint: "Connecting does not send a transaction. Trading stays a preview." };
    }
    if (parsed.kind === "empty" || parsed.kind === "zero") {
      return { id: "amount", label: "Enter an amount", enabled: false, hint: "Enter how much you want to swap. The other side follows the live ETH price." };
    }
    if (parsed.kind === "invalid") {
      return { id: "invalid", label: "Enter a valid amount", enabled: false, hint: "Use a positive number." };
    }
    if (parsed.kind === "huge") {
      return { id: "huge", label: "Amount is too large", enabled: false, hint: "Use a shorter amount." };
    }
    if (!w.onRobinhood) {
      return { id: "switch", label: "Switch to Robinhood Chain", enabled: true, hint: "Balances and the network fee are read on Robinhood Chain." };
    }
    if (currentBps() == null) {
      return { id: "slip", label: "Enter a valid slippage", enabled: false, hint: "Use a slippage from 0 to 50 percent." };
    }
    if (currentDeadline() == null) {
      return { id: "deadline", label: "Enter a deadline", enabled: false, hint: "Use a deadline from 1 to 4,320 minutes." };
    }
    var fromT = token(state.from);
    if (!state.ethUsd) {
      return {
        id: "price",
        label: state.priceError && state.priceError.indexOf("held") === -1 ? "Price unavailable" : "Waiting for a live price",
        enabled: false,
        hint: "The ETH price comes from DexScreener. Nothing is sent while it is missing."
      };
    }
    if (fromT.native && state.balanceStatus.ETH === "loading" && state.balances.ETH == null) {
      return { id: "check", label: "Checking balance", enabled: false, hint: "Reading the ETH balance on Robinhood Chain." };
    }
    if (fromT.native && state.balanceStatus.ETH === "ready" && state.balances.ETH != null && quote.fromUnits != null) {
      var reserve = state.feeWei || 0n;
      if (quote.fromUnits + reserve > state.balances.ETH) {
        return { id: "short", label: "Insufficient balance", enabled: false, hint: "That amount is above the ETH balance, after the network-fee estimate." };
      }
    }
    var hint = "Indicative price only. No router is called and no transaction is sent.";
    if (fromT.symbol === "USDC" || token(state.to).symbol === "USDC") {
      hint = "USDC is valued at 1 USD because no USDC contract is set. No transaction is sent.";
    }
    if (state.note) hint = state.note;
    return { id: "preview", label: "Preview only", enabled: false, hint: hint };
  }

  function balanceView(id) {
    var st = state.balanceStatus[id] || "off";
    var t = token(id);
    if (st === "loading") return { text: "…", title: "Reading balance" };
    if (st === "ready" && state.balances[id] != null) {
      return {
        text: formatUnits(state.balances[id], t.decimals, 6, true),
        title: "Balance on Robinhood Chain"
      };
    }
    if (st === "wrong") return { text: "—", title: "Switch to Robinhood Chain to read a balance" };
    if (st === "error") return { text: "—", title: "Could not read the balance" };
    if (st === "unset") {
      return { text: "—", title: t && t.ca === "soon" ? "CA soon" : "No contract address is set" };
    }
    return { text: "—", title: "Shown when a wallet is connected" };
  }

  function paintToken(side) {
    var id = side === "from" ? state.from : state.to;
    var sym = $(side === "from" ? "#fromSym" : "#toSym");
    var mark = $(side === "from" ? "#fromMark" : "#toMark");
    if (sym) sym.textContent = id;
    if (mark) {
      mark.textContent = markLetter(id);
      mark.setAttribute("data-symbol", id);
    }
    var view = balanceView(id);
    var bal = $(side === "from" ? "#fromBal" : "#toBal");
    var max = $(side === "from" ? "#fromMax" : "#toMax");
    if (bal) {
      bal.textContent = view.text;
      bal.title = view.title;
    }
    if (max) max.hidden = !(state.balanceStatus[id] === "ready" && state.balances[id] != null);
  }

  function renderSwap() {
    var fromEl = $("#fromAmount");
    var toEl = $("#toAmount");
    if (!fromEl || !toEl) return;
    paintToken("from");
    paintToken("to");
    var exactRaw = state.exact === "from" ? fromEl.value : toEl.value;
    var quote = quoteSwap(exactRaw);
    var otherEl = state.exact === "from" ? toEl : fromEl;
    if (document.activeElement !== otherEl) otherEl.value = quote.otherText || "";
    var fromT = token(state.from);
    var toT = token(state.to);
    var priced = canPrice(fromT, toT) && quote.fromUnits != null;
    var usd8 = priced ? toUsd8(quote.fromUnits, fromT) : null;
    var fromFiat = $("#fromFiat");
    var toFiat = $("#toFiat");
    var fiat = "";
    if (quote.parsed && quote.parsed.ok && (involvesMirai() || !priced)) fiat = "—";
    else if (usd8 != null) fiat = formatUsd8(usd8);
    if (fromFiat) {
      fromFiat.textContent = fiat;
      fromFiat.title = fromT.symbol === "USDC" ? "USDC shown at 1 USD. No USDC pool is configured." : "";
    }
    if (toFiat) {
      toFiat.textContent = fiat;
      toFiat.title = toT.symbol === "USDC" ? "USDC shown at 1 USD. No USDC pool is configured." : "";
    }

    var rateBtn = $("#rateBtn");
    if (rateBtn) {
      var live = !!(state.ethUsd && !involvesMirai());
      rateBtn.classList.toggle("is-live", live);
      if (involvesMirai()) rateBtn.textContent = "Trading opens at launch";
      else if (!state.ethUsd) rateBtn.textContent = state.priceError && state.priceError.indexOf("held") === -1 ? "Price unavailable" : "Fetching live price…";
      else if (state.invert) rateBtn.textContent = "1 USDC = " + formatUnits(parseUnits((1 / state.ethUsd).toFixed(8), 8), 8, 8, false) + " ETH";
      else rateBtn.textContent = "1 ETH = " + state.ethUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USDC";
    }
    var impact = $("#impactOut");
    if (impact) impact.textContent = "—";
    var minOut = $("#minOut");
    if (minOut) {
      var bps = currentBps();
      if (priced && quote.toUnits != null && bps != null && bps < 10000) {
        var minUnits = quote.toUnits * BigInt(10000 - bps) / 10000n;
        minOut.textContent = formatUnits(minUnits, toT.decimals, fracFor(minUnits, toT.decimals), true) + " " + toT.symbol;
        minOut.title = "Indicative, after slippage. Not an on-chain quote.";
      } else {
        minOut.textContent = "—";
        minOut.title = "";
      }
    }
    var feeOut = $("#feeOut");
    if (feeOut) {
      if (involvesMirai()) {
        feeOut.textContent = "—";
        feeOut.title = "No route, so no fee is estimated.";
      } else if (state.feeWei != null) {
        feeOut.textContent = formatFee();
        feeOut.title = CFG.swapGasUnits.toLocaleString("en-US") + " gas × the live gas price. An estimate, not a quote.";
      } else {
        feeOut.textContent = state.gasError ? "—" : "…";
        feeOut.title = state.gasError || "Fetching the live gas price…";
      }
    }
    var route = $("#routeOut");
    if (route) {
      if (involvesMirai()) route.textContent = "Opens at launch";
      else if (state.ref) route.textContent = "Indicative · " + state.ref.dex + " WETH/USDG · no swap is sent";
      else route.textContent = "—";
    }
    var slipOut = $("#slipOut");
    if (slipOut) slipOut.textContent = slipLabel();
    var deadlineOut = $("#deadlineOut");
    if (deadlineOut) {
      var mins = currentDeadline();
      deadlineOut.textContent = mins == null ? "—" : mins + " min";
    }
    var action = actionFor(quote);
    var btn = $("#swapAction");
    if (btn) {
      btn.textContent = action.label;
      btn.disabled = !action.enabled;
      btn.setAttribute("data-action", action.id);
    }
    var hint = $("#swapHint");
    if (hint) hint.textContent = action.hint || "";
    var banner = $("#launchBanner");
    if (banner) banner.hidden = !involvesMirai();
    each(document.querySelectorAll("#slipSeg [data-slip]"), function (b) {
      var on = b.getAttribute("data-slip") === state.slip;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var custom = $("#customSlipWrap");
    if (custom) custom.hidden = state.slip !== "custom";
    var help = $("#slipHelp");
    if (help) {
      var bpsNow = currentBps();
      help.classList.toggle("is-warn", bpsNow != null && bpsNow > 100);
      if (state.slip === "custom" && bpsNow == null) help.textContent = "Enter a slippage from 0 to 50.";
      else if (bpsNow != null && bpsNow > 100) help.textContent = "High slippage. The minimum sits well below the indicative price.";
      else if (state.slip === "auto") help.textContent = "Auto is " + formatPctFromBps(CFG.autoSlippageBps) + " on this preview.";
      else help.textContent = "Applied to the indicative amount only.";
    }
    renderAside();
  }

  function formatFee() {
    if (state.feeWei == null) return "—";
    var text = formatUnits(state.feeWei, 18, fracFor(state.feeWei, 18), false) + " ETH";
    if (state.priceScaled) {
      var usd8 = state.feeWei * state.priceScaled / pow10(18);
      text += " · " + formatUsd8(usd8);
    }
    return text;
  }

  function renderAside() {
    var price = $("#swapEthPrice");
    if (price) price.textContent = state.ethUsd ? formatUsdNumber(state.ethUsd) : (state.priceError ? "—" : "…");
    var change = $("#swapEthChange");
    if (change) {
      var n = state.ref && state.ref.change;
      if (n == null || !isFinite(n)) {
        change.textContent = state.ethUsd ? "24h change unavailable" : "";
        change.classList.remove("chg-up", "chg-down");
      } else {
        var sign = n > 0 ? "+" : "";
        change.textContent = sign + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "% · 24h";
        change.classList.toggle("chg-up", n > 0);
        change.classList.toggle("chg-down", n < 0);
      }
    }
    var source = $("#swapSource");
    if (source) {
      if (state.ref) {
        source.textContent = state.ref.dex + " · DexScreener · deepest WETH/USDG pool" + (state.priceError ? " · " + state.priceError : "");
      } else {
        source.textContent = state.priceError || "Fetching the live WETH/USDG pool…";
      }
    }
    var link = $("#refAsideLink");
    if (link) {
      if (state.ref && state.ref.url) {
        link.hidden = false;
        link.href = state.ref.url;
      } else {
        link.hidden = true;
      }
    }
    var list = $("#swapStatus");
    if (!list) return;
    var w = state.wallet || {};
    var walletLine = "Not connected";
    if (w.connected) walletLine = shortAddr(w.address) + (w.onRobinhood ? " · Robinhood Chain" : " · Wrong network");
    var rows = [
      ["Wallet", walletLine],
      ["ETH", "Native gas"],
      ["USDC", contractLine("USDC")],
      ["MIRAI", contractLine("MIRAI")],
      ["Execution", "Off · no transaction"]
    ];
    list.innerHTML = rows.map(function (row) {
      return "<li><span>" + esc(row[0]) + "</span><span>" + esc(row[1]) + "</span></li>";
    }).join("");
  }

  function contractLine(id) {
    var t = token(id);
    if (!t) return "—";
    if (t.ca === "soon" || (id === "MIRAI" && !t.address)) return "CA soon";
    if (!t.address) return "Address not set";
    return shortAddr(t.address);
  }

  function poolById(id) {
    var found = CFG.pools[0];
    each(CFG.pools, function (p) { if (p.id === id) found = p; });
    return found;
  }
  function poolLaunch(p) {
    return !!(p && (p.opensAtLaunch || p.base === "MIRAI" || p.quote === "MIRAI"));
  }
  function pairLabel(p) {
    return p.base + "/" + p.quote;
  }
  function pairSub(p) {
    if (poolLaunch(p)) return "Opens at launch";
    if (state.ethUsd && p.base === "ETH" && p.quote === "USDC") {
      return "Ref. " + formatUsdNumber(state.ethUsd) + " · no pool listed";
    }
    return "No pool listed";
  }
  function detailCopy(p) {
    if (poolLaunch(p)) {
      return "This pool is not live. MIRAI has no contract address (CA: soon), so fee tier, TVL, 24h volume, and APR are not shown and are not estimated.";
    }
    var price = state.ethUsd ? formatUsdNumber(state.ethUsd) : "still loading";
    return "No ETH/USDC pool is configured on this page. Robinhood Chain publishes USDG, not a canonical USDC address, so liquidity and volume are left blank. The live ETH price is " + price + " from the deepest WETH/USDG pool on DexScreener.";
  }
  function visiblePools() {
    var q = String(state.poolQuery || "").trim().toLowerCase();
    var list = CFG.pools.filter(function (p) {
      if (!q) return true;
      var blob = (pairLabel(p) + " " + p.base + " " + p.quote).toLowerCase();
      if (poolLaunch(p)) blob += " launch soon";
      return blob.indexOf(q) !== -1;
    });
    if (state.poolSort === "pair-asc" || state.poolSort === "pair-desc") {
      list = list.slice().sort(function (a, b) {
        var c = pairLabel(a).localeCompare(pairLabel(b));
        return state.poolSort === "pair-desc" ? -c : c;
      });
    }
    return list;
  }

  function renderPools() {
    var tb = $("#poolRows");
    if (!tb) return;
    var list = visiblePools();
    var note = $("#poolSortNote");
    var numeric = state.poolSort === "fee" || state.poolSort === "tvl" || state.poolSort === "volume" || state.poolSort === "apr";
    if (note) {
      note.hidden = !numeric;
      note.textContent = numeric ? "Fee tier, TVL, volume, and APR are not live, so this sort does not reorder the list." : "";
    }
    var count = $("#poolCount");
    if (count) {
      if (!CFG.pools.length) count.textContent = "";
      else if (!list.length) count.textContent = "No pools match";
      else count.textContent = list.length + (list.length === 1 ? " pool" : " pools");
    }
    if (!list.length) {
      tb.innerHTML = "<tr><td class=\"empty-cell\" colspan=\"6\">No pools match that search.</td></tr>";
      return;
    }
    tb.innerHTML = list.map(function (p) {
      var open = state.detail === p.id;
      return (
        "<tr>" +
          "<td data-label=\"Pair\"><span class=\"sym\">" + esc(pairLabel(p)) + "</span><div class=\"fine\">" + esc(pairSub(p)) + "</div></td>" +
          "<td class=\"num right\" data-label=\"Fee tier\">—</td>" +
          "<td class=\"num right\" data-label=\"TVL\">—</td>" +
          "<td class=\"num right\" data-label=\"Volume 24h\">—</td>" +
          "<td class=\"num right\" data-label=\"APR\">—</td>" +
          "<td data-label=\"Actions\"><div class=\"pool-actions\">" +
            "<button type=\"button\" class=\"btn btn-ghost btn-small\" data-liq=\"" + esc(p.id) + "\">Add liquidity</button>" +
            "<button type=\"button\" class=\"btn btn-ghost btn-small\" data-detail=\"" + esc(p.id) + "\" aria-expanded=\"" + (open ? "true" : "false") + "\">Details</button>" +
          "</div></td>" +
        "</tr>" +
        "<tr class=\"pool-detail\"" + (open ? "" : " hidden") + "><td colspan=\"6\"><p>" + esc(detailCopy(p)) + "</p></td></tr>"
      );
    }).join("");
  }

  function renderReference() {
    var price = $("#refPrice");
    var tvl = $("#refTvl");
    var vol = $("#refVol");
    var dex = $("#refDex");
    var change = $("#refChange");
    var link = $("#refLink");
    if (price) price.textContent = state.ethUsd ? formatUsdNumber(state.ethUsd) : (state.priceError ? "—" : "…");
    if (tvl) tvl.textContent = state.ref && state.ref.tvl != null ? formatCompactUsd(state.ref.tvl) : (state.priceError ? "—" : "…");
    if (vol) vol.textContent = state.ref && state.ref.volume != null ? formatCompactUsd(state.ref.volume) : (state.priceError ? "—" : "…");
    if (dex) {
      dex.textContent = state.ref
        ? state.ref.dex + " · DexScreener" + (state.priceError ? " · " + state.priceError : "")
        : (state.priceError || "Fetching DexScreener…");
    }
    if (change) {
      var n = state.ref && state.ref.change;
      if (n == null || !isFinite(n)) {
        change.textContent = "";
        change.classList.remove("chg-up", "chg-down");
      } else {
        var sign = n > 0 ? "+" : "";
        change.textContent = sign + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "% 24h";
        change.classList.toggle("chg-up", n > 0);
        change.classList.toggle("chg-down", n < 0);
      }
    }
    if (link) {
      if (state.ref && state.ref.url) {
        link.hidden = false;
        link.href = state.ref.url;
      } else link.hidden = true;
    }
  }

  function renderPositions() {
    var title = $("#positionsTitle");
    var copy = $("#positionsCopy");
    var connect = $("#positionsConnect");
    var sw = $("#positionsSwitch");
    var meta = $("#positionsMeta");
    var w = state.wallet || {};
    if (!title) return;
    if (!w.connected) {
      title.textContent = "No positions";
      copy.textContent = "Connect a wallet to prepare this view. No liquidity position is read — pool contracts are not set, and nothing is shown from chain.";
      if (connect) connect.hidden = false;
      if (sw) sw.hidden = true;
      if (meta) meta.textContent = "Wallet not connected";
      return;
    }
    if (connect) connect.hidden = true;
    if (!w.onRobinhood) {
      title.textContent = "Wrong network";
      copy.textContent = "Switch to Robinhood Chain. Positions are not read on this network, and Mirai pools are not live.";
      if (sw) sw.hidden = false;
      if (meta) meta.textContent = "Wrong network";
      return;
    }
    if (sw) sw.hidden = true;
    title.textContent = "No positions";
    copy.textContent = "No liquidity positions to show. Pool contracts are not set in the swap config, so this page does not query a position on chain. They will appear here after launch.";
    if (meta) meta.textContent = "None";
  }

  function renderLiq() {
    var pool = poolById(state.liq.poolId);
    var launch = poolLaunch(pool);
    var base = token(pool.base);
    var quote = token(pool.quote);
    var banner = $("#liqBanner");
    if (banner) banner.hidden = !launch;
    each(document.querySelectorAll("#liqPairs [data-liq-pair]"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-liq-pair") === pool.id ? "true" : "false");
    });
    each(document.querySelectorAll("#liqFees [data-liq-fee]"), function (b) {
      b.setAttribute("aria-pressed", Number(b.getAttribute("data-liq-fee")) === Number(state.liq.fee) ? "true" : "false");
    });
    var full = $("#liqRangeFull");
    var customBtn = $("#liqRangeCustom");
    if (full) full.setAttribute("aria-pressed", state.liq.range === "full" ? "true" : "false");
    if (customBtn) customBtn.setAttribute("aria-pressed", state.liq.range === "custom" ? "true" : "false");
    var custom = $("#liqCustom");
    if (custom) custom.hidden = state.liq.range !== "custom";
    paintLiqSide("A", base);
    paintLiqSide("B", quote);
    var aEl = $("#liqAmountA");
    var bEl = $("#liqAmountB");
    var exactEl = state.liq.exact === "a" ? aEl : bEl;
    var otherEl = state.liq.exact === "a" ? bEl : aEl;
    var exactT = state.liq.exact === "a" ? base : quote;
    var otherT = state.liq.exact === "a" ? quote : base;
    if (aEl && bEl && !launch && canPrice(base, quote)) {
      var parsed = parseAmount(exactEl.value, exactT.decimals);
      if (!parsed.ok) {
        if (document.activeElement !== otherEl) otherEl.value = "";
      } else {
        var units = convertUnits(parsed.units, exactT, otherT);
        if (units != null && document.activeElement !== otherEl) {
          otherEl.value = formatUnits(units, otherT.decimals, fracFor(units, otherT.decimals), false);
        }
      }
    }
    var line = $("#liqPriceLine");
    if (line) {
      var ref = state.ethUsd ? ("1 ETH = " + state.ethUsd.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " USDC") : "ETH price loading";
      if (state.liq.range === "full") {
        line.textContent = launch
          ? "Full range · 0 to ∞. A price for MIRAI is not set."
          : "Full range · 0 to ∞. Live reference " + ref + ". Not a deposit quote.";
      } else if (launch || !canPrice(base, quote)) {
        line.textContent = "Custom range. No live price for this pair — min and max are not quoted.";
      } else {
        line.textContent = "Custom range in " + quote.symbol + " per " + base.symbol + ". Live reference " + ref + ".";
      }
      var min = $("#liqMin");
      var max = $("#liqMaxPrice");
      if (state.liq.range === "custom" && min && max && min.value.trim() && max.value.trim()) {
        var lo = Number(min.value);
        var hi = Number(max.value);
        if (isFinite(lo) && isFinite(hi) && lo >= hi) line.textContent += " Min should be below max.";
      }
    }
    var submit = $("#liqSubmit");
    if (submit) {
      submit.disabled = true;
      submit.textContent = launch ? "Opens at launch" : "Not available yet";
    }
    var hint = $("#liqHint");
    if (hint) {
      hint.textContent = launch
        ? "MIRAI pools open at launch. This button will not send a transaction."
        : "No ETH/USDC pool is configured, and this form does not send a transaction.";
    }
  }

  function paintLiqSide(letter, t) {
    var id = t.symbol;
    var sym = $("#liqSym" + letter);
    var mark = $("#liqMark" + letter);
    var label = $("#liqLabel" + letter);
    if (sym) sym.textContent = id;
    if (mark) {
      mark.textContent = markLetter(id);
      mark.setAttribute("data-symbol", id);
    }
    if (label) label.textContent = "Deposit " + id;
    var view = balanceView(id);
    var bal = $("#liqBal" + letter);
    var max = $("#liqMax" + letter);
    if (bal) {
      bal.textContent = view.text;
      bal.title = view.title;
    }
    if (max) max.hidden = !(state.balanceStatus[id] === "ready" && state.balances[id] != null);
  }

  function render() {
    renderSwap();
    renderPools();
    renderReference();
    renderPositions();
    renderLiq();
  }

  function setModal(el, open) {
    if (!el) return;
    el.hidden = !open;
    var any = document.querySelector(".modal:not([hidden])");
    document.body.style.overflow = any ? "hidden" : "";
  }
  function closeSettings() {
    var panel = $("#swapSettings");
    var gear = $("#swapGear");
    if (panel) panel.hidden = true;
    if (gear) gear.setAttribute("aria-expanded", "false");
  }
  function closeToken() {
    setModal($("#tokenModal"), false);
    if (state.returnFocus && state.returnFocus.focus) {
      try { state.returnFocus.focus(); } catch (e) {}
    }
  }
  function closeLiq() {
    setModal($("#liqModal"), false);
  }
  function openToken(side) {
    closeSettings();
    state.picking = side;
    state.returnFocus = document.activeElement;
    var search = $("#tokenSearch");
    if (search) search.value = "";
    setModal($("#tokenModal"), true);
    renderTokenList();
    if (search) search.focus();
  }
  function selectToken(id) {
    var other = state.picking === "from" ? "to" : "from";
    if (state[other] === id) {
      var tmp = state.from;
      state.from = state.to;
      state.to = tmp;
    } else {
      state[state.picking] = id;
    }
    closeToken();
    render();
  }
  function renderTokenList() {
    var list = $("#tokenList");
    var search = $("#tokenSearch");
    if (!list) return;
    var q = String(search && search.value || "").trim().toLowerCase();
    list.innerHTML = "";
    var shown = 0;
    each(["ETH", "USDC", "MIRAI"], function (id) {
      var t = token(id);
      var blob = (t.symbol + " " + t.name + (t.ca === "soon" ? " ca soon" : "")).toLowerCase();
      if (q && blob.indexOf(q) === -1) return;
      shown++;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wallet-item token-item";
      btn.setAttribute("role", "option");
      btn.setAttribute("data-token", id);
      var selected = (state.picking === "from" ? state.from : state.to) === id;
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      var mark = document.createElement("span");
      mark.className = "token-mark";
      mark.setAttribute("data-symbol", id);
      mark.textContent = markLetter(id);
      var copy = document.createElement("span");
      copy.className = "token-item-copy";
      var strong = document.createElement("strong");
      strong.textContent = t.symbol;
      var fine = document.createElement("span");
      fine.className = "fine";
      if (t.ca === "soon") fine.textContent = t.name + " · CA soon";
      else if (!t.address && !t.native) fine.textContent = t.name + " · address not set";
      else if (t.native) fine.textContent = t.name + " · native" + (t.wrapped ? " · WETH " + shortAddr(t.wrapped) : "");
      else fine.textContent = t.name + " · " + shortAddr(t.address);
      copy.appendChild(strong);
      copy.appendChild(fine);
      btn.appendChild(mark);
      btn.appendChild(copy);
      if (t.ca === "soon") {
        var badge = document.createElement("span");
        badge.className = "soon-badge";
        badge.textContent = "CA soon";
        btn.appendChild(badge);
      }
      btn.addEventListener("click", function () { selectToken(id); });
      list.appendChild(btn);
    });
    if (!shown) {
      var empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No token matches.";
      list.appendChild(empty);
    }
  }
  function openLiq(id) {
    closeSettings();
    state.liq.poolId = id || state.liq.poolId;
    state.liq.exact = "a";
    var a = $("#liqAmountA");
    var b = $("#liqAmountB");
    if (a) a.value = "";
    if (b) b.value = "";
    setModal($("#liqModal"), true);
    renderLiq();
    var closer = $("#liqClose");
    if (closer) closer.focus();
  }
  function applyMax(which) {
    var id = which === "from" ? state.from : which === "to" ? state.to : which;
    var field = which === "from" ? "from" : which === "to" ? "to" : null;
    if (which === "A" || which === "B") {
      var pool = poolById(state.liq.poolId);
      id = which === "A" ? pool.base : pool.quote;
    }
    if (state.balanceStatus[id] !== "ready" || state.balances[id] == null) return;
    var spend = state.balances[id];
    var t = token(id);
    if (t.native && state.feeWei != null) {
      spend = spend > state.feeWei ? spend - state.feeWei : 0n;
    }
    if (spend <= 0n) {
      state.note = "Balance is below the network fee estimate.";
      render();
      return;
    }
    state.note = "";
    var text = formatUnits(spend, t.decimals, Math.min(8, t.decimals), false);
    if (which === "A" || which === "B") {
      state.liq.exact = which === "A" ? "a" : "b";
      var input = $(which === "A" ? "#liqAmountA" : "#liqAmountB");
      if (input) input.value = text;
      renderLiq();
      return;
    }
    state.exact = field;
    var el = $(field === "from" ? "#fromAmount" : "#toAmount");
    if (el) el.value = text;
    render();
  }

  function refreshMarket() {
    var seq = ++marketSeq;
    var primary = "https://api.dexscreener.com/token-pairs/v1/robinhood/" + CFG.tokens.ETH.wrapped;
    function useFallback() {
      var url = "https://api.dexscreener.com/latest/dex/pairs/robinhood/" + CFG.reference.fallbackPair;
      return fetch(url, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw new Error("DexScreener " + res.status);
        return res.json();
      }).then(function (data) {
        if (seq !== marketSeq) return;
        var pair = data && data.pairs && data.pairs[0];
        if (!pair || !applyPair(pair)) throw new Error("No ETH price");
        render();
      });
    }
    return fetch(primary, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("DexScreener " + res.status);
      return res.json();
    }).then(function (data) {
      if (seq !== marketSeq) return;
      var list = Array.isArray(data) ? data : ((data && data.pairs) || []);
      var best = pickReference(list);
      if (best && applyPair(best)) {
        render();
        return;
      }
      return useFallback();
    }).catch(function () {
      if (seq !== marketSeq) return;
      return useFallback().catch(function () {
        if (seq !== marketSeq) return;
        rememberPriceFailure("Live ETH price unavailable");
        render();
      });
    });
  }

  function refreshGas() {
    var seq = ++gasSeq;
    return fetch(CFG.rpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] })
    }).then(function (res) {
      if (!res.ok) throw new Error("gas " + res.status);
      return res.json();
    }).then(function (body) {
      if (seq !== gasSeq) return;
      if (!body || !body.result) throw new Error("no gas");
      state.gasWei = BigInt(body.result);
      state.feeWei = state.gasWei * BigInt(CFG.swapGasUnits);
      state.gasError = null;
      render();
    }).catch(function () {
      if (seq !== gasSeq) return;
      state.gasError = state.feeWei == null ? "Network fee unavailable" : "Last fee estimate held";
      render();
    });
  }

  function encodeBalanceOf(owner) {
    var hex = String(owner || "").toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(hex)) return null;
    return "0x70a08231" + repeat("0", 24) + hex;
  }
  function readBalance(w, t) {
    if (!w || !w.provider || typeof w.provider.request !== "function") {
      return Promise.reject(new Error("no provider"));
    }
    if (t.native) {
      return w.provider.request({ method: "eth_getBalance", params: [w.address, "latest"] }).then(hexToBig);
    }
    var data = encodeBalanceOf(w.address);
    if (!data || !t.address) return Promise.reject(new Error("no contract"));
    return w.provider.request({
      method: "eth_call",
      params: [{ to: t.address, data: data }, "latest"]
    }).then(hexToBig);
  }
  function refreshBalances() {
    var w = state.wallet || { connected: false };
    var ids = ["ETH", "USDC", "MIRAI"];
    if (!w.connected) {
      each(ids, function (id) {
        state.balanceStatus[id] = "off";
        state.balances[id] = null;
      });
      render();
      return;
    }
    if (!w.onRobinhood) {
      each(ids, function (id) {
        state.balanceStatus[id] = "wrong";
        state.balances[id] = null;
      });
      render();
      return;
    }
    var seq = ++balanceSeq;
    each(ids, function (id) {
      var t = token(id);
      if (!t.native && !t.address) {
        state.balanceStatus[id] = "unset";
        state.balances[id] = null;
        return;
      }
      if (state.balanceStatus[id] !== "ready") state.balanceStatus[id] = "loading";
      readBalance(w, t).then(function (units) {
        if (seq !== balanceSeq) return;
        state.balances[id] = units;
        state.balanceStatus[id] = "ready";
        render();
      }).catch(function () {
        if (seq !== balanceSeq) return;
        state.balances[id] = null;
        state.balanceStatus[id] = "error";
        render();
      });
    });
    render();
  }
  function onWallet(snap) {
    state.wallet = snap || { connected: false };
    state.note = "";
    refreshBalances();
  }

  function buildLiqControls() {
    var pairs = $("#liqPairs");
    var fees = $("#liqFees");
    if (pairs) {
      pairs.innerHTML = "";
      each(CFG.pools, function (p) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = pairLabel(p);
        b.setAttribute("data-liq-pair", p.id);
        b.addEventListener("click", function () {
          state.liq.poolId = p.id;
          state.liq.exact = "a";
          var a = $("#liqAmountA");
          var bIn = $("#liqAmountB");
          if (a) a.value = "";
          if (bIn) bIn.value = "";
          renderLiq();
        });
        pairs.appendChild(b);
      });
    }
    if (fees) {
      fees.innerHTML = "";
      each(CFG.feeTiers, function (fee) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = formatTier(fee);
        b.setAttribute("data-liq-fee", String(fee));
        b.addEventListener("click", function () {
          state.liq.fee = fee;
          renderLiq();
        });
        fees.appendChild(b);
      });
    }
  }

  function watchNav() {
    var nodes = document.querySelectorAll(".nav a[href^=\"#\"]");
    if (!nodes.length || !("IntersectionObserver" in window)) return;
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      each(entries, function (entry) {
        visible[entry.target.id] = entry.isIntersecting;
      });
      var current = "";
      each(nodes, function (a) {
        var id = (a.getAttribute("href") || "").slice(1);
        if (!current && visible[id]) current = id;
      });
      each(nodes, function (a) {
        if (current && a.getAttribute("href") === "#" + current) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }, { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.15] });
    each(nodes, function (a) {
      var el = document.getElementById((a.getAttribute("href") || "").slice(1));
      if (el) io.observe(el);
    });
  }

  function bind() {
    var fromEl = $("#fromAmount");
    var toEl = $("#toAmount");
    if (fromEl) fromEl.addEventListener("input", function () { state.exact = "from"; state.note = ""; render(); });
    if (toEl) toEl.addEventListener("input", function () { state.exact = "to"; state.note = ""; render(); });
    var fromToken = $("#fromTokenBtn");
    var toToken = $("#toTokenBtn");
    if (fromToken) fromToken.addEventListener("click", function () { openToken("from"); });
    if (toToken) toToken.addEventListener("click", function () { openToken("to"); });
    var flip = $("#swapFlip");
    if (flip) flip.addEventListener("click", function () {
      var tmp = state.from;
      state.from = state.to;
      state.to = tmp;
      state.exact = "from";
      flip.classList.toggle("is-flipped");
      render();
    });
    var fromMax = $("#fromMax");
    var toMax = $("#toMax");
    if (fromMax) fromMax.addEventListener("click", function () { applyMax("from"); });
    if (toMax) toMax.addEventListener("click", function () { applyMax("to"); });
    var gear = $("#swapGear");
    var settings = $("#swapSettings");
    if (gear) gear.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = settings.hidden;
      settings.hidden = !open;
      gear.setAttribute("aria-expanded", open ? "true" : "false");
    });
    if (settings) settings.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function () { closeSettings(); });
    each(document.querySelectorAll("#slipSeg [data-slip]"), function (b) {
      b.addEventListener("click", function () {
        state.slip = b.getAttribute("data-slip");
        render();
      });
    });
    var custom = $("#customSlip");
    if (custom) custom.addEventListener("input", function () {
      state.customSlip = custom.value;
      state.slip = "custom";
      render();
    });
    var deadline = $("#deadlineInput");
    if (deadline) {
      state.deadline = deadline.value;
      deadline.addEventListener("input", function () {
        state.deadline = deadline.value;
        render();
      });
    }
    var rate = $("#rateBtn");
    if (rate) rate.addEventListener("click", function () {
      if (!state.ethUsd || involvesMirai()) return;
      state.invert = !state.invert;
      render();
    });
    var action = $("#swapAction");
    if (action) action.addEventListener("click", function () {
      var id = action.getAttribute("data-action");
      if (!window.MiraiDesk) return;
      if (id === "connect") window.MiraiDesk.openWallet();
      if (id === "switch") {
        window.MiraiDesk.switchChain().catch(function (err) {
          if (err && (err.code === 4001 || /reject|denied|cancel/i.test(String(err.message || "")))) return;
          state.note = (err && err.message) ? err.message : "Could not switch network.";
          render();
        });
      }
    });
    var search = $("#tokenSearch");
    if (search) {
      search.addEventListener("input", renderTokenList);
      search.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var items = document.querySelectorAll("#tokenList [data-token]");
        if (items.length === 1) {
          e.preventDefault();
          selectToken(items[0].getAttribute("data-token"));
        }
      });
    }
    var tokenClose = $("#tokenClose");
    var tokenVeil = $("#tokenVeil");
    if (tokenClose) tokenClose.addEventListener("click", closeToken);
    if (tokenVeil) tokenVeil.addEventListener("click", closeToken);
    var rows = $("#poolRows");
    if (rows) rows.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-liq], [data-detail]") : null;
      if (!t) return;
      if (t.hasAttribute("data-liq")) openLiq(t.getAttribute("data-liq"));
      if (t.hasAttribute("data-detail")) {
        var id = t.getAttribute("data-detail");
        state.detail = state.detail === id ? "" : id;
        renderPools();
      }
    });
    var poolSearch = $("#poolSearch");
    if (poolSearch) poolSearch.addEventListener("input", function () {
      state.poolQuery = poolSearch.value;
      renderPools();
    });
    var poolSort = $("#poolSort");
    if (poolSort) poolSort.addEventListener("change", function () {
      state.poolSort = poolSort.value;
      renderPools();
    });
    var liqA = $("#liqAmountA");
    var liqB = $("#liqAmountB");
    if (liqA) liqA.addEventListener("input", function () { state.liq.exact = "a"; renderLiq(); });
    if (liqB) liqB.addEventListener("input", function () { state.liq.exact = "b"; renderLiq(); });
    var maxA = $("#liqMaxA");
    var maxB = $("#liqMaxB");
    if (maxA) maxA.addEventListener("click", function () { applyMax("A"); });
    if (maxB) maxB.addEventListener("click", function () { applyMax("B"); });
    var rangeFull = $("#liqRangeFull");
    var rangeCustom = $("#liqRangeCustom");
    if (rangeFull) rangeFull.addEventListener("click", function () { state.liq.range = "full"; renderLiq(); });
    if (rangeCustom) rangeCustom.addEventListener("click", function () { state.liq.range = "custom"; renderLiq(); });
    var liqMin = $("#liqMin");
    var liqMaxPrice = $("#liqMaxPrice");
    if (liqMin) liqMin.addEventListener("input", renderLiq);
    if (liqMaxPrice) liqMaxPrice.addEventListener("input", renderLiq);
    var liqClose = $("#liqClose");
    var liqVeil = $("#liqVeil");
    if (liqClose) liqClose.addEventListener("click", closeLiq);
    if (liqVeil) liqVeil.addEventListener("click", closeLiq);
    var posSwitch = $("#positionsSwitch");
    if (posSwitch) posSwitch.addEventListener("click", function () {
      if (!window.MiraiDesk) return;
      window.MiraiDesk.switchChain().catch(function () {});
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var tokenModal = $("#tokenModal");
      var liqModal = $("#liqModal");
      if (tokenModal && !tokenModal.hidden) { closeToken(); return; }
      if (liqModal && !liqModal.hidden) { closeLiq(); return; }
      closeSettings();
    });
  }

  function miraiToken() {
    return CFG.tokens.MIRAI;
  }
  function miraiContract() {
    var addr = miraiToken() && miraiToken().address;
    if (typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr)) return addr;
    return null;
  }
  function formatSupply(raw) {
    if (raw == null || raw === "") return null;
    var s = String(raw).trim().replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var frac = parts[1] ? parts[1].replace(/0+$/, "") : "";
    return frac ? parts[0] + "." + frac : parts[0];
  }
  function curveLive() {
    var curve = (miraiToken() && miraiToken().curve) || {};
    return curve.status === "live" || curve.status === "graduated";
  }
  function paintCaChips(addr) {
    var label = addr ? "CA: " + shortAddr(addr) : "CA: soon";
    var title = addr ? addr : "Contract address not set";
    each(document.querySelectorAll(".ca-chip, .ca-inline"), function (el) {
      el.textContent = label;
      el.title = title;
    });
  }
  function renderMirai() {
    var token = miraiToken();
    if (!$("#mirai")) return;
    var addr = miraiContract();
    var ca = $("#miraiCa");
    if (ca) ca.textContent = addr || "CA: soon";
    var copy = $("#miraiCopy");
    if (copy) {
      copy.disabled = !addr;
      copy.textContent = "Copy";
      copy.setAttribute("aria-label", addr ? "Copy the $MIRAI contract address" : "Copy is off until the contract address is set");
    }
    paintCaChips(addr);
    var curve = (token && token.curve) || {};
    var live = curveLive();
    var status = $("#miraiCurveStatus");
    var statusText = "Launching soon";
    if (live && curve.status === "graduated") statusText = "Graduated";
    else if (live) statusText = "On the curve";
    if (status) status.textContent = statusText;
    var progress = live && typeof curve.progress === "number" && isFinite(curve.progress)
      ? Math.min(1, Math.max(0, curve.progress))
      : 0;
    var pct = Math.round(progress * 100);
    var fill = $("#miraiBarFill");
    var bar = $("#miraiBar");
    if (fill) fill.style.width = pct + "%";
    if (bar) {
      bar.setAttribute("aria-valuenow", String(pct));
      bar.setAttribute("aria-valuetext", live ? pct + "% of the curve" : "Launching soon");
    }
    var onCurve = $("#miraiOnCurve");
    var circ = $("#miraiCirc");
    var supply = $("#miraiSupply");
    if (onCurve) onCurve.textContent = live ? (formatSupply(curve.onCurve) || "—") : "—";
    if (circ) circ.textContent = live ? (formatSupply(curve.circulating) || "—") : "—";
    if (supply) supply.textContent = formatSupply(token && token.supply) || "—";
    var mcap = $("#miraiMcap");
    var mcapLabel = $("#miraiMcapLabel");
    var cap = token && typeof token.marketCapUsd === "number" && isFinite(token.marketCapUsd) && token.marketCapUsd > 0
      ? token.marketCapUsd
      : null;
    if (mcap) mcap.textContent = cap == null ? "—" : formatUsdNumber(cap);
    if (mcapLabel) mcapLabel.textContent = cap == null ? "Live at launch" : "From the token config";
  }
  function copyMiraiCa() {
    var addr = miraiContract();
    var stateEl = $("#miraiCopyState");
    var btn = $("#miraiCopy");
    if (!addr || !btn || btn.disabled) return;
    function copied() {
      btn.textContent = "Copied";
      if (stateEl) stateEl.textContent = "Address copied.";
      setTimeout(function () {
        btn.textContent = "Copy";
        if (stateEl) stateEl.textContent = "";
      }, 1600);
    }
    function fallback() {
      var area = document.createElement("textarea");
      area.value = addr;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(area);
      if (!ok) throw new Error("copy");
    }
    var pending = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(addr)
      : Promise.reject(new Error("no clipboard"));
    pending.then(copied).catch(function () {
      try {
        fallback();
        copied();
      } catch (err) {
        if (stateEl) stateEl.textContent = "Could not copy. Select the address instead.";
      }
    });
  }
  function initMiraiPage() {
    renderMirai();
    var btn = $("#miraiCopy");
    if (btn) btn.addEventListener("click", copyMiraiCa);
  }

  function init() {
    if (!$("#swapAction")) return;
    buildLiqControls();
    initMiraiPage();
    bind();
    watchNav();
    document.addEventListener("mirai:wallet", function (e) { onWallet(e.detail); });
    var snap = window.MiraiDesk && window.MiraiDesk.getWallet ? window.MiraiDesk.getWallet() : { connected: false };
    onWallet(snap);
    refreshMarket();
    refreshGas();
    setInterval(function () {
      refreshMarket();
      refreshGas();
      refreshBalances();
    }, CFG.refreshMs);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
