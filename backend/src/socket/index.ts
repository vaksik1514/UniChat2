import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';
import { redis } from '../utils/redis';

interface AuthenticatedSocket extends Socket {
    userId?: string;
}

export function setupSocket(io: Server) {
    // ── Auth middleware ──
    io.use(async (socket: AuthenticatedSocket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
            if (!token) {
                return next(new Error('Authentication required'));
            }

            const payload = verifyAccessToken(token);
            const user = await prisma.user.findUnique({
                where: { id: payload.userId },
                select: { id: true, isBlocked: true },
            });

            if (!user || user.isBlocked) {
                return next(new Error('Unauthorized'));
            }

            socket.userId = user.id;
            next();
        } catch (err) {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', async (socket: AuthenticatedSocket) => {
        const userId = socket.userId!;
        console.log(`🔌 User connected: ${userId}`);

        // Join user's personal room
        socket.join(`user:${userId}`);

        // Set online status
        await redis.set(`user:online:${userId}`, Date.now().toString(), 'EX', 300);

        // Join all user's chat rooms
        const memberships = await prisma.chatMember.findMany({
            where: { userId },
            select: { chatId: true },
        });
        memberships.forEach(m => socket.join(`chat:${m.chatId}`));

        // Broadcast online status to contacts
        broadcastOnlineStatus(io, userId, true);

        // ── Send message ──
        socket.on('message:send', async (data, callback) => {
            try {
                const { chatId, content, type = 'TEXT', replyToId, fileUrl, fileName, fileSize, mimeType, duration } = data;

                // Verify membership
                const member = await prisma.chatMember.findFirst({
                    where: { chatId, userId },
                });
                if (!member) {
                    return callback?.({ error: 'Not a member' });
                }

                const message = await prisma.message.create({
                    data: {
                        chatId,
                        senderId: userId,
                        type,
                        content,
                        replyToId,
                        fileUrl,
                        fileName,
                        fileSize,
                        mimeType,
                        duration,
                    },
                    include: {
                        sender: {
                            select: { id: true, username: true, displayName: true, avatarUrl: true },
                        },
                        replyTo: {
                            select: {
                                id: true,
                                content: true,
                                sender: { select: { displayName: true } },
                            },
                        },
                    },
                });

                await prisma.chat.update({
                    where: { id: chatId },
                    data: { updatedAt: new Date() },
                });

                // Broadcast to chat room
                io.to(`chat:${chatId}`).emit('message:new', message);

                callback?.({ success: true, message });
            } catch (err: any) {
                callback?.({ error: err.message });
            }
        });

        // ── Typing indicator ──
        socket.on('typing:start', (data) => {
            socket.to(`chat:${data.chatId}`).emit('typing:start', {
                chatId: data.chatId,
                userId,
            });
        });

        socket.on('typing:stop', (data) => {
            socket.to(`chat:${data.chatId}`).emit('typing:stop', {
                chatId: data.chatId,
                userId,
            });
        });

        // ── Message read ──
        socket.on('message:read', async (data) => {
            const { chatId } = data;

            await prisma.chatMember.updateMany({
                where: { chatId, userId },
                data: { lastReadAt: new Date() },
            });

            socket.to(`chat:${chatId}`).emit('message:read', {
                chatId,
                userId,
                readAt: new Date(),
            });
        });

        // ── Message edit ──
        socket.on('message:edit', async (data, callback) => {
            try {
                const { messageId, content } = data;

                const message = await prisma.message.findUnique({ where: { id: messageId } });
                if (!message || message.senderId !== userId) {
                    return callback?.({ error: 'Cannot edit' });
                }

                const updated = await prisma.message.update({
                    where: { id: messageId },
                    data: { content, editedAt: new Date() },
                    include: {
                        sender: {
                            select: { id: true, username: true, displayName: true, avatarUrl: true },
                        },
                    },
                });

                io.to(`chat:${message.chatId}`).emit('message:edited', updated);
                callback?.({ success: true });
            } catch (err: any) {
                callback?.({ error: err.message });
            }
        });

        // ── Message delete ──
        socket.on('message:delete', async (data, callback) => {
            try {
                const { messageId } = data;

                const message = await prisma.message.findUnique({ where: { id: messageId } });
                if (!message || message.senderId !== userId) {
                    return callback?.({ error: 'Cannot delete' });
                }

                await prisma.message.update({
                    where: { id: messageId },
                    data: { deletedAt: new Date() },
                });

                io.to(`chat:${message.chatId}`).emit('message:deleted', {
                    messageId,
                    chatId: message.chatId,
                });

                callback?.({ success: true });
            } catch (err: any) {
                callback?.({ error: err.message });
            }
        });

        // ── Join chat room (when new chat created) ──
        socket.on('chat:join', (data) => {
            socket.join(`chat:${data.chatId}`);
        });

        // ── Heartbeat for online status ──
        const heartbeat = setInterval(async () => {
            await redis.set(`user:online:${userId}`, Date.now().toString(), 'EX', 300);
        }, 60000);

        // ── Disconnect ──
        socket.on('disconnect', async () => {
            console.log(`🔌 User disconnected: ${userId}`);
            clearInterval(heartbeat);
            await redis.del(`user:online:${userId}`);
            broadcastOnlineStatus(io, userId, false);
        });
    });
}

async function broadcastOnlineStatus(io: Server, userId: string, isOnline: boolean) {
    // Get all chats this user is in
    const memberships = await prisma.chatMember.findMany({
        where: { userId },
        select: { chatId: true },
    });

    memberships.forEach(m => {
        io.to(`chat:${m.chatId}`).emit('user:status', {
            userId,
            isOnline,
            lastSeen: new Date(),
        });
    });
}
