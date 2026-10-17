# Nadbell

**The price freezes at the close. This market doesn't.**

Nadbell is a 24/7 mock tokenized-stock market on Monad testnet. While NYSE is open, a keeper relays the real AAPL price and the market tracks it. After the bell the official price freezes, but Nadbell's onchain order book keeps trading, so you can see the weekend price form, call where Monday will open, and get scored against the real open.

> Testnet demo only. tAAPL and tUSDC are mock tokens with no value. They are not issued by or affiliated with Apple, Nasdaq, Alpaca, Robinhood, Kraken, Dinari, Ondo or Anchored, and represent no ownership, claim or economic right in any security. Prices come from Alpaca's free IEX feed, relayed by a single keeper. Not investment advice and not an offer of securities. Do not deploy to mainnet.

## What a user does

1. **Connect** a wallet (MetaMask, Rabby, Phantom). Nadbell adds Monad testnet.
2. **Get test MON** for gas from https://faucet.monad.xyz, then **Get $5,000** test dollars in one tap.
3. **Buy $100 of tAAPL** or **Sell all**: one wallet confirmation, no approval pop-ups. Orders fill immediately at the best prices (never more than 1% past the top of the book) and anything unfilled comes straight back.
4. **When the market closes**, the banner says so and counts down to the reopen. Trading continues; a **Call the open** card lets anyone lock a free guess at Monday's opening price.
5. **At the reopen**, a **Last reopen** card shows the close, what this market said, and the real open, plus how close each call was and a leaderboard.

Limit orders, mint/redeem and an explainer live under **Advanced**.

## How it works

| Piece | What it does |
|---|---|
| `PriceGate` | Official price + market state. The keeper `push()`es during regular hours (the first push after a close reopens the market) and `close()`s after the bell. Rejects a push >15% from the last one (owner can `forcePush`). Can also take Pyth pull updates. |
| `OrderBook` | Fully onchain limit order book, tAAPL/tUSDC, trades 24/7. Best price first, then first come. `placeLimit` rests leftovers; `placeIOC` (the Buy/Sell buttons) refunds them. Max 20 fills per call; the book can never be left crossed. |
| `OpenCall` | "Call the open." Calls are free and allowed only while closed. On reopen, PriceGate notifies it and it records the close, the last weekend trade and the open. Scoring happens in views/frontend. |
| `Vault` | Mint/redeem at the official price ± 0.5%, only while the market is open (like an issuer). |
| `StockToken` (tAAPL) | ERC-20 with a display multiplier for dividends/splits (ERC-8056 draft, as used by Robinhood Stock Tokens). |
| `MockUSDC` (tUSDC) | Faucet dollar. |
| Trusted spenders | On testnet, tUSDC/tAAPL let Nadbell's own vault and book move funds without `approve()`, so every action is one confirmation. Never do this with real-value tokens. |
| Keeper + maker bot (`keeper/`) | Runs every 5 minutes on GitHub Actions. Uses Alpaca's market clock (falls back to a built-in NYSE calendar with 2026–27 holidays), pushes Alpaca's latest IEX trade while open, rings the bell after close. The maker keeps two buy and two sell quotes on the book: tight around the official price while open, wider around the last trade while closed so users move the weekend price. It only re-quotes when quotes drift >0.15% (open) / 0.30% (closed) or get filled. |

Why a keeper and not an oracle: as of October 2026 there is no free US-equity oracle on Monad testnet. Pyth Hermes needs a paid key since Aug 26, 2026 and moved extended hours to paid Pyth Pro; Chainlink ended its Data Streams free tier on Sept 1, 2026. The keeper is honest about it: the app names the source and shows how old the price is.

## Repo layout

```
contracts/          Foundry project (src, test, script)
keeper/             keeper + maker bot (Node, viem)
app/                web app (TanStack Start + React + viem), started in Grok's app builder
.github/workflows/  keeper.yml: runs the keeper every 5 minutes
```

## Setup

### 1. Contracts

```bash
cd contracts
npm install                  # OpenZeppelin, Pyth SDK, forge-std
forge test                   # 26 tests, incl. a randomized escrow/no-cross check
```

Deploy to Monad testnet from a testnet-only wallet with some MON. Set `START_PRICE_CENTS` to roughly today's AAPL price so the first keeper push isn't rejected by the 15% guard:

```bash
START_PRICE_CENTS=22300 forge script script/Deploy.s.sol \
  --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
```

Addresses land in `contracts/deployments/10143.json`. Verify on MonadVision: https://docs.monad.xyz/guides/verify-smart-contract

### 2. Sync addresses into the app and keeper

```bash
cd app && npm install && npm run sync:contracts
```

### 3. Keeper

1. Make a free Alpaca account at https://alpaca.markets and create **paper trading** API keys (they work for the free IEX market data and the market clock).
2. Push this repo to GitHub. In **Settings → Secrets and variables → Actions**, add `KEEPER_PK` (the deployer key, or a separate keeper wallet set with `KEEPER_ADDRESS` at deploy), `ALPACA_KEY_ID` and `ALPACA_SECRET`.
3. The `keeper` workflow then runs every 5 minutes. Use **Run workflow** once to test it.

Try it locally first: `cd keeper && npm install && KEEPER_PK=… ALPACA_KEY_ID=… ALPACA_SECRET=… DRY_RUN=1 node keeper.mjs`.

Gas: most runs send 0–1 transactions (a price push). A full re-quote is up to ~9. Keep a few MON in the keeper wallet; it logs a warning below 1 MON. GitHub can delay scheduled runs, so a price stays "fresh" for 30 minutes (`MAX_AGE`).

### 4. App

```bash
cd app
npm run dev                  # http://localhost:8080, reads Monad testnet by default
```

Deploy it like any Vite app (it was built in Grok's app builder and ships with Vercel output config). Local chain: run `anvil`, deploy with `--rpc-url http://127.0.0.1:8545`, sync, then `VITE_CHAIN_ID=31337 npm run dev`. `VITE_DEV_PK` signs with a local burner key; never set it on a public deploy.

The deployer wallet sees **Keeper controls** under Advanced (push a price, ring the bell) for testing without waiting for the schedule.

## Known limits

- One stock, one book. Every order touches the same storage, so Monad's parallel execution doesn't speed this book up.
- The price comes from IEX, about 2.5% of US volume, relayed by one keeper. It's a showcase, not an oracle.
- The leaderboard covers the last 8 reopens and is computed in the browser. `OpenCall` caps a session at 1,000 callers.
- The built-in NYSE calendar covers 2026–27; Alpaca's clock is used when keys are set.
