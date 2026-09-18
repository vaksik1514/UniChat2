import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';

// ── Helpers ──
function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Сегодня';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
    return d.toLocaleDateString();
}

function getInitials(name: string | null | undefined): string {
    if (!name) return '?';
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarClass(id: string): string {
    const num = (id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % 7 + 1;
    return `avatar-gradient-${num}`;
}

function formatFileSize(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Voice Player Component ──
function VoicePlayer({ src }: { src: string }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [maxTime, setMaxTime] = useState(0); // track max currentTime for Infinity duration
    const [error, setError] = useState<string | null>(null);
    const [waveform] = useState(() =>
        Array.from({ length: 28 }, () => 8 + Math.random() * 24)
    );

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (error) {
            // Retry on error
            setError(null);
            audio.load();
            audio.play().catch((err) => {
                console.error('🔊 Audio play error:', err);
                setError(err.message);
            });
            return;
        }
        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch((err) => {
                console.error('🔊 Audio play error:', err);
                setError(err.message);
            });
        }
    };

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onPlay = () => { console.log('🔊 Playing:', src); setIsPlaying(true); };
        const onPause = () => setIsPlaying(false);
        const onEnded = () => {
            setIsPlaying(false);
            // When ended, currentTime is the real duration for WebM (which reports Infinity)
            if (!isFinite(duration) || duration === 0) {
                setDuration(audio.currentTime || maxTime);
            }
            setCurrentTime(0);
        };
        const onTimeUpdate = () => {
            const t = audio.currentTime;
            setCurrentTime(t);
            if (t > maxTime) setMaxTime(t);
        };
        const onLoadedMetadata = () => {
            const d = audio.duration;
            console.log('🔊 Audio loaded, duration:', d, 'src:', src);
            if (isFinite(d) && d > 0) {
                setDuration(d);
            }
        };
        const onDurationChange = () => {
            const d = audio.duration;
            if (isFinite(d) && d > 0) {
                setDuration(d);
            }
        };
        const onError = () => {
            const e = audio.error;
            console.error('🔊 Audio error:', e?.code, e?.message, 'src:', src);
            setError(`Audio error: ${e?.message || 'unknown'}`);
        };

        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('durationchange', onDurationChange);
        audio.addEventListener('error', onError);

        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('durationchange', onDurationChange);
            audio.removeEventListener('error', onError);
        };
    }, [src]);

    // For WebM with Infinity duration, use currentTime for progress
    const effectiveDuration = (isFinite(duration) && duration > 0) ? duration : maxTime || 0;
    const progress = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;
    const activeBars = Math.floor((progress / 100) * waveform.length);

    const handleBarClick = (index: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        // Only allow seeking if we have a finite duration
        if (isFinite(duration) && duration > 0) {
            audio.currentTime = (index / waveform.length) * duration;
        }
    };

    const displayTime = isPlaying
        ? formatDuration(currentTime)
        : effectiveDuration > 0 ? formatDuration(effectiveDuration) : '0:00';

    return (
        <div className="voice-player">
            <audio ref={audioRef} src={src} preload="auto" />
            <button className="voice-play-btn" onClick={togglePlay} type="button">
                {error ? '⚠️' : isPlaying ? '⏸' : '▶'}
            </button>
            <div className="voice-waveform">
                {waveform.map((h: number, i: number) => (
                    <div
                        key={i}
                        className={`voice-bar ${i < activeBars ? 'active' : ''}`}
                        style={{ height: `${h}px` }}
                        onClick={() => handleBarClick(i)}
                    />
                ))}
            </div>
            <span className="voice-duration">
                {displayTime}
            </span>
        </div>
    );
}

// ── Profile Panel Component ──
function ProfilePanel({
    user,
    onClose,
    onUpdate,
}: {
    user: any;
    onClose: () => void;
    onUpdate: (data: any) => void;
}) {
    const { t } = useTranslation();
    const [displayName, setDisplayName] = useState(user?.displayName || '');
    const [username, setUsername] = useState(user?.username || '');
    const [bio, setBio] = useState(user?.bio || '');
    const [saving, setSaving] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement>(null);

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await api.updateProfile({ displayName, username, bio });
            onUpdate(updated);
        } catch (err: any) {
            console.error('Profile save failed:', err);
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const result = await api.uploadAvatar(file);
            onUpdate({ avatarUrl: result.avatarUrl });
        } catch (err: any) {
            console.error('Avatar upload failed:', err);
        }
        e.target.value = '';
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
                <div className="profile-modal-header">
                    <h3>👤 {t('profile.edit')}</h3>
                    <button className="btn-icon" onClick={onClose}>✕</button>
                </div>

                <div className="profile-avatar-section">
                    <div
                        className={`avatar avatar-xl ${getAvatarClass(user?.id || 'x')} profile-avatar-clickable`}
                        onClick={() => avatarInputRef.current?.click()}
                    >
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="" />
                        ) : (
                            getInitials(user?.displayName || user?.username)
                        )}
                        <div className="avatar-overlay">📷</div>
                    </div>
                    <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        onChange={handleAvatarUpload}
                    />
                    <p className="profile-avatar-hint">{t('profile.setup')}</p>
                </div>

                <div className="input-group">
                    <label className="input-label">{t('profile.displayName')}</label>
                    <input
                        className="input"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Ваше имя"
                    />
                </div>

                <div className="input-group">
                    <label className="input-label">{t('profile.username')}</label>
                    <input
                        className="input"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32))}
                        placeholder="username"
                    />
                </div>

                <div className="input-group">
                    <label className="input-label">{t('profile.bio')}</label>
                    <textarea
                        className="input"
                        value={bio}
                        onChange={(e) => setBio(e.target.value.slice(0, 200))}
                        placeholder="О себе..."
                        rows={3}
                        style={{ resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
                        {bio.length}/200
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '...' : t('profile.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════
// ── MAIN CHAT PAGE ──
// ══════════════════════════════════════════════
export default function ChatPage() {
    const { t, i18n } = useTranslation();
    const { chatId } = useParams();
    const navigate = useNavigate();

    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const setUser = useAuthStore((s) => s.setUser);
    const updateUser = useAuthStore((s) => s.updateUser);

    const {
        chats, setChats, activeChat, setActiveChat,
        messages, setMessages, addMessage, updateMessage, deleteMessage,
        typingUsers, setTyping, setUserOnline, onlineUsers,
    } = useChatStore();

    const [messageText, setMessageText] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [showNewChat, setShowNewChat] = useState(false);
    const [showNewGroup, setShowNewGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [showSettings, setShowSettings] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [replyTo, setReplyTo] = useState<any>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [activeFolder, setActiveFolder] = useState<string>('all');
    const [socketReady, setSocketReady] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const typingTimeoutRef = useRef<NodeJS.Timeout>();
    const recordingTimerRef = useRef<NodeJS.Timeout>();

    // ── STEP 1: Connect socket FIRST, then fetch data ──
    useEffect(() => {
        const token = localStorage.getItem('accessToken');
        if (token) {
            socketService.connect(token);
        }

        // Small delay to let socket establish, then fetch data
        const fetchData = async () => {
            try {
                const me = await api.getMe();
                setUser(me);
                const chatList = await api.getChats();
                setChats(chatList);
                // Mark socket as ready AFTER connection and data load
                setSocketReady(true);
            } catch {
                logout();
                navigate('/login');
            }
        };
        fetchData();

        return () => {
            socketService.removeAllListeners();
            socketService.disconnect();
        };
    }, []);

    // ── STEP 2: Attach socket listeners only when socket is ready and user is loaded ──
    useEffect(() => {
        if (!socketReady || !user?.id) return;

        const handleNewMessage = (message: any) => {
            console.log('📩 New message received:', message.id);
            addMessage(message);
        };
        const handleTypingStart = (data: any) => {
            if (data.userId !== user.id) setTyping(data.chatId, data.userId, true);
        };
        const handleTypingStop = (data: any) => setTyping(data.chatId, data.userId, false);
        const handleMessageEdited = (message: any) => updateMessage(message);
        const handleMessageDeleted = (data: any) => deleteMessage(data.chatId, data.messageId);
        const handleUserStatus = (data: any) => setUserOnline(data.userId, data.isOnline);

        socketService.onNewMessage(handleNewMessage);
        socketService.onTypingStart(handleTypingStart);
        socketService.onTypingStop(handleTypingStop);
        socketService.onMessageEdited(handleMessageEdited);
        socketService.onMessageDeleted(handleMessageDeleted);
        socketService.onUserStatus(handleUserStatus);

        return () => {
            socketService.offNewMessage(handleNewMessage);
            socketService.offTypingStart(handleTypingStart);
            socketService.offTypingStop(handleTypingStop);
            socketService.offMessageEdited(handleMessageEdited);
            socketService.offMessageDeleted(handleMessageDeleted);
            socketService.offUserStatus(handleUserStatus);
        };
    }, [socketReady, user?.id]);

    // ── Load chat when chatId changes ──
    useEffect(() => {
        if (chatId) loadChat(chatId);
        else setActiveChat(null);
    }, [chatId]);

    // ── Auto-scroll on new messages ──
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages[chatId || '']]);

    const loadChat = async (id: string) => {
        try {
            const chat = await api.getChat(id);
            setActiveChat(chat);
            const msgData = await api.getMessages(id);
            setMessages(id, msgData.messages);
            socketService.markRead(id);
        } catch (err) {
            console.error('Failed to load chat:', err);
        }
    };

    const getChatName = (chat: any): string => {
        if (chat.type === 'GROUP') return chat.name || 'Group';
        const other = chat.members?.find((m: any) => m.user.id !== user?.id);
        return other?.user.displayName || other?.user.username || 'Chat';
    };

    const getChatAvatar = (chat: any): string | null => {
        if (chat.type === 'GROUP') return chat.avatarUrl;
        const other = chat.members?.find((m: any) => m.user.id !== user?.id);
        return other?.user.avatarUrl;
    };

    const getOtherUserId = (chat: any): string | null => {
        if (chat.type !== 'PRIVATE') return null;
        return chat.members?.find((m: any) => m.user.id !== user?.id)?.user.id || null;
    };

    const getChatAvatarId = (chat: any): string => {
        if (chat.type === 'GROUP') return chat.id;
        const other = chat.members?.find((m: any) => m.user.id !== user?.id);
        return other?.user.id || chat.id;
    };

    // ── Folder filtering ──
    const filteredChats = chats.filter((chat) => {
        if (activeFolder === 'all') return true;
        if (activeFolder === 'private') return chat.type === 'PRIVATE';
        if (activeFolder === 'groups') return chat.type === 'GROUP';
        return true;
    });

    // ── Send message ──
    const handleSendMessage = async () => {
        if (!messageText.trim() || !chatId) return;
        const data: any = { chatId, content: messageText.trim(), type: 'TEXT' };
        if (replyTo) data.replyToId = replyTo.id;
        socketService.sendMessage(data);
        setMessageText('');
        setReplyTo(null);
        socketService.stopTyping(chatId);
    };

    const handleTyping = () => {
        if (!chatId) return;
        socketService.startTyping(chatId);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => socketService.stopTyping(chatId), 2000);
    };

    // ── File upload ──
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !chatId) return;
        try {
            const result = await api.uploadFile(file);
            const isImage = file.type.startsWith('image/');
            socketService.sendMessage({
                chatId,
                type: isImage ? 'IMAGE' : 'FILE',
                fileUrl: result.url,
                fileName: result.fileName,
                fileSize: file.size,
                mimeType: result.mimeType,
                content: isImage ? '📷 Фото' : `📎 ${result.fileName}`,
            });
        } catch (err) {
            console.error('Upload failed:', err);
        }
        e.target.value = '';
    };

    // ── Voice recording ──
    const recordingTimeRef = useRef(0);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

    useEffect(() => {
        const getDevices = async () => {
            try {
                // Request permission first to get labels
                await navigator.mediaDevices.getUserMedia({ audio: true });
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                setAudioDevices(audioInputs);
                if (audioInputs.length > 0 && !selectedDeviceId) {
                    setSelectedDeviceId(audioInputs[0].deviceId);
                }
            } catch (err) {
                console.error('Error enumerating devices:', err);
            }
        };
        getDevices();
    }, []);

    const startRecording = async () => {
        try {
            const constraints: MediaStreamConstraints = {
                audio: {
                    deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const audioTrack = stream.getAudioTracks()[0];
            console.log('🎙️ Got mic stream, tracks:', stream.getAudioTracks().length);
            console.log('🎙️ Mic device:', audioTrack?.label || 'unknown');
            console.log('🎙️ Mic settings:', JSON.stringify(audioTrack?.getSettings()));

            // ── Web Audio API: monitor mic level ──
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            // Monitor mic levels periodically
            const levelInterval = setInterval(() => {
                analyser.getByteTimeDomainData(dataArray);
                let maxAmplitude = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const amplitude = Math.abs(dataArray[i] - 128);
                    if (amplitude > maxAmplitude) maxAmplitude = amplitude;
                }
                const level = Math.round((maxAmplitude / 128) * 100);
                console.log(`🎙️ Mic level: ${level}% (max amplitude: ${maxAmplitude}/128) ${level > 5 ? '🔊 SOUND DETECTED' : '🔇 SILENCE'}`);
            }, 1000);

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : '';
            console.log('🎙️ Using mimeType:', mimeType || '(browser default)');

            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];
            recordingTimeRef.current = 0;

            recorder.ondataavailable = (e) => {
                console.log('🎙️ Data chunk:', e.data.size, 'bytes');
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            recorder.onstop = async () => {
                // Stop mic level monitoring
                clearInterval(levelInterval);
                source.disconnect();
                audioCtx.close();

                const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
                console.log('🎙️ Recording complete. Blob size:', blob.size, 'type:', blob.type, 'chunks:', audioChunksRef.current.length);

                // ── Analyze recorded audio for actual content ──
                try {
                    const arrayBuffer = await blob.arrayBuffer();
                    const decodeCtx = new AudioContext();
                    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
                    const channelData = audioBuffer.getChannelData(0);
                    let maxSample = 0;
                    let rms = 0;
                    for (let i = 0; i < channelData.length; i++) {
                        const abs = Math.abs(channelData[i]);
                        if (abs > maxSample) maxSample = abs;
                        rms += channelData[i] * channelData[i];
                    }
                    rms = Math.sqrt(rms / channelData.length);
                    console.log(`🎙️ Audio analysis: duration=${audioBuffer.duration.toFixed(2)}s, maxSample=${maxSample.toFixed(4)}, RMS=${rms.toFixed(6)}, sampleRate=${audioBuffer.sampleRate}`);
                    if (maxSample < 0.01) {
                        console.error('🎙️ ❌ RECORDING IS SILENT! Max sample is near zero. Check your microphone!');
                    } else {
                        console.log('🎙️ ✅ Recording contains audio data!');
                    }
                    decodeCtx.close();
                } catch (analyzeErr) {
                    console.error('🎙️ Audio analysis failed:', analyzeErr);
                }

                const file = new File([blob], `voice_${Date.now()}.webm`, { type: recorder.mimeType });
                try {
                    const result = await api.uploadFile(file);
                    console.log('🎙️ Uploaded. URL:', result.url, 'mimeType:', result.mimeType);
                    if (chatId) {
                        socketService.sendMessage({
                            chatId,
                            type: 'VOICE',
                            fileUrl: result.url,
                            fileName: result.fileName,
                            mimeType: result.mimeType || recorder.mimeType,
                            content: '🎤 Голосовое сообщение',
                            duration: recordingTimeRef.current,
                        });
                    }
                } catch (err) {
                    console.error('🎙️ Voice upload failed:', err);
                }
                stream.getTracks().forEach((t) => t.stop());
                setRecordingTime(0);
                recordingTimeRef.current = 0;
            };

            recorder.start(1000); // collect data every 1s for larger chunks
            setIsRecording(true);

            // Recording timer
            let sec = 0;
            recordingTimerRef.current = setInterval(() => {
                sec++;
                recordingTimeRef.current = sec;
                setRecordingTime(sec);
            }, 1000);
        } catch (err) {
            console.error('🎙️ Mic access denied:', err);
        }
    };

    const stopRecording = () => {
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null;
            mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
            try { mediaRecorderRef.current.stop(); } catch { }
        }
        setIsRecording(false);
        setRecordingTime(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    // ── Search users ──
    useEffect(() => {
        if (searchQuery.length < 2) { setSearchResults([]); return; }
        const timer = setTimeout(async () => {
            try { setSearchResults(await api.searchUsers(searchQuery)); } catch { }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleCreatePrivateChat = async (userId: string) => {
        try {
            const chat = await api.createPrivateChat(userId);
            setShowNewChat(false);
            setSearchQuery('');
            socketService.joinChat(chat.id);
            setChats(await api.getChats());
            navigate(`/chat/${chat.id}`);
        } catch { }
    };

    const handleCreateGroup = async () => {
        if (!groupName.trim() || selectedMembers.length === 0) return;
        try {
            const chat = await api.createGroupChat(groupName, selectedMembers);
            setShowNewGroup(false);
            setGroupName('');
            setSelectedMembers([]);
            socketService.joinChat(chat.id);
            setChats(await api.getChats());
            navigate(`/chat/${chat.id}`);
        } catch { }
    };

    const handleLogout = async () => {
        try { await api.logout(); } catch { }
        logout();
        navigate('/login');
    };

    const switchLang = (lng: string) => {
        i18n.changeLanguage(lng);
        localStorage.setItem('locale', lng);
        api.updateProfile({ locale: lng }).catch(() => { });
    };

    const handleProfileUpdate = (data: any) => {
        updateUser(data);
    };

    const chatMessages = messages[chatId || ''] || [];
    const chatTyping = typingUsers[chatId || ''] || [];
    let lastDate = '';

    // ── Folders config ──
    const folders = [
        { id: 'all', label: 'Все', icon: '💬' },
        { id: 'private', label: 'Личные', icon: '👤' },
        { id: 'groups', label: 'Группы', icon: '👥' },
    ];

    return (
        <div className={`app-layout ${chatId ? 'chat-open' : ''}`}>
            {/* ═══ SIDEBAR ═══ */}
            <div className="sidebar">
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <div className="sidebar-logo-icon">💬</div>
                        <h1>Anfeelgram</h1>
                    </div>
                    <div className="sidebar-actions">
                        <button className="btn-icon" onClick={() => { setShowNewChat(true); setSearchQuery(''); }} title={t('chat.newChat')}>✏️</button>
                        <button className="btn-icon" onClick={() => { setShowNewGroup(true); setSearchQuery(''); setSelectedMembers([]); }} title={t('chat.newGroup')}>👥</button>
                        <button className="btn-icon" onClick={() => setShowProfile(true)} title={t('profile.edit')}>👤</button>
                        <button className="btn-icon" onClick={() => setShowSettings(!showSettings)} title={t('settings.title')}>⚙️</button>
                    </div>
                </div>

                {showSettings && (
                    <div className="settings-panel">
                        <div className="settings-item">
                            <span className="settings-item-label">{t('settings.language')}</span>
                            <div className="lang-switch">
                                <button className={`lang-btn ${i18n.language === 'ru' ? 'active' : ''}`} onClick={() => switchLang('ru')}>RU</button>
                                <button className={`lang-btn ${i18n.language === 'en' ? 'active' : ''}`} onClick={() => switchLang('en')}>EN</button>
                            </div>
                        </div>
                        <div className="settings-item" onClick={handleLogout} style={{ cursor: 'pointer' }}>
                            <span className="settings-item-label" style={{ color: 'var(--danger)' }}>🚪 {t('settings.logout')}</span>
                        </div>
                    </div>
                )}

                {/* Folder tabs */}
                <div className="folder-tabs">
                    {folders.map((f) => (
                        <button
                            key={f.id}
                            className={`folder-tab ${activeFolder === f.id ? 'active' : ''}`}
                            onClick={() => setActiveFolder(f.id)}
                        >
                            <span className="folder-tab-icon">{f.icon}</span>
                            <span className="folder-tab-label">{f.label}</span>
                        </button>
                    ))}
                </div>

                <div className="sidebar-search">
                    <div className="search-wrapper">
                        <span className="search-icon">🔍</span>
                        <input className="input" placeholder={t('common.search') + '...'} />
                    </div>
                </div>

                <div className="chat-list">
                    {filteredChats.length === 0 && (
                        <div className="empty-state" style={{ padding: '60px 24px' }}>
                            <div className="empty-state-icon">💬</div>
                            <div className="empty-state-title">{t('chat.noChats').split('.')[0]}</div>
                            <div className="empty-state-subtitle">{t('chat.noChats').split('.').slice(1).join('.').trim()}</div>
                        </div>
                    )}
                    {filteredChats.map((chat) => {
                        const name = getChatName(chat);
                        const lastMsg = chat.messages?.[0];
                        const otherUserId = getOtherUserId(chat);
                        const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false;
                        const avatarId = getChatAvatarId(chat);

                        return (
                            <div key={chat.id} className={`chat-item ${chat.id === chatId ? 'active' : ''}`} onClick={() => navigate(`/chat/${chat.id}`)}>
                                <div className={`avatar ${getAvatarClass(avatarId)} ${isOnline ? 'avatar-online' : ''}`}>
                                    {getChatAvatar(chat) ? <img src={getChatAvatar(chat)!} alt="" /> : getInitials(name)}
                                </div>
                                <div className="chat-item-content">
                                    <div className="chat-item-header">
                                        <span className="chat-item-name">
                                            {chat.type === 'GROUP' && <span className="chat-item-type">👥 </span>}
                                            {name}
                                        </span>
                                        {lastMsg && <span className="chat-item-time">{formatTime(lastMsg.createdAt)}</span>}
                                    </div>
                                    <div className="chat-item-preview">{lastMsg?.content || '...'}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ═══ CHAT AREA ═══ */}
            <div className="chat-area">
                {!chatId || !activeChat ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">💬</div>
                        <div className="empty-state-title">Anfeelgram</div>
                        <div className="empty-state-subtitle">{t('chat.noChats')}</div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="chat-header">
                            <button className="btn-icon chat-header-back" onClick={() => navigate('/chat')}>←</button>
                            <div className={`avatar ${getAvatarClass(getChatAvatarId(activeChat))} ${(() => { const uid = getOtherUserId(activeChat); return uid && onlineUsers.has(uid) ? 'avatar-online' : ''; })()}`}>
                                {getChatAvatar(activeChat) ? <img src={getChatAvatar(activeChat)!} alt="" /> : getInitials(getChatName(activeChat))}
                            </div>
                            <div className="chat-header-info">
                                <div className="chat-header-name">{getChatName(activeChat)}</div>
                                <div className={`chat-header-status ${(() => { const uid = getOtherUserId(activeChat); return uid && onlineUsers.has(uid) ? 'online' : ''; })()}`}>
                                    {activeChat.type === 'GROUP'
                                        ? `${activeChat.members.length} ${t('chat.members')}`
                                        : (() => { const uid = getOtherUserId(activeChat); return uid && onlineUsers.has(uid) ? t('chat.online') : t('chat.offline'); })()}
                                </div>
                            </div>
                            <div className="chat-header-actions">
                                <button className="btn-icon" title="Search">🔍</button>
                                <button className="btn-icon" title="More">⋯</button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="messages-container">
                            {chatMessages.length === 0 && (
                                <div className="empty-state">
                                    <div className="empty-state-icon">👋</div>
                                    <div className="empty-state-title">{t('chat.noMessages').split('.')[0]}</div>
                                    <div className="empty-state-subtitle">{t('chat.noMessages').split('.').slice(1).join('.').trim()}</div>
                                </div>
                            )}
                            {chatMessages.map((msg) => {
                                const msgDate = formatDate(msg.createdAt);
                                let showDateSep = false;
                                if (msgDate !== lastDate) { lastDate = msgDate; showDateSep = true; }
                                const isOwn = msg.senderId === user?.id;
                                const isDeleted = !!msg.deletedAt;

                                return (
                                    <div key={msg.id}>
                                        {showDateSep && <div className="date-separator"><span>{msgDate}</span></div>}
                                        <div className={`message-wrapper ${isOwn ? 'own' : ''}`}>
                                            <div className="message">
                                                {!isOwn && activeChat.type === 'GROUP' && (
                                                    <div className="message-sender">{msg.sender?.displayName || msg.sender?.username || 'User'}</div>
                                                )}

                                                {msg.replyTo && (
                                                    <div className="message-reply">
                                                        <div className="message-reply-name">{msg.replyTo.sender?.displayName || 'User'}</div>
                                                        <div className="message-reply-content">{msg.replyTo.content}</div>
                                                    </div>
                                                )}

                                                {isDeleted ? (
                                                    <div className="message-deleted">🚫 {t('chat.deleted')}</div>
                                                ) : (
                                                    <>
                                                        {msg.type === 'IMAGE' && msg.fileUrl && (
                                                            <img className="message-image" src={msg.fileUrl} alt="" loading="lazy" />
                                                        )}

                                                        {msg.type === 'FILE' && msg.fileUrl && (
                                                            <a className="message-file" href={msg.fileUrl} target="_blank" rel="noopener">
                                                                <div className="message-file-icon">📄</div>
                                                                <div className="message-file-info">
                                                                    <div className="message-file-name">{msg.fileName}</div>
                                                                    <div className="message-file-size">{formatFileSize(msg.fileSize)}</div>
                                                                </div>
                                                            </a>
                                                        )}

                                                        {msg.type === 'VOICE' && msg.fileUrl && (
                                                            <VoicePlayer src={msg.fileUrl} />
                                                        )}

                                                        {msg.type === 'TEXT' && <div className="message-content">{msg.content}</div>}
                                                    </>
                                                )}

                                                <div className="message-meta">
                                                    {msg.editedAt && <span className="message-edited">{t('chat.edited')}</span>}
                                                    <span className="message-time">{formatTime(msg.createdAt)}</span>
                                                </div>

                                                {!isDeleted && (
                                                    <div className="message-actions">
                                                        <button className="message-action-btn" onClick={() => setReplyTo(msg)} title={t('chat.reply')}>↩</button>
                                                        {isOwn && (
                                                            <>
                                                                <button className="message-action-btn" onClick={() => { const c = prompt('Edit:', msg.content || ''); if (c !== null) socketService.editMessage(msg.id, c); }} title={t('chat.edit')}>✎</button>
                                                                <button className="message-action-btn" onClick={() => { if (confirm('Delete?')) socketService.deleteMessage(msg.id); }} title={t('chat.delete')}>✕</button>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Typing indicator */}
                        <div className="typing-indicator">
                            {chatTyping.length > 0 && (
                                <>
                                    <div className="typing-dots">
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                    </div>
                                    <span>{t('chat.typing')}</span>
                                </>
                            )}
                        </div>

                        {/* Input area */}
                        <div className="message-input-area">
                            {replyTo && (
                                <div className="reply-bar">
                                    <div className="reply-bar-content">
                                        <div className="reply-bar-name">{replyTo.sender?.displayName || 'User'}</div>
                                        <div className="reply-bar-text">{replyTo.content}</div>
                                    </div>
                                    <button className="btn-icon" onClick={() => setReplyTo(null)} style={{ width: 28, height: 28, fontSize: 14 }}>✕</button>
                                </div>
                            )}

                            {isRecording ? (
                                <div className="recording-bar">
                                    <div className="recording-indicator">
                                        <div className="recording-dot" />
                                        <span className="recording-time">{formatDuration(recordingTime)}</span>
                                    </div>
                                    <div className="recording-wave">
                                        {Array.from({ length: 20 }, (_, i) => (
                                            <div
                                                key={i}
                                                className="recording-wave-bar"
                                                style={{
                                                    animationDelay: `${i * 0.05}s`,
                                                    height: `${8 + Math.random() * 20}px`,
                                                }}
                                            />
                                        ))}
                                    </div>
                                    <button className="btn-icon recording-cancel" onClick={cancelRecording} title="Отмена">✕</button>
                                    <button className="btn-icon recording-stop" onClick={stopRecording} title="Отправить">➤</button>
                                </div>
                            ) : (
                                <div className="message-input-row">
                                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
                                    <button className="btn-icon" onClick={() => fileInputRef.current?.click()} title={t('chat.file')}>📎</button>
                                    <button className="btn-icon" onClick={startRecording} title={t('chat.voice')}>🎤</button>

                                    <textarea
                                        className="input"
                                        placeholder={t('chat.typeMessage')}
                                        value={messageText}
                                        onChange={(e) => { setMessageText(e.target.value); handleTyping(); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                                        rows={1}
                                    />

                                    <button className="send-btn" onClick={handleSendMessage} disabled={!messageText.trim()}>➤</button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* ═══ Profile Modal ═══ */}
            {showProfile && user && (
                <ProfilePanel
                    user={user}
                    onClose={() => setShowProfile(false)}
                    onUpdate={(data) => {
                        handleProfileUpdate(data);
                        // Don't close — let user continue editing
                    }}
                />
            )}

            {/* ═══ NEW CHAT MODAL ═══ */}
            {showNewChat && (
                <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>✏️ {t('chat.newChat')}</h3>
                        <div className="input-group">
                            <input className="input" placeholder={t('chat.searchUsers')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
                        </div>
                        <div className="search-results">
                            {searchResults.map((u) => (
                                <div key={u.id} className="search-result-item" onClick={() => handleCreatePrivateChat(u.id)}>
                                    <div className={`avatar avatar-sm ${getAvatarClass(u.id)}`}>
                                        {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : getInitials(u.displayName || u.username)}
                                    </div>
                                    <div className="search-result-info">
                                        <div className="search-result-name">{u.displayName || u.username || u.id}</div>
                                        {u.username && <div className="search-result-username">@{u.username}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowNewChat(false)}>{t('common.cancel')}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ NEW GROUP MODAL ═══ */}
            {showNewGroup && (
                <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>👥 {t('chat.newGroup')}</h3>
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label">{t('chat.groupName')}</label>
                            <input className="input" value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus />
                        </div>
                        <div className="input-group">
                            <label className="input-label">{t('chat.selectMembers')}</label>
                            <input className="input" placeholder={t('chat.searchUsers')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>
                        <div className="search-results">
                            {searchResults.map((u) => {
                                const isSelected = selectedMembers.includes(u.id);
                                return (
                                    <div key={u.id} className={`search-result-item ${isSelected ? 'selected' : ''}`} onClick={() => {
                                        setSelectedMembers((p) => isSelected ? p.filter((id) => id !== u.id) : [...p, u.id]);
                                    }}>
                                        <div className={`avatar avatar-sm ${getAvatarClass(u.id)}`}>
                                            {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : getInitials(u.displayName || u.username)}
                                        </div>
                                        <div className="search-result-info">
                                            <div className="search-result-name">{u.displayName || u.username || u.id}</div>
                                        </div>
                                        {isSelected && <span className="search-result-check">✓</span>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowNewGroup(false)}>{t('common.cancel')}</button>
                            <button className="btn btn-primary" onClick={handleCreateGroup} disabled={!groupName.trim() || selectedMembers.length === 0}>
                                {t('chat.create')} ({selectedMembers.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
