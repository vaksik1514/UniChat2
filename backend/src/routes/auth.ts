import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { redis } from '../utils/redis';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { authMiddleware } from '../middleware/auth';
import { config } from '../config';

const sendCodeSchema = z.object({
    phone: z.string().min(6).max(20),
});

const verifyCodeSchema = z.object({
    phone: z.string(),
    code: z.string().min(4).max(8),
    deviceFingerprint: z.string().optional(),
    deviceName: z.string().optional(),
});

const refreshSchema = z.object({
    refreshToken: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
    // Global error handler for Zod
    app.setErrorHandler((error, request, reply) => {
        if (error.name === 'ZodError') {
            return reply.status(400).send({ error: 'Invalid input', details: error.message });
        }
        app.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
    });

    // ── Send verification code ──
    app.post('/send-code', async (request, reply) => {
        try {
            const body = sendCodeSchema.parse(request.body);
            // Normalize phone — remove spaces, dashes
            const phone = body.phone.replace(/[\s\-\(\)]/g, '');

            // Rate limit per phone
            const rateLimitKey = `sms:rate:${phone}`;
            const attempts = await redis.incr(rateLimitKey);
            if (attempts === 1) await redis.expire(rateLimitKey, 600);
            if (attempts > 3) {
                return reply.status(429).send({ error: 'Too many attempts. Try again later.' });
            }

            // Generate 6-digit code
            const code = String(Math.floor(100000 + Math.random() * 900000));

            // Store code in DB
            await prisma.verificationCode.create({
                data: {
                    phone,
                    code,
                    expiresAt: new Date(Date.now() + config.verification.codeExpiresMinutes * 60 * 1000),
                },
            });

            const response: any = {
                success: true,
                message: 'Code sent',
                expiresIn: config.verification.codeExpiresMinutes * 60,
            };

            if (config.nodeEnv === 'development') {
                response.code = code;
            }

            return reply.send(response);
        } catch (err: any) {
            app.log.error(err);
            return reply.status(400).send({ error: err.message || 'Failed to send code' });
        }
    });

    // ── Verify code & login/register ──
    app.post('/verify-code', async (request, reply) => {
        try {
            const body = verifyCodeSchema.parse(request.body);
            const phone = body.phone.replace(/[\s\-\(\)]/g, '');

            // Find valid code
            const verification = await prisma.verificationCode.findFirst({
                where: {
                    phone,
                    code: body.code,
                    usedAt: null,
                    expiresAt: { gt: new Date() },
                    attempts: { lt: config.verification.maxAttempts },
                },
                orderBy: { createdAt: 'desc' },
            });

            if (!verification) {
                const latest = await prisma.verificationCode.findFirst({
                    where: { phone, usedAt: null },
                    orderBy: { createdAt: 'desc' },
                });
                if (latest) {
                    await prisma.verificationCode.update({
                        where: { id: latest.id },
                        data: { attempts: { increment: 1 } },
                    });
                }
                return reply.status(400).send({ error: 'Invalid or expired code' });
            }

            // Mark code as used
            await prisma.verificationCode.update({
                where: { id: verification.id },
                data: { usedAt: new Date() },
            });

            // Find or create user
            let user = await prisma.user.findUnique({ where: { phone } });
            const isNewUser = !user;

            if (!user) {
                user = await prisma.user.create({
                    data: {
                        phone,
                        consentGiven: true,
                        consentDate: new Date(),
                    },
                });
            }

            // Create session
            const session = await prisma.session.create({
                data: {
                    userId: user.id,
                    refreshToken: '',
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'] || null,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
            });

            // Device binding
            if (body.deviceFingerprint) {
                await prisma.device.upsert({
                    where: {
                        userId_fingerprint: { userId: user.id, fingerprint: body.deviceFingerprint },
                    },
                    create: { userId: user.id, fingerprint: body.deviceFingerprint, name: body.deviceName },
                    update: { lastSeenAt: new Date(), name: body.deviceName },
                });
            }

            // Generate tokens
            const tokenPayload = { userId: user.id, sessionId: session.id };
            const accessToken = generateAccessToken(tokenPayload);
            const refreshToken = generateRefreshToken(tokenPayload);

            await prisma.session.update({
                where: { id: session.id },
                data: { refreshToken },
            });

            await redis.set(`user:online:${user.id}`, 'true', 'EX', 300);

            return reply.send({
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.displayName,
                    avatarUrl: user.avatarUrl,
                    isAdmin: user.isAdmin,
                    locale: user.locale,
                },
                isNewUser,
            });
        } catch (err: any) {
            app.log.error(err);
            return reply.status(400).send({ error: err.message || 'Verification failed' });
        }
    });

    // ── Refresh token ──
    app.post('/refresh', async (request, reply) => {
        try {
            const body = refreshSchema.parse(request.body);
            const payload = verifyRefreshToken(body.refreshToken);

            const session = await prisma.session.findUnique({
                where: { id: payload.sessionId },
            });

            if (!session || session.refreshToken !== body.refreshToken) {
                return reply.status(401).send({ error: 'Invalid refresh token' });
            }

            if (session.expiresAt < new Date()) {
                await prisma.session.delete({ where: { id: session.id } });
                return reply.status(401).send({ error: 'Refresh token expired' });
            }

            const newTokenPayload = { userId: session.userId, sessionId: session.id };
            const accessToken = generateAccessToken(newTokenPayload);
            const refreshToken = generateRefreshToken(newTokenPayload);

            await prisma.session.update({
                where: { id: session.id },
                data: { refreshToken },
            });

            return reply.send({ accessToken, refreshToken });
        } catch {
            return reply.status(401).send({ error: 'Invalid refresh token' });
        }
    });

    // ── Logout ──
    app.post('/logout', { preHandler: [authMiddleware] }, async (request, reply) => {
        await prisma.session.delete({
            where: { id: request.user!.sessionId },
        }).catch(() => { });
        await redis.del(`user:online:${request.user!.id}`);
        return reply.send({ success: true });
    });

    // ── Get current user ──
    app.get('/me', { preHandler: [authMiddleware] }, async (request, reply) => {
        const user = await prisma.user.findUnique({
            where: { id: request.user!.id },
            select: {
                id: true, phone: true, username: true, displayName: true,
                avatarUrl: true, bio: true, isAdmin: true, locale: true, createdAt: true,
            },
        });
        return reply.send(user);
    });

    // ── Get active sessions ──
    app.get('/sessions', { preHandler: [authMiddleware] }, async (request, reply) => {
        const sessions = await prisma.session.findMany({
            where: { userId: request.user!.id },
            select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true },
            orderBy: { createdAt: 'desc' },
        });
        return reply.send(sessions);
    });

    // ── Revoke session ──
    app.delete('/sessions/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        await prisma.session.deleteMany({ where: { id, userId: request.user!.id } });
        return reply.send({ success: true });
    });
}
