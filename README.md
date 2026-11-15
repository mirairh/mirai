# Mirai

Neo-Tokyo styled live market site for a planned project on Robinhood Chain via Pons.

![Mirai desktop preview](screens/desktop.jpg)

Mirai is a static desk for stock-token markets: dark indigo, neon crimson, violet, and cyan, with the 未来 mark. The board shows live pool prices. The contract address is **CA: soon**.

The page is plain HTML, CSS, and JavaScript. There is no build step.

## Features

- **Live prices.** Last price, 24h change, volume, and liquidity come from Robinhood Chain USDG pools (DexScreener). Historical candles (15m / 1h / 4h / 1d) come from GeckoTerminal. Quotes refresh about every 20 seconds.
- **Animated UI.** Perspective grid, particles, scanlines, scroll reveals, a live ticker, chart draw-in, and a wireframe hero. Motion follows `prefers-reduced-motion`.
- **Multi-wallet connect.** EIP-6963 lists injected wallets such as MetaMask, OKX Wallet, and Rabby, with a fallback to `window.ethereum` / `window.okxwallet`.
- **Robinhood Chain.** After you approve accounts, the page switches to or adds Robinhood Chain mainnet, chain ID **4663** (RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`).

Connecting a wallet never sends a transaction. The trading ticket and comparison slider are a preview: no order is routed and no deposit is taken. If the US cash equity session is closed, the last live token price is still shown.

## Run locally

The page must be served over HTTP. Opening `index.html` as a `file://` URL can block the quote APIs.

```bash
python -m http.server
```

Then open [http://127.0.0.1:8000/](http://127.0.0.1:8000/).

## Links

- Website: https://mirairh.com
- X: https://x.com/mirairh_
- GitHub: https://github.com/mirairh/mirai

## License

[MIT](LICENSE)
