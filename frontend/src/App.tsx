import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
import ProfileSetupPage from './pages/ProfileSetupPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return <>{children}</>;
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
                path="/profile-setup"
                element={
                    <ProtectedRoute>
                        <ProfileSetupPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/chat/:chatId?"
                element={
                    <ProtectedRoute>
                        <ChatPage />
                    </ProtectedRoute>
                }
            />
            <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
    );
}
