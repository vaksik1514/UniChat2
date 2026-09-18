import { io, Socket } from 'socket.io-client';

class SocketService {
    private socket: Socket | null = null;

    connect(token: string) {
        if (this.socket?.connected) return;

        // Connect through Nginx proxy — use relative path
        this.socket = io(window.location.origin, {
            auth: { token },
            path: '/socket.io/',
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
        });

        this.socket.on('connect', () => {
            console.log('🔌 Socket connected:', this.socket?.id);
        });

        this.socket.on('disconnect', (reason) => {
            console.log('🔌 Socket disconnected:', reason);
        });

        this.socket.on('connect_error', (err) => {
            console.error('🔌 Socket error:', err.message);
        });
    }

    disconnect() {
        this.socket?.disconnect();
        this.socket = null;
    }

    // ── Send message via socket ──
    sendMessage(data: any, callback?: (res: any) => void) {
        this.socket?.emit('message:send', data, callback);
    }

    // ── Typing ──
    startTyping(chatId: string) {
        this.socket?.emit('typing:start', { chatId });
    }

    stopTyping(chatId: string) {
        this.socket?.emit('typing:stop', { chatId });
    }

    // ── Read ──
    markRead(chatId: string) {
        this.socket?.emit('message:read', { chatId });
    }

    // ── Edit & Delete ──
    editMessage(messageId: string, content: string, callback?: (res: any) => void) {
        this.socket?.emit('message:edit', { messageId, content }, callback);
    }

    deleteMessage(messageId: string, callback?: (res: any) => void) {
        this.socket?.emit('message:delete', { messageId }, callback);
    }

    // ── Join chat room ──
    joinChat(chatId: string) {
        this.socket?.emit('chat:join', { chatId });
    }

    // ── Listeners ──
    onNewMessage(callback: (message: any) => void) {
        this.socket?.on('message:new', callback);
    }

    offNewMessage(callback: (message: any) => void) {
        this.socket?.off('message:new', callback);
    }

    onTypingStart(callback: (data: { chatId: string; userId: string }) => void) {
        this.socket?.on('typing:start', callback);
    }

    onTypingStop(callback: (data: { chatId: string; userId: string }) => void) {
        this.socket?.on('typing:stop', callback);
    }

    onMessageRead(callback: (data: any) => void) {
        this.socket?.on('message:read', callback);
    }

    onMessageEdited(callback: (message: any) => void) {
        this.socket?.on('message:edited', callback);
    }

    onMessageDeleted(callback: (data: any) => void) {
        this.socket?.on('message:deleted', callback);
    }

    onUserStatus(callback: (data: { userId: string; isOnline: boolean; lastSeen: string }) => void) {
        this.socket?.on('user:status', callback);
    }

    // ── Off methods for cleanup ──
    offTypingStart(callback: Function) {
        this.socket?.off('typing:start', callback as any);
    }

    offTypingStop(callback: Function) {
        this.socket?.off('typing:stop', callback as any);
    }

    offMessageEdited(callback: Function) {
        this.socket?.off('message:edited', callback as any);
    }

    offMessageDeleted(callback: Function) {
        this.socket?.off('message:deleted', callback as any);
    }

    offUserStatus(callback: Function) {
        this.socket?.off('user:status', callback as any);
    }

    removeAllListeners() {
        this.socket?.removeAllListeners();
    }
}

export const socketService = new SocketService();
