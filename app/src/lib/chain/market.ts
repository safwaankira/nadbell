import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  maxUint256,
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { create } from "zustand";
import { addresses, chain, devKey, rpcUrl, txUrl } from "./config";
import { MockUSDCAbi, OpenCallAbi, OrderBookAbi, PriceGateAbi, StockTokenAbi, VaultAbi } from "./generated";

// Batch every read made in the same tick into one Multicall3 request (where the chain has it),
// and retry transient failures. Monad's public RPC rate-limits bursts of separate calls.
export const publicClient = createPublicClient({
  chain,
  batch: { multicall: { wait: 16 } },
  transport: http(rpcUrl, { retryCount: 3, retryDelay: 400 }),
});

let refreshing = false;
let readFailures = 0;

export type Side = "buy" | "sell";
export type Level = { price: number; lots: number };
export type Trade = { price: number; lots: number; time: number; takerBuy: boolean };
export type OpenOrder = { id: bigint; isBuy: boolean; price: number; lots: number };
export type Activity = { id: number; ok: boolean; title: string; detail: string; url: string | null };

export type Recap = {
  session: number;
  closeCents: number;
  bookCents: number; // 0 = no weekend trades
  openCents: number;
  settledAt: number;
  calls: { player: Address; cents: number; errBps: number }[];
};

export type Leader = { player: Address; sessions: number; avgErrBps: number; best: number };

export type Snapshot = {
  print: { cents: number; time: number; fresh: boolean; maxAge: number; label: string };
  marketOpen: boolean;
  sessionId: number;
  closeCents: number;
  closedAt: number;
  bids: Level[];
  asks: Level[];
  trades: Trade[];
  lastPrice: number;
  multiplier: number;
  backing: { held: number; owed: number; ratioBps: number };
  gateOwner: Address;
  calls: { count: number; mine: number }; // current closed session
  recaps: Recap[]; // settled sessions, newest first
  leaders: Leader[];
  me: null | {
    usdc: bigint;
    stock: bigint;
    stockUI: bigint;
    mon: bigint;
    orders: OpenOrder[];
  };
  at: number;
};

type Market = {
  account: Address | null;
  wallet: WalletClient | null;
  snap: Snapshot | null;
  error: string | null;
  busy: string | null;
  activity: Activity[];
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  faucet: () => Promise<void>;
  buyDollars: (dollars: number) => Promise<void>;
  sellShares: (shares: number) => Promise<void>;
  place: (side: Side, cents: number, lots: bigint) => Promise<void>;
  cancel: (id: bigint) => Promise<void>;
  mint: (lots: bigint) => Promise<void>;
  redeem: (lots: bigint) => Promise<void>;
  callOpen: (cents: number) => Promise<void>;
  pushPrint: (cents: number) => Promise<void>;
  closeMarket: () => Promise<void>;
};

const LOT = 10n ** 16n;
let activityId = 0;
let recapCache: { sessionId: number; recaps: Recap[]; leaders: Leader[] } | null = null;

function reason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    }
    if (/insufficient funds|exceeds the balance|allowance: 0/i.test(err.message)) return "NoGas";
    if (/User rejected|denied/i.test(err.message)) return "Rejected";
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

const ERROR_TEXT: Record<string, string> = {
  MarketClosed: "Minting is off while the market is closed. You can still buy and sell on the book.",
  MarketOpen: "Calls open when the market closes.",
  BadCall: "That call is too far from the close. Try a price between half and double it.",
  NotOwner: "Only the wallet that placed this order can cancel it.",
  NoOrder: "That order is already filled or cancelled.",
  BadParams: "Enter a price and an amount above zero.",
  VaultShort: "The vault can't cover that redemption right now.",
  BookTooDeep: "That price is too far from the top of the book.",
  ERC20InsufficientBalance: "Not enough balance. Tap Get test dollars first.",
  NoGas: "Your wallet needs a little test MON for gas. Get some from the Monad faucet.",
  Rejected: "Cancelled in your wallet.",
  TooFarMove: "That price is more than 15% from the last one.",
};

const errBps = (cents: number, open: number) => (open ? Math.round((Math.abs(cents - open) * 10_000) / open) : 0);

export const useMarket = create<Market>((set, get) => {
  const log = (a: Omit<Activity, "id">) =>
    set((s) => ({ activity: [{ ...a, id: ++activityId }, ...s.activity].slice(0, 6) }));

  /** Send one contract write, wait for it, record it in Activity, refresh. */
  async function send(
    label: string,
    title: string,
    request: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] },
    describe: (receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>) => string,
  ): Promise<boolean> {
    const { wallet, account } = get();
    if (!wallet || !account) {
      set({ error: "Connect a wallet first." });
      return false;
    }
    set({ busy: label, error: null });
    try {
      const req = { ...(request as Record<string, unknown>), account };
      const { request: sim } = await publicClient.simulateContract(req as never);
      const gas = await publicClient.estimateContractGas(req as never);
      // Monad bills the gas limit, not gas used: keep the limit tight.
      const write = { ...(sim as Record<string, unknown>), gas: (gas * 115n) / 100n, chain, account };
      const hash: Hash = await wallet.writeContract(write as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted.");
      log({ ok: true, title, detail: describe(receipt), url: txUrl(hash) });
      return true;
    } catch (err) {
      const r = reason(err);
      const text = ERROR_TEXT[r] ?? r;
      if (r !== "Rejected") log({ ok: false, title, detail: text, url: null });
      set({ error: text });
      return false;
    } finally {
      set({ busy: null });
      void get().refresh();
    }
  }

  /** Only needed if the contracts aren't marked trusted (older deploys). */
  async function ensureAllowance(token: Address, abi: typeof MockUSDCAbi | typeof StockTokenAbi, spender: Address, need: bigint) {
    const { account } = get();
    if (!account) return true;
    const current = (await publicClient.readContract({
      address: token,
      abi,
      functionName: "allowance",
      args: [account, spender],
    })) as bigint;
    if (current >= need) return true;
    return send("Approving", "Approve", { address: token, abi, functionName: "approve", args: [spender, maxUint256] }, () => "Approved.");
  }

  const fills = (receipt: { logs: readonly { address: string; topics: readonly unknown[] }[] }) => {
    const book = addresses!.book.toLowerCase();
    return receipt.logs.filter((l) => l.address.toLowerCase() === book && l.topics.length === 4).length;
  };

  async function loadRecaps(sessionId: number, marketOpen: boolean): Promise<{ recaps: Recap[]; leaders: Leader[] }> {
    const a = addresses!;
    const last = marketOpen ? sessionId : sessionId - 1; // the current closed session is not settled yet
    if (recapCache && recapCache.sessionId === last) return recapCache;
    const ids: number[] = [];
    for (let s = last; s >= 1 && ids.length < 8; s--) ids.push(s);
    const rows = await Promise.all(
      ids.map(async (sid) => {
        const [r, c] = await Promise.all([
          publicClient.readContract({ address: a.openCall, abi: OpenCallAbi, functionName: "results", args: [BigInt(sid)] }),
          publicClient.readContract({ address: a.openCall, abi: OpenCallAbi, functionName: "calls", args: [BigInt(sid)] }),
        ]);
        const [closeCents, bookCents, openCents, settledAt] = r;
        const [players, cents] = c;
        return {
          session: sid,
          closeCents,
          bookCents,
          openCents,
          settledAt: Number(settledAt),
          calls: players
            .map((p, i) => ({ player: p, cents: cents[i], errBps: errBps(cents[i], openCents) }))
            .sort((x, y) => x.errBps - y.errBps),
        } satisfies Recap;
      }),
    );
    const recaps = rows.filter((r) => r.openCents > 0);
    const agg = new Map<string, Leader & { sum: number }>();
    for (const r of recaps) {
      for (const c of r.calls) {
        const k = c.player.toLowerCase();
        const cur = agg.get(k) ?? { player: c.player, sessions: 0, avgErrBps: 0, best: Infinity, sum: 0 };
        cur.sessions += 1;
        cur.sum += c.errBps;
        cur.best = Math.min(cur.best, c.errBps);
        agg.set(k, cur);
      }
    }
    const leaders = [...agg.values()]
      .map(({ sum, ...l }) => ({ ...l, avgErrBps: Math.round(sum / l.sessions) }))
      .sort((x, y) => x.avgErrBps - y.avgErrBps || y.sessions - x.sessions)
      .slice(0, 10);
    recapCache = { sessionId: last, recaps, leaders };
    return recapCache;
  }

  return {
    account: null,
    wallet: null,
    snap: null,
    error: addresses ? null : `Nadbell isn't deployed on ${chain.name} yet.`,
    busy: null,
    activity: [],
    clearError: () => set({ error: null }),

    async connect() {
      try {
        if (devKey) {
          const acct = privateKeyToAccount(devKey);
          const wallet = createWalletClient({ account: acct, chain, transport: http(rpcUrl) });
          set({ wallet, account: acct.address, error: null });
          await get().refresh();
          return;
        }
        const eth = (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
        if (!eth) {
          set({ error: "No browser wallet found. Install MetaMask, Rabby or Phantom, then reload." });
          return;
        }
        const wallet = createWalletClient({ chain, transport: custom(eth) });
        const [account] = await wallet.requestAddresses();
        try {
          await wallet.switchChain({ id: chain.id });
        } catch {
          await wallet.addChain({ chain });
          await wallet.switchChain({ id: chain.id });
        }
        set({ wallet, account, error: null });
        await get().refresh();
      } catch (err) {
        const r = reason(err);
        set({ error: ERROR_TEXT[r] ?? r });
      }
    },

    async refresh() {
      if (!addresses || refreshing) return;
      refreshing = true;
      const a = addresses;
      const account = get().account;
      try {
        const g = { address: a.gate, abi: PriceGateAbi } as const;
        const b = { address: a.book, abi: OrderBookAbi } as const;
        const [latest, maxAge, label, marketOpen, sessionId, closeCents, closedAt, gateOwner] = await Promise.all([
          publicClient.readContract({ ...g, functionName: "latest" }),
          publicClient.readContract({ ...g, functionName: "maxAge" }),
          publicClient.readContract({ ...g, functionName: "sourceLabel" }),
          publicClient.readContract({ ...g, functionName: "marketOpen" }),
          publicClient.readContract({ ...g, functionName: "sessionId" }),
          publicClient.readContract({ ...g, functionName: "closeCents" }),
          publicClient.readContract({ ...g, functionName: "closedAt" }),
          publicClient.readContract({ ...g, functionName: "owner" }),
        ]);
        const [bidDepth, askDepth, trades, lastPrice, mult, backing] = await Promise.all([
          publicClient.readContract({ ...b, functionName: "depth", args: [true, 8n] }),
          publicClient.readContract({ ...b, functionName: "depth", args: [false, 8n] }),
          publicClient.readContract({ ...b, functionName: "recentTrades", args: [40n] }),
          publicClient.readContract({ ...b, functionName: "lastPrice" }),
          publicClient.readContract({ address: a.stock, abi: StockTokenAbi, functionName: "uiMultiplier" }),
          publicClient.readContract({ address: a.vault, abi: VaultAbi, functionName: "backing" }),
        ]);
        const sid = Number(sessionId);
        const [callCount, myCall, recapData] = await Promise.all([
          sid > 0
            ? publicClient.readContract({ address: a.openCall, abi: OpenCallAbi, functionName: "playerCount", args: [sessionId] })
            : Promise.resolve(0n),
          sid > 0 && account
            ? publicClient.readContract({ address: a.openCall, abi: OpenCallAbi, functionName: "callOf", args: [sessionId, account] })
            : Promise.resolve(0),
          loadRecaps(sid, marketOpen),
        ]);

        let me: Snapshot["me"] = null;
        if (account) {
          const [usdc, stock, stockUI, mon, open] = await Promise.all([
            publicClient.readContract({ address: a.usdc, abi: MockUSDCAbi, functionName: "balanceOf", args: [account] }),
            publicClient.readContract({ address: a.stock, abi: StockTokenAbi, functionName: "balanceOf", args: [account] }),
            publicClient.readContract({ address: a.stock, abi: StockTokenAbi, functionName: "balanceOfUI", args: [account] }),
            publicClient.getBalance({ address: account }),
            publicClient.readContract({ ...b, functionName: "openOrdersOf", args: [account, 300n] }),
          ]);
          const [ids, list] = open;
          me = {
            usdc,
            stock,
            stockUI,
            mon,
            orders: ids.map((id, i) => ({ id, isBuy: list[i].isBuy, price: list[i].price, lots: Number(list[i].lots) })),
          };
        }

        const toLevels = ([prices, lots]: readonly [readonly number[], readonly bigint[]]) =>
          prices.map((p, i) => ({ price: p, lots: Number(lots[i]) }));

        set({
          snap: {
            print: { cents: latest[0], time: Number(latest[1]), fresh: latest[3], maxAge, label },
            marketOpen,
            sessionId: sid,
            closeCents,
            closedAt: Number(closedAt),
            bids: toLevels(bidDepth),
            asks: toLevels(askDepth),
            trades: trades.map((t) => ({ price: t.price, lots: Number(t.lots), time: Number(t.time), takerBuy: t.takerBuy })),
            lastPrice,
            multiplier: Number(mult) / 1e18,
            backing: { held: Number(backing[0]) / 1e6, owed: Number(backing[1]) / 1e6, ratioBps: Number(backing[2]) },
            gateOwner,
            calls: { count: Number(callCount), mine: Number(myCall) },
            recaps: recapData.recaps,
            leaders: recapData.leaders,
            me,
            at: Date.now(),
          },
        });
        readFailures = 0;
        if (get().error?.startsWith("Can't reach")) set({ error: null });
      } catch (err) {
        // One dropped poll is normal on a public RPC; only speak up if it keeps failing.
        readFailures++;
        if (readFailures >= 3) set({ error: `Can't reach ${chain.name} right now (${reason(err)}). Retrying…` });
      } finally {
        refreshing = false;
      }
    },

    async faucet() {
      if (!addresses) return;
      await send("Getting test dollars", "Test dollars", { address: addresses.usdc, abi: MockUSDCAbi, functionName: "faucet" }, () => "You got 5,000 tUSDC.");
    },

    async buyDollars(dollars) {
      const s = get().snap;
      if (!addresses || !s) return;
      const ask = s.asks[0]?.price;
      if (!ask) {
        set({ error: "Nobody is selling right now. Try again in a few minutes." });
        return;
      }
      // Walk up to 1% above the best offer; anything that doesn't fill comes straight back.
      const limit = Math.ceil(ask * 1.01);
      const lots = BigInt(Math.floor((dollars * 10_000) / limit));
      if (lots <= 0n) {
        set({ error: "That amount is too small. The minimum is 0.01 share." });
        return;
      }
      await ensureAllowance(addresses.usdc, MockUSDCAbi, addresses.book, BigInt(limit) * lots * 100n);
      await send(
        "Buying",
        "Buy",
        { address: addresses.book, abi: OrderBookAbi, functionName: "placeIOC", args: [true, limit, lots] },
        (r) => (fills(r) ? `Bought tAAPL for about $${dollars.toFixed(2)}.` : "Nothing filled. No money was spent."),
      );
    },

    async sellShares(shares) {
      const s = get().snap;
      if (!addresses || !s) return;
      const bid = s.bids[0]?.price;
      if (!bid) {
        set({ error: "Nobody is buying right now. Try again in a few minutes." });
        return;
      }
      const limit = Math.max(1, Math.floor(bid * 0.99));
      const lots = BigInt(Math.floor(shares * 100 + 1e-9));
      if (lots <= 0n) return;
      await ensureAllowance(addresses.stock, StockTokenAbi, addresses.book, lots * LOT);
      await send(
        "Selling",
        "Sell",
        { address: addresses.book, abi: OrderBookAbi, functionName: "placeIOC", args: [false, limit, lots] },
        (r) => (fills(r) ? `Sold ${shares} tAAPL.` : "Nothing filled. Your shares are back."),
      );
    },

    async place(side, cents, lots) {
      if (!addresses) return;
      const isBuy = side === "buy";
      const ok = isBuy
        ? await ensureAllowance(addresses.usdc, MockUSDCAbi, addresses.book, BigInt(cents) * lots * 100n)
        : await ensureAllowance(addresses.stock, StockTokenAbi, addresses.book, lots * LOT);
      if (!ok) return;
      const shares = Number(lots) / 100;
      await send(
        isBuy ? "Placing buy" : "Placing sell",
        `Limit ${side}`,
        { address: addresses.book, abi: OrderBookAbi, functionName: "placeLimit", args: [isBuy, cents, lots] },
        (r) => {
          const n = fills(r);
          return n
            ? `${side} ${shares} @ $${(cents / 100).toFixed(2)} matched ${n} order${n === 1 ? "" : "s"}; any rest is waiting on the book.`
            : `${side} ${shares} @ $${(cents / 100).toFixed(2)} is waiting on the book.`;
        },
      );
    },

    async cancel(id) {
      if (!addresses) return;
      await send("Cancelling", "Cancel", { address: addresses.book, abi: OrderBookAbi, functionName: "cancel", args: [id] }, () => `Order #${id} cancelled. Funds returned.`);
    },

    async mint(lots) {
      if (!addresses) return;
      const [cost] = await publicClient.readContract({ address: addresses.vault, abi: VaultAbi, functionName: "quoteMint", args: [lots] });
      if (!(await ensureAllowance(addresses.usdc, MockUSDCAbi, addresses.vault, cost))) return;
      await send(
        "Minting",
        "Mint",
        { address: addresses.vault, abi: VaultAbi, functionName: "mint", args: [lots] },
        () => `Minted ${Number(lots) / 100} tAAPL at the official price for $${(Number(cost) / 1e6).toFixed(2)}.`,
      );
    },

    async redeem(lots) {
      if (!addresses) return;
      await send("Redeeming", "Redeem", { address: addresses.vault, abi: VaultAbi, functionName: "redeem", args: [lots] }, () => `Redeemed ${Number(lots) / 100} tAAPL.`);
    },

    async callOpen(cents) {
      if (!addresses) return;
      await send(
        "Locking your call",
        "Call the open",
        { address: addresses.openCall, abi: OpenCallAbi, functionName: "callOpen", args: [cents] },
        () => `You called the open at $${(cents / 100).toFixed(2)}. You can change it until the bell.`,
      );
    },

    async pushPrint(cents) {
      if (!addresses) return;
      await send("Pushing price", "Keeper push", { address: addresses.gate, abi: PriceGateAbi, functionName: "push", args: [cents] }, () => `Official price set to $${(cents / 100).toFixed(2)}.`);
    },

    async closeMarket() {
      if (!addresses) return;
      await send("Closing", "Closing bell", { address: addresses.gate, abi: PriceGateAbi, functionName: "close" }, () => "Market closed. The price is frozen.");
    },
  };
});
