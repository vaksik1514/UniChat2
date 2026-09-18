import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { prisma } from '../utils/prisma';

declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            id: string;
            phone: string;
            username: string | null;
            displayName: string | null;
            isAdmin: boolean;
            sessionId: string;
        };
    }
}

export async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
) {
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];
        const payload = verifyAccessToken(token) as TokenPayload;

        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: {
                id: true,
                phone: true,
                username: true,
                displayName: true,
                isAdmin: true,
                isBlocked: true,
            },
        });

        if (!user) {
            return reply.status(401).send({ error: 'User not found' });
        }

        if (user.isBlocked) {
            return reply.status(403).send({ error: 'Account blocked' });
        }

        request.user = {
            id: user.id,
            phone: user.phone,
            username: user.username,
            displayName: user.displayName,
            isAdmin: user.isAdmin,
            sessionId: payload.sessionId,
        };
    } catch (err) {
        return reply.status(401).send({ error: 'Invalid token' });
    }
}

export async function adminMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
) {
    if (!request.user?.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
    }
}
