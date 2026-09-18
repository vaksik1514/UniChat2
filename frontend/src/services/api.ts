const API_URL = import.meta.env.VITE_API_URL || '/api';

class ApiService {
    private baseUrl: string;

    constructor() {
        this.baseUrl = API_URL;
    }

    private getHeaders(): HeadersInit {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('accessToken');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    private async request(url: string, options: RequestInit = {}): Promise<any> {
        // Merge auth headers
        const headers = { ...this.getHeaders(), ...(options.headers || {}) };

        let response = await fetch(url, { ...options, headers });

        // If 401 — try refresh and retry
        if (response.status === 401) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                const retryHeaders = { ...this.getHeaders(), ...(options.headers || {}) };
                response = await fetch(url, { ...options, headers: retryHeaders });
            } else {
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                window.location.href = '/login';
                throw new Error('Unauthorized');
            }
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Request failed (${response.status})`);
        }
        return data;
    }

    private async refreshToken(): Promise<boolean> {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) return false;

        try {
            const response = await fetch(`${this.baseUrl}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });

            if (!response.ok) return false;

            const data = await response.json();
            localStorage.setItem('accessToken', data.accessToken);
            localStorage.setItem('refreshToken', data.refreshToken);
            return true;
        } catch {
            return false;
        }
    }

    // ── Auth ──
    async sendCode(phone: string) {
        const res = await fetch(`${this.baseUrl}/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { error: data.error || 'Failed to send code' };
        }
        return data;
    }

    async verifyCode(phone: string, code: string, deviceFingerprint?: string) {
        const res = await fetch(`${this.baseUrl}/auth/verify-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, code, deviceFingerprint, deviceName: navigator.userAgent }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { error: data.error || 'Verification failed' };
        }
        return data;
    }

    async getMe() {
        return this.request(`${this.baseUrl}/auth/me`);
    }

    async logout() {
        return this.request(`${this.baseUrl}/auth/logout`, { method: 'POST' });
    }

    // ── Users ──
    async updateProfile(data: { username?: string; displayName?: string; bio?: string; locale?: string }) {
        return this.request(`${this.baseUrl}/users/profile`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async searchUsers(query: string) {
        return this.request(`${this.baseUrl}/users/search?q=${encodeURIComponent(query)}`);
    }

    async blockUser(userId: string) {
        return this.request(`${this.baseUrl}/users/block/${userId}`, { method: 'POST' });
    }

    async unblockUser(userId: string) {
        return this.request(`${this.baseUrl}/users/block/${userId}`, { method: 'DELETE' });
    }

    async reportUser(userId: string, reason: string, details?: string) {
        return this.request(`${this.baseUrl}/users/report/${userId}`, {
            method: 'POST',
            body: JSON.stringify({ reason, details }),
        });
    }

    async deleteAccount() {
        return this.request(`${this.baseUrl}/users/account`, { method: 'DELETE' });
    }

    // ── Chats ──
    async getChats() {
        return this.request(`${this.baseUrl}/chats`);
    }

    async createPrivateChat(userId: string) {
        return this.request(`${this.baseUrl}/chats/private`, {
            method: 'POST',
            body: JSON.stringify({ userId }),
        });
    }

    async createGroupChat(name: string, memberIds: string[]) {
        return this.request(`${this.baseUrl}/chats/group`, {
            method: 'POST',
            body: JSON.stringify({ name, memberIds }),
        });
    }

    async getChat(chatId: string) {
        return this.request(`${this.baseUrl}/chats/${chatId}`);
    }

    // ── Messages ──
    async getMessages(chatId: string, cursor?: string) {
        const params = new URLSearchParams();
        if (cursor) params.set('cursor', cursor);
        return this.request(`${this.baseUrl}/messages/${chatId}?${params}`);
    }

    async sendMessage(data: {
        chatId: string;
        content?: string;
        type?: string;
        replyToId?: string;
        fileUrl?: string;
        fileName?: string;
        fileSize?: number;
        mimeType?: string;
        duration?: number;
    }) {
        return this.request(`${this.baseUrl}/messages`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // ── Files ──
    async uploadFile(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        console.log('📤 Uploading file:', file.name, 'size:', file.size, 'type:', file.type);

        const token = localStorage.getItem('accessToken');
        const res = await fetch(`${this.baseUrl}/files/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });

        const data = await res.json().catch(() => ({}));
        console.log('📤 Upload response:', res.status, data);
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data;
    }

    async uploadAvatar(file: File) {
        const formData = new FormData();
        formData.append('file', file);

        const token = localStorage.getItem('accessToken');
        const res = await fetch(`${this.baseUrl}/files/avatar`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data;
    }
}

export const api = new ApiService();
