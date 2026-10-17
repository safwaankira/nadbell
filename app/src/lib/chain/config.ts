import type { Chain } from "viem";
import { foundry, monadTestnet as viemMonadTestnet } from "viem/chains";
import { deployments } from "./generated";

/** viem's Monad testnet (includes Multicall3, so reads get batched), with MonadVision as explorer. */
export const monadTestnet: Chain = {
  ...viemMonadTestnet,
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
};

const CHAINS: Record<number, Chain> = { [monadTestnet.id]: monadTestnet, [foundry.id]: foundry };

/** VITE_CHAIN_ID picks the network. Defaults to Monad testnet. */
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? monadTestnet.id);
export const chain: Chain = CHAINS[CHAIN_ID] ?? monadTestnet;
export const rpcUrl: string = import.meta.env.VITE_RPC_URL ?? chain.rpcUrls.default.http[0];
export const addresses = deployments[CHAIN_ID] ?? null;

/** Dev-only burner key for local testing (never set this for a public deploy). */
export const devKey = (import.meta.env.VITE_DEV_PK as `0x${string}` | undefined) || undefined;

export function txUrl(hash: string): string | null {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

export function addressUrl(addr: string): string | null {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/address/${addr}` : null;
}

/** Units: 1 lot = 0.01 share. Prices are cents per share. USDC has 6 decimals. */
export const LOT = 10n ** 16n;
export const sharesToLots = (shares: number) => BigInt(Math.round(shares * 100));
export const lotsToShares = (lots: bigint | number) => Number(lots) / 100;
export const usdcToNumber = (v: bigint) => Number(v) / 1e6;
export const tokenToShares = (v: bigint) => Number(v / 10n ** 14n) / 1e4;
