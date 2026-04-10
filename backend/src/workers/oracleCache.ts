import {
  ORACLE_CACHE_INTERVAL_MS,
  ACTIVE_PAIRS,
} from '../config/main-config.ts';
import { connectOracle } from '../lib/evm/contracts.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { formatOraclePrice } from '../utils/evmUtils.ts';

let isRunning = false;

interface OraclePriceResult {
  price: bigint;
  timestamp: bigint;
  height: bigint;
  nonce: bigint;
  decimal: bigint;
  id: bigint;
}

const cacheOraclePrices = async (): Promise<void> => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const results: OraclePriceResult[] = await connectOracle.get_prices(ACTIVE_PAIRS);

    if (!results || results.length !== ACTIVE_PAIRS.length) {
      console.error(`[OracleCache] Unexpected result length: got ${results?.length}, expected ${ACTIVE_PAIRS.length}`);
      return;
    }

    const upsertOps = ACTIVE_PAIRS.map((pairName, i) => {
      const result = results[i];
      return prismaQuery.oraclePrice.upsert({
        where: { id: pairName },
        create: {
          id: pairName,
          price: result.price.toString(),
          nonce: BigInt(result.nonce),
          height: BigInt(result.height),
          timestamp: BigInt(result.timestamp),
        },
        update: {
          price: result.price.toString(),
          nonce: BigInt(result.nonce),
          height: BigInt(result.height),
          timestamp: BigInt(result.timestamp),
        },
      });
    });

    await prismaQuery.$transaction(upsertOps);

    // Log human-readable prices (8 decimals for crypto pairs)
    const priceDisplay = ACTIVE_PAIRS.map((name, i) => {
      const result = results[i];
      const decimals = Number(result.decimal) || 8;
      const formatted = formatOraclePrice(result.price, decimals);
      return `${name}=$${Number(formatted).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }).join(' ');

    console.log(`[OracleCache] Updated prices: ${priceDisplay}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[OracleCache] Error fetching prices: ${message}`);
  } finally {
    isRunning = false;
  }
};

export const startOracleCacheWorker = (): void => {
  console.log(`[OracleCache] Worker started (interval: ${ORACLE_CACHE_INTERVAL_MS}ms)`);
  setInterval(cacheOraclePrices, ORACLE_CACHE_INTERVAL_MS);
  cacheOraclePrices();
};
