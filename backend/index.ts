import './dotenv.ts';

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import FastifyHelmet from '@fastify/helmet';
import FastifyRateLimit from '@fastify/rate-limit';
import { APP_PORT, IS_PROD, CORS_ORIGIN } from './src/config/main-config.ts';

// Routes
import { exampletRoute } from './src/routes/exampleRoutes.ts';
import { authRoutes } from './src/routes/authRoutes.ts';
import { roundRoutes } from './src/routes/roundRoutes.ts';
import { priceRoutes } from './src/routes/priceRoutes.ts';
import { userRoutes } from './src/routes/userRoutes.ts';
import { leaderboardRoutes } from './src/routes/leaderboardRoutes.ts';
import { agentRoutes } from './src/routes/agentRoutes.ts';
import { statsRoutes } from './src/routes/statsRoutes.ts';
import { chainRoutes } from './src/routes/chainRoutes.ts';
import { tokenRoutes } from './src/routes/tokenRoutes.ts';
import { vipRoutes } from './src/routes/vipRoutes.ts';
import { bridgeRoutes } from './src/routes/bridgeRoutes.ts';
import { usernameRoutes } from './src/routes/usernameRoutes.ts';
import { rollyticsRoutes } from './src/routes/rollyticsRoutes.ts';
import { routerRoutes } from './src/routes/routerRoutes.ts';
import { dexRoutes } from './src/routes/dexRoutes.ts';

// Workers
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';
import { startOracleCacheWorker } from './src/workers/oracleCache.ts';
import { startEventIndexerWorker } from './src/workers/eventIndexer.ts';
import { startRoundKeeperWorker } from './src/workers/roundKeeper.ts';
import { startCopyTradeExecutor } from './src/workers/copyTradeExecutor.ts';
import { startClaimExecutor } from './src/workers/claimExecutor.ts';

console.log(
  '======================\n======================\nINITTAP BACKEND STARTED!\n======================\n======================\n'
);

const fastify = Fastify({
  logger: IS_PROD ? {
    level: 'warn',
    serializers: {
      req(request) {
        return { method: request.method, url: request.url };
      },
    },
  } : { level: 'info' },
  bodyLimit: 1_048_576, // 1 MB
});

await fastify.register(FastifyHelmet, {
  contentSecurityPolicy: false, // API-only, no HTML
  crossOriginEmbedderPolicy: false,
});

fastify.register(FastifyCors, {
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});

await fastify.register(FastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.ip,
});

// Health check endpoint
fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
  return reply.status(200).send({ status: 'ok' });
});

// Register routes with prefixes
fastify.register(exampletRoute, { prefix: '/example' });
fastify.register(authRoutes, { prefix: '/auth' });
fastify.register(roundRoutes, { prefix: '/rounds' });
fastify.register(priceRoutes, { prefix: '/prices' });
fastify.register(userRoutes, { prefix: '/user' });
fastify.register(leaderboardRoutes, { prefix: '/leaderboard' });
fastify.register(agentRoutes, { prefix: '/agents' });
fastify.register(statsRoutes, { prefix: '/stats' });
fastify.register(chainRoutes, { prefix: '/chain' });
fastify.register(tokenRoutes, { prefix: '/token' });
fastify.register(vipRoutes, { prefix: '/vip' });
fastify.register(bridgeRoutes, { prefix: '/bridge' });
fastify.register(usernameRoutes, { prefix: '/usernames' });
fastify.register(rollyticsRoutes, { prefix: '/rollytics' });
fastify.register(routerRoutes, { prefix: '/router' });
fastify.register(dexRoutes, { prefix: '/dex' });

const start = async (): Promise<void> => {
  try {
    // Start workers (order matters: dependencies start first)
    startErrorLogCleanupWorker();
    startOracleCacheWorker();       // Prices needed by other workers
    startEventIndexerWorker();      // DB state needed by round keeper
    startRoundKeeperWorker();       // Drives on-chain round lifecycle
    startCopyTradeExecutor();       // Reacts to LIVE rounds
    startClaimExecutor();           // Reacts to ENDED rounds

    await fastify.listen({
      port: APP_PORT,
      host: '0.0.0.0',
    });

    const address = fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : APP_PORT;

    console.log(`Server started successfully on port ${port}`);
    console.log(`http://localhost:${port}`);
  } catch (error) {
    console.log('Error starting server: ', error);
    process.exit(1);
  }
};

start();

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
