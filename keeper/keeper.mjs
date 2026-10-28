#!/usr/bin/env node
// Nadbell keeper + maker bot. Runs once and exits; schedule it every 5 minutes.
//
// 1. Keeper: while NYSE is open, pushes Alpaca's latest IEX trade price to PriceGate.
//    After the bell it calls close(), which freezes the price until the next open.
// 2. Maker bot: keeps a few buy and sell orders on the book so users' trades fill.
//    Quotes sit tight around the official price while open, and wider around the last
//    trade while closed, so weekend trades can move the price. It only re-quotes when
//    its orders have drifted or been filled, to save testnet gas.
//
// Env:
//   KEEPER_PK              private key of the keeper/maker wallet (required)
//   CHAIN_ID               10143 (Monad testnet, default) or 31337 (local anvil)
//   RPC_URL                default: Monad public testnet RPC
//   ALPACA_KEY_ID, ALPACA_SECRET   free Alpaca paper/market-data keys
//   SYMBOL                 default AAPL
//   MAKER                  "off" to disable the maker bot
//   DRY_RUN                "1" to log actions without sending transactions
//   ALPACA_DATA_URL, ALPACA_CLOCK_URL   override endpoints (tests)
//   PRICE_OVERRIDE         dollars; skip Alpaca price fetch (tests)
//   MARKET_OVERRIDE        "open" | "closed"; skip the clock (tests)

import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isRegularOpen } from "./nyse.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { abis, deployments } = JSON.parse(fs.readFileSync(path.join(here, "contracts.json"), "utf8"));

const env = process.env;
const CHAIN_ID = Number(env.CHAIN_ID ?? 10143);
const RPC_URL = env.RPC_URL ?? (CHAIN_ID === 31337 ? "http://127.0.0.1:8545" : "https://testnet-rpc.monad.xyz");
const SYMBOL = env.SYMBOL ?? "AAPL";
const DRY = env.DRY_RUN === "1";
const MAKER = env.MAKER !== "off";
const DATA_URL = env.ALPACA_DATA_URL ?? "https://data.alpaca.markets";
const CLOCK_URL = env.ALPACA_CLOCK_URL ?? "https://paper-api.alpaca.markets";

const addr = deployments[CHAIN_ID];
if (!addr) throw new Error(`No deployment for chain ${CHAIN_ID} in contracts.json`);
if (!env.KEEPER_PK) throw new Error("KEEPER_PK is required");

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 10143 ? "Monad Testnet" : `chain-${CHAIN_ID}`,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const account = privateKeyToAccount(env.KEEPER_PK);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ chain, account, transport: http(RPC_URL) });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const read = (contract, functionName, args = []) =>
  pub.readContract({ address: addr[contract], abi: abis[nameOf[contract]], functionName, args });
const nameOf = { usdc: "MockUSDC", stock: "StockToken", gate: "PriceGate", vault: "Vault", book: "OrderBook", openCall: "OpenCall" };

const FAUCET = "https://faucet.monad.xyz";
// Below this the maker bot stands down so the remaining MON goes to price pushes and the bell.
// A full re-quote costs ~0.1-0.2 MON on Monad testnet.
const MAKER_MIN_WEI = BigInt(Math.round(Number(env.MAKER_MIN_MON ?? 0.5) * 1e18));
const fmtMon = (wei) => (Number(wei) / 1e18).toFixed(4);
// GitHub Actions turns these into annotations on the run summary.
const ghWarn = (msg) => console.log(`${env.GITHUB_ACTIONS ? "::warning::" : "WARNING: "}${msg}`);
class LowBalanceError extends Error {}

let sent = 0;
async function write(contract, functionName, args = []) {
  const req = { address: addr[contract], abi: abis[nameOf[contract]], functionName, args, account };
  if (DRY) {
    log(`[dry-run] ${contract}.${functionName}(${args.join(", ")})`);
    return;
  }
  const [est, fees, bal] = await Promise.all([
    pub.estimateContractGas(req),
    pub.estimateFeesPerGas(),
    pub.getBalance({ address: account.address }),
  ]);
  // Monad bills the gas limit, not gas used: keep it tight.
  const gas = (est * 120n) / 100n;
  const cost = gas * fees.maxFeePerGas;
  if (bal < cost) {
    throw new LowBalanceError(
      `${contract}.${functionName} needs ~${fmtMon(cost)} MON for gas, keeper has ${fmtMon(bal)} MON`,
    );
  }
  const hash = await wallet.writeContract({ ...req, chain, gas, ...fees });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${contract}.${functionName} reverted (${hash})`);
  sent++;
  log(`${contract}.${functionName}(${args.join(", ")}) ok ${hash}`);
}

// ------------------------------------------------------------------ data

const alpacaHeaders = () =>
  env.ALPACA_KEY_ID ? { "APCA-API-KEY-ID": env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": env.ALPACA_SECRET ?? "" } : {};

async function marketIsOpen() {
  if (env.MARKET_OVERRIDE) return env.MARKET_OVERRIDE === "open";
  if (env.ALPACA_KEY_ID) {
    try {
      const res = await fetch(`${CLOCK_URL}/v2/clock`, { headers: alpacaHeaders() });
      if (res.ok) {
        const c = await res.json();
        return Boolean(c.is_open);
      }
      log(`alpaca clock ${res.status}; using built-in NYSE calendar`);
    } catch (e) {
      log(`alpaca clock failed (${e.message}); using built-in NYSE calendar`);
    }
  }
  return isRegularOpen(new Date());
}

async function latestPriceCents() {
  if (env.PRICE_OVERRIDE) return Math.round(Number(env.PRICE_OVERRIDE) * 100);
  const res = await fetch(`${DATA_URL}/v2/stocks/${SYMBOL}/trades/latest?feed=iex`, { headers: alpacaHeaders() });
  if (!res.ok) throw new Error(`alpaca latest trade ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const p = body?.trade?.p;
  if (!(p > 0)) throw new Error(`alpaca returned no price: ${JSON.stringify(body)}`);
  return Math.round(p * 100);
}

// ------------------------------------------------------------------ keeper

async function runKeeper() {
  const [open, gateOpen, price, publishTime, maxAge, maxMoveBps] = await Promise.all([
    marketIsOpen(),
    read("gate", "marketOpen"),
    read("gate", "priceCents"),
    read("gate", "publishTime"),
    read("gate", "maxAge"),
    read("gate", "maxMoveBps"),
  ]);
  const now = Math.floor(Date.now() / 1000);

  if (!open) {
    if (gateOpen) {
      log(`market closed; ringing the closing bell at $${(price / 100).toFixed(2)}`);
      await write("gate", "close");
    } else {
      log("market closed; price stays frozen");
    }
    return { open: false };
  }

  const cents = await latestPriceCents();
  const moveBps = price ? (Math.abs(cents - price) * 10_000) / price : 0;
  if (price && moveBps > maxMoveBps) {
    log(`price moved ${(moveBps / 100).toFixed(2)}% (> guard). Skipping; owner can forcePush after checking.`);
    return { open: true, skipped: true };
  }
  const age = now - Number(publishTime);
  if (gateOpen && cents === price && age < maxAge / 2) {
    log(`price unchanged at $${(cents / 100).toFixed(2)}, ${age}s old; no push`);
  } else {
    log(`${gateOpen ? "pushing" : "opening with"} $${(cents / 100).toFixed(2)} from Alpaca IEX`);
    await write("gate", "push", [cents]);
  }
  return { open: true };
}

// ------------------------------------------------------------------ maker bot

const LOT = 10n ** 16n;

/** Desired quotes: [isBuy, cents, lots]. */
function ladder(ref, open) {
  const steps = open
    ? [
        [10, 200],
        [40, 1000],
      ] // bps from ref, lots (2 and 10 shares)
    : [
        [50, 200],
        [150, 1000],
      ];
  const out = [];
  for (const [bps, lots] of steps) {
    const d = Math.max(1, Math.round((ref * bps) / 10_000));
    out.push([true, ref - d, lots], [false, ref + d, lots]);
  }
  return out;
}

async function runMaker(open) {
  const me = account.address;
  const [gatePrice, closedAt, trades, [ids, orders]] = await Promise.all([
    read("gate", "priceCents"),
    read("gate", "closedAt"),
    read("book", "recentTrades", [1n]),
    read("book", "openOrdersOf", [me, 500n]),
  ]);

  // Reference price: the official print while open; the last weekend trade (or the close) while shut.
  let ref = gatePrice;
  if (!open && trades.length === 1 && Number(trades[0].time) >= Number(closedAt)) ref = trades[0].price;

  const want = ladder(ref, open);
  // Leave a quote alone unless it is more than 0.15% (open) / 0.30% (closed) from its target.
  // Re-quoting on every tick would burn testnet gas for no visible benefit.
  const tol = Math.max(1, Math.round((ref * (open ? 15 : 30)) / 10_000));
  const keep = new Set();
  const missing = [];
  for (const [isBuy, cents, lots] of want) {
    const i = orders.findIndex(
      (o, k) => !keep.has(k) && o.isBuy === isBuy && Math.abs(o.price - cents) <= tol && Number(o.lots) * 2 >= lots,
    );
    if (i >= 0) keep.add(i);
    else missing.push([isBuy, cents, lots]);
  }
  const stale = ids.filter((_, k) => !keep.has(k));

  if (missing.length === 0 && stale.length === 0) {
    log(`maker: ${orders.length} quotes around $${(ref / 100).toFixed(2)} already in place`);
    return;
  }
  log(`maker: ref $${(ref / 100).toFixed(2)} (${open ? "open" : "closed"}); cancel ${stale.length}, place ${missing.length}`);
  for (const id of stale) await write("book", "cancel", [id]);

  // Inventory top-ups (testnet tokens have no value).
  const [usdcBal, stockBal, fresh] = await Promise.all([
    read("usdc", "balanceOf", [me]),
    read("stock", "balanceOf", [me]),
    read("gate", "isFresh"),
  ]);
  if (usdcBal < 50_000n * 10n ** 6n) for (let i = 0; i < 4; i++) await write("usdc", "faucet");
  const askLots = missing.filter((q) => !q[0]).reduce((a, q) => a + BigInt(q[2]), 0n);
  if (stockBal < askLots * LOT + 50n * 10n ** 18n && fresh) await write("vault", "mint", [5_000n]);

  // Don't let a new quote cross someone else's resting order; the bot only makes, never takes.
  const [bestBid, bestAsk] = await Promise.all([read("book", "bestBid"), read("book", "bestAsk")]);
  const stockNow = await read("stock", "balanceOf", [me]);
  let stockLeft = stockNow;
  for (const [isBuy, cents0, lots] of missing) {
    let cents = cents0;
    if (isBuy && bestAsk && cents >= bestAsk) cents = bestAsk - 1;
    if (!isBuy && bestBid && cents <= bestBid) cents = bestBid + 1;
    if (!isBuy) {
      if (stockLeft < BigInt(lots) * LOT) {
        log(`maker: not enough tAAPL for ask ${lots} lots; skipping`);
        continue;
      }
      stockLeft -= BigInt(lots) * LOT;
    }
    await write("book", "placeLimit", [isBuy, cents, BigInt(lots)]);
  }
}

// ------------------------------------------------------------------ main

try {
  log(`nadbell keeper on chain ${CHAIN_ID} as ${account.address}${DRY ? " (dry run)" : ""}`);
  // The price feed and the bell come first; they are what the app depends on.
  const { open, skipped } = await runKeeper();

  if (MAKER && !skipped) {
    const bal = DRY ? MAKER_MIN_WEI : await pub.getBalance({ address: account.address });
    if (bal < MAKER_MIN_WEI) {
      ghWarn(
        `maker skipped: keeper has ${fmtMon(bal)} MON (< ${fmtMon(MAKER_MIN_WEI)}). ` +
          `Top up ${account.address} at ${FAUCET}`,
      );
    } else {
      try {
        await runMaker(open);
      } catch (e) {
        // Quotes are a nice-to-have; running dry mid re-quote shouldn't fail the price keeper.
        if (!(e instanceof LowBalanceError)) throw e;
        ghWarn(`maker stopped: ${e.message}. Top up ${account.address} at ${FAUCET}`);
      }
    }
  }

  const mon = await pub.getBalance({ address: account.address });
  log(`done: ${sent} tx sent; keeper balance ${fmtMon(mon)} MON`);
  if (mon < 10n ** 18n) ghWarn(`keeper is low on MON (${fmtMon(mon)}). Top up ${account.address} at ${FAUCET}`);
} catch (e) {
  if (e instanceof LowBalanceError) {
    // The keeper itself couldn't push or close: fail the run so it's visible.
    console.log(`::error::keeper out of gas: ${e.message}. Top up ${account.address} at ${FAUCET}`);
  } else {
    console.error(e);
  }
  process.exit(1);
}
