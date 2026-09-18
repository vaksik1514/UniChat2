import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { config } from './config';
import { prisma } from './utils/prisma';
import { redis } from './utils/redis';
import { initMinio } from './utils/minio';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { chatRoutes } from './routes/chats';
import { messageRoutes } from './routes/messages';
import { fileRoutes } from './routes/files';
import { adminRoutes } from './routes/admin';
import { setupSocket } from './socket';

const app = Fastify({
    logger: {
        level: config.nodeEnv === 'production' ? 'info' : 'debug',
        transport: config.nodeEnv !== 'production' ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: true,
});

async function bootstrap() {
    // ── Plugins ──
    await app.register(cors, {
        origin: true,
        credentials: true,
    });

    await app.register(helmet, {
        contentSecurityPolicy: false,
    });

    await app.register(rateLimit, {
        max: config.rateLimit.max,
        timeWindow: config.rateLimit.timeWindow,
    });

    await app.register(cookie, {
        secret: config.jwt.accessSecret,
    });

    await app.register(multipart, {
        limits: {
            fileSize: 50 * 1024 * 1024, // 50MB
        },
    });

    // ── Health ──
    app.get('/api/health', async () => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                database: await prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'error'),
                redis: await redis.ping().then(() => 'ok').catch(() => 'error'),
            },
        };
    });

    // ── Routes ──
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(userRoutes, { prefix: '/api/users' });
    await app.register(chatRoutes, { prefix: '/api/chats' });
    await app.register(messageRoutes, { prefix: '/api/messages' });
    await app.register(fileRoutes, { prefix: '/api/files' });
    await app.register(adminRoutes, { prefix: '/api/admin' });

    // ── Init services ──
    await initMinio();

    // ── Socket.IO ──
    const httpServer = app.server;
    const io = new SocketServer(httpServer, {
        cors: {
            origin: true,
            credentials: true,
        },
        path: '/socket.io/',
    });

    setupSocket(io);

    // ── Start ──
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`🚀 Anfeelgram backend running on port ${config.port}`);
}

bootstrap().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
});

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
    process.on(signal, async () => {
        console.log(`\n${signal} received. Shutting down...`);
        await app.close();
        await prisma.$disconnect();
        redis.disconnect();
        process.exit(0);
    });
});
