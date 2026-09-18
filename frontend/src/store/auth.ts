import { create } from 'zustand';

interface User {
    id: string;
    phone: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    isAdmin: boolean;
    locale: string;
}

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    isNewUser: boolean;
    setUser: (user: User) => void;
    setAuth: (data: { accessToken: string; refreshToken: string; user: User; isNewUser: boolean }) => void;
    logout: () => void;
    updateUser: (data: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    isAuthenticated: !!localStorage.getItem('accessToken'),
    isNewUser: false,

    setUser: (user) => set({ user }),

    setAuth: (data) => {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        set({
            user: data.user,
            isAuthenticated: true,
            isNewUser: data.isNewUser,
        });
    },

    logout: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, isAuthenticated: false, isNewUser: false });
    },

    updateUser: (data) =>
        set((state) => ({
            user: state.user ? { ...state.user, ...data } : null,
        })),
}));
