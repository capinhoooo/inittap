import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { verifyMessage } from 'ethers';
import jwt from 'jsonwebtoken';
import { prismaQuery } from '../lib/prisma.ts';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/main-config.ts';
import { checksumAddress } from '../utils/evmUtils.ts';
import { validateRequiredFields } from '../utils/validationUtils.ts';
import { handleError, handleUnauthorizedError, handleServerError } from '../utils/errorHandler.ts';

export const authRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * POST /auth/nonce
   * Generate a nonce for wallet signature verification.
   * Upserts user record with new nonce.
   */
  app.post('/nonce', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const validation = await validateRequiredFields(body, ['walletAddress'], reply);
      if (validation !== true) return;

      const { walletAddress } = body as { walletAddress: string };

      if (typeof walletAddress !== 'string' || walletAddress.length < 42 || walletAddress.length > 42) {
        return handleError(reply, 400, 'Invalid wallet address format', 'INVALID_ADDRESS');
      }

      let checksummed: string;
      try {
        checksummed = checksumAddress(walletAddress);
      } catch {
        return handleError(reply, 400, 'Invalid wallet address', 'INVALID_ADDRESS');
      }

      const nonce = crypto.randomUUID();

      const user = await prismaQuery.user.upsert({
        where: { walletAddress: checksummed },
        update: { nonce },
        create: { walletAddress: checksummed, nonce },
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: { nonce: user.nonce },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * POST /auth/verify
   * Verify a signed nonce and issue a JWT.
   */
  app.post('/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const validation = await validateRequiredFields(body, ['walletAddress', 'signature'], reply);
      if (validation !== true) return;

      const { walletAddress, signature } = body as { walletAddress: string; signature: string };

      if (typeof walletAddress !== 'string' || typeof signature !== 'string') {
        return handleError(reply, 400, 'Invalid request fields', 'INVALID_FIELDS');
      }

      let checksummed: string;
      try {
        checksummed = checksumAddress(walletAddress);
      } catch {
        return handleError(reply, 400, 'Invalid wallet address', 'INVALID_ADDRESS');
      }

      const user = await prismaQuery.user.findUnique({
        where: { walletAddress: checksummed },
      });

      if (!user || !user.nonce) {
        return handleUnauthorizedError(reply, 'No pending nonce for this address');
      }

      // Check nonce freshness (5 minute window)
      const NONCE_TTL_MS = 5 * 60 * 1000;
      const nonceAge = Date.now() - new Date(user.updatedAt).getTime();
      if (nonceAge > NONCE_TTL_MS) {
        // Clear expired nonce
        await prismaQuery.user.update({
          where: { id: user.id },
          data: { nonce: null },
        });
        return handleError(reply, 401, 'Nonce expired. Please request a new one.', 'NONCE_EXPIRED');
      }

      // Verify the signature matches the stored nonce
      let recoveredAddress: string;
      try {
        recoveredAddress = verifyMessage(user.nonce, signature);
      } catch {
        return handleUnauthorizedError(reply, 'Invalid signature');
      }

      if (recoveredAddress.toLowerCase() !== checksummed.toLowerCase()) {
        return handleUnauthorizedError(reply, 'Signature does not match wallet address');
      }

      // Signature valid: clear nonce, update lastSignIn, issue JWT
      await prismaQuery.user.update({
        where: { id: user.id },
        data: {
          nonce: null,
          lastSignIn: new Date(),
        },
      });

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          token,
          user: {
            id: user.id,
            walletAddress: user.walletAddress,
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
