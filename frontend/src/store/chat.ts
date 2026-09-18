import { create } from 'zustand';

interface Message {
    id: string;
    chatId: string;
    senderId: string;
    type: string;
    content: string | null;
    fileUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
    duration: number | null;
    replyToId: string | null;
    replyTo: any | null;
    editedAt: string | null;
    deletedAt: string | null;
    createdAt: string;
    sender: {
        id: string;
        username: string | null;
        displayName: string | null;
        avatarUrl: string | null;
    };
}

interface Chat {
    id: string;
    type: 'PRIVATE' | 'GROUP';
    name: string | null;
    avatarUrl: string | null;
    members: any[];
    messages: any[];
    updatedAt: string;
}

interface ChatState {
    chats: Chat[];
    activeChat: Chat | null;
    messages: Record<string, Message[]>;
    typingUsers: Record<string, string[]>;
    onlineUsers: Set<string>;

    setChats: (chats: Chat[]) => void;
    setActiveChat: (chat: Chat | null) => void;
    addChat: (chat: Chat) => void;
    setMessages: (chatId: string, messages: Message[]) => void;
    addMessage: (message: Message) => void;
    updateMessage: (message: Message) => void;
    deleteMessage: (chatId: string, messageId: string) => void;
    setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
    setUserOnline: (userId: string, isOnline: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
    chats: [],
    activeChat: null,
    messages: {},
    typingUsers: {},
    onlineUsers: new Set(),

    setChats: (chats) => set({ chats }),

    setActiveChat: (chat) => set({ activeChat: chat }),

    addChat: (chat) =>
        set((state) => ({
            chats: [chat, ...state.chats.filter((c) => c.id !== chat.id)],
        })),

    setMessages: (chatId, messages) =>
        set((state) => ({
            messages: { ...state.messages, [chatId]: messages },
        })),

    addMessage: (message) =>
        set((state) => {
            const existing = state.messages[message.chatId] || [];
            // Avoid duplicates
            if (existing.some((m) => m.id === message.id)) return state;

            const newMessages = {
                ...state.messages,
                [message.chatId]: [...existing, message],
            };

            // Move chat to top
            const chatIndex = state.chats.findIndex((c) => c.id === message.chatId);
            let newChats = [...state.chats];
            if (chatIndex > 0) {
                const [chat] = newChats.splice(chatIndex, 1);
                chat.messages = [{ ...message }];
                newChats = [chat, ...newChats];
            } else if (chatIndex === 0) {
                newChats[0] = { ...newChats[0], messages: [{ ...message }] };
            }

            return { messages: newMessages, chats: newChats };
        }),

    updateMessage: (message) =>
        set((state) => {
            const existing = state.messages[message.chatId] || [];
            return {
                messages: {
                    ...state.messages,
                    [message.chatId]: existing.map((m) =>
                        m.id === message.id ? { ...m, ...message } : m
                    ),
                },
            };
        }),

    deleteMessage: (chatId, messageId) =>
        set((state) => {
            const existing = state.messages[chatId] || [];
            return {
                messages: {
                    ...state.messages,
                    [chatId]: existing.map((m) =>
                        m.id === messageId ? { ...m, deletedAt: new Date().toISOString() } : m
                    ),
                },
            };
        }),

    setTyping: (chatId, userId, isTyping) =>
        set((state) => {
            const current = state.typingUsers[chatId] || [];
            const updated = isTyping
                ? [...new Set([...current, userId])]
                : current.filter((id) => id !== userId);
            return {
                typingUsers: { ...state.typingUsers, [chatId]: updated },
            };
        }),

    setUserOnline: (userId, isOnline) =>
        set((state) => {
            const newSet = new Set(state.onlineUsers);
            if (isOnline) newSet.add(userId);
            else newSet.delete(userId);
            return { onlineUsers: newSet };
        }),
}));
