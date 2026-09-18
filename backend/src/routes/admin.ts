import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

export async function adminRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authMiddleware);
    app.addHook('preHandler', adminMiddleware);

    // ── Get all users ──
    app.get('/users', async (request, reply) => {
        const { page = '1', limit = '20', search } = request.query as {
            page?: string;
            limit?: string;
            search?: string;
        };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const where = search
            ? {
                OR: [
                    { username: { contains: search, mode: 'insensitive' as const } },
                    { displayName: { contains: search, mode: 'insensitive' as const } },
                    { phone: { contains: search } },
                ],
            }
            : {};

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    phone: true,
                    username: true,
                    displayName: true,
                    isAdmin: true,
                    isBlocked: true,
                    createdAt: true,
                    _count: { select: { messages: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            }),
            prisma.user.count({ where }),
        ]);

        return reply.send({ users, total, page: parseInt(page), limit: take });
    });

    // ── Block/unblock user ──
    app.patch('/users/:id/block', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { blocked } = request.body as { blocked: boolean };

        const user = await prisma.user.update({
            where: { id },
            data: { isBlocked: blocked },
        });

        // If blocking, invalidate sessions
        if (blocked) {
            await prisma.session.deleteMany({ where: { userId: id } });
        }

        return reply.send({ success: true, isBlocked: user.isBlocked });
    });

    // ── Get reports ──
    app.get('/reports', async (request, reply) => {
        const { resolved = 'false' } = request.query as { resolved?: string };

        const reports = await prisma.report.findMany({
            where: { resolved: resolved === 'true' },
            include: {
                reporter: {
                    select: { id: true, username: true, displayName: true },
                },
                reported: {
                    select: { id: true, username: true, displayName: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return reply.send(reports);
    });

    // ── Resolve report ──
    app.patch('/reports/:id/resolve', async (request, reply) => {
        const { id } = request.params as { id: string };

        await prisma.report.update({
            where: { id },
            data: { resolved: true },
        });

        return reply.send({ success: true });
    });

    // ── Stats ──
    app.get('/stats', async (request, reply) => {
        const [totalUsers, totalChats, totalMessages, activeReports] = await Promise.all([
            prisma.user.count(),
            prisma.chat.count(),
            prisma.message.count(),
            prisma.report.count({ where: { resolved: false } }),
        ]);

        return reply.send({ totalUsers, totalChats, totalMessages, activeReports });
    });
}
