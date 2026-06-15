// =============================================================================
// FireISP 5.0 — Portal AI Chat (§11.4)
// =============================================================================
// AI-powered chatbot with automatic ticket-creation fallback.
// =============================================================================

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface Message {
  role: 'client' | 'ai';
  content: string;
  ts: string;
}

interface ChatSession {
  session_id: number;
  session_token: string;
  status: string;
}

interface ChatReply {
  reply: string;
  session_status: string;
  turn_count: number;
  ticket_id: number | null;
}

async function portalPost<T>(path: string, body?: unknown): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(b?.error?.message || 'Request failed');
  }
  return res.json() as Promise<T>;
}

export function PortalChat() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [escalated, setEscalated] = useState(false);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [startError, setStartError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const startMutation = useMutation({
    mutationFn: () => portalPost<{ data: ChatSession }>('/chat/start'),
    onSuccess: ({ data }) => {
      setStartError(null);
      setSession(data);
      setStatus('active');
      setMessages([{
        role: 'ai',
        content: 'Hello! I\'m your virtual assistant. How can I help you today?',
        ts: new Date().toISOString(),
      }]);
    },
    onError: (e: Error) => {
      setStartError(e.message || 'Failed to start chat. Please try again.');
    },
  });

  const sendMutation = useMutation({
    mutationFn: ({ token, message }: { token: string; message: string }) =>
      portalPost<{ data: ChatReply }>(`/chat/${token}/message`, { message }),
    onSuccess: ({ data }, { message }) => {
      const userMsg: Message = { role: 'client', content: message, ts: new Date().toISOString() };
      const aiMsg: Message = { role: 'ai', content: data.reply, ts: new Date().toISOString() };
      setMessages(prev => [...prev, userMsg, aiMsg]);
      setStatus(data.session_status);
      if (data.session_status === 'escalated') {
        setEscalated(true);
        setTicketId(data.ticket_id);
      }
    },
    onError: (_e, { message }) => {
      const userMsg: Message = { role: 'client', content: message, ts: new Date().toISOString() };
      const errMsg: Message = { role: 'ai', content: 'Sorry, I encountered an error. Please try opening a support ticket.', ts: new Date().toISOString() };
      setMessages(prev => [...prev, userMsg, errMsg]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    if (!input.trim() || !session || status !== 'active' || sendMutation.isPending) return;
    const msg = input.trim();
    setInput('');
    sendMutation.mutate({ token: session.session_token, message: msg });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (status === 'idle') {
    return (
      <div>
        <h1 style={styles.heading}>AI Support Chat</h1>
        <p style={styles.sub}>Get instant answers from our AI assistant, available 24/7.</p>
        <div style={styles.startCard}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Our AI assistant can help with billing questions, plan information, connectivity issues, and more.
            If it cannot resolve your issue, it will automatically create a support ticket.
          </p>
          {startError && (
            <div style={styles.startError}>{startError}</div>
          )}
          <button
            style={styles.startBtn}
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
          >
            {startMutation.isPending ? 'Starting…' : 'Start Chat'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={styles.heading}>AI Support Chat</h1>

      {escalated && ticketId && (
        <div style={styles.escalatedBanner}>
          Your issue has been escalated to a human agent.
          {' '}<Link to={`/portal/tickets/${ticketId}`} style={{ color: '#1e40af', fontWeight: 600 }}>
            View ticket #{ticketId}
          </Link>
        </div>
      )}

      <div style={styles.chatBox}>
        <div style={styles.messages}>
          {messages.map((m, i) => (
            <div key={i} style={{ ...styles.bubble, ...(m.role === 'client' ? styles.clientBubble : styles.aiBubble) }}>
              <div style={styles.bubbleContent}>{m.content}</div>
              <div style={styles.bubbleTime}>{m.ts.slice(11, 16)}</div>
            </div>
          ))}
          {sendMutation.isPending && (
            <div style={{ ...styles.bubble, ...styles.aiBubble }}>
              <div style={styles.bubbleContent}>…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={styles.inputRow}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={status === 'active' ? 'Type your message… (Enter to send)' : 'Chat has ended'}
            disabled={status !== 'active' || sendMutation.isPending}
            style={styles.chatInput}
            rows={2}
          />
          <button
            style={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim() || status !== 'active' || sendMutation.isPending}
          >
            Send
          </button>
        </div>
      </div>

      {status !== 'active' && (
        <p style={styles.muted}>
          {escalated ? 'Chat ended — a support ticket has been created.' : 'Chat resolved.'}
          {' '}<Link to="/portal/tickets" style={{ color: 'var(--accent)' }}>View tickets</Link>
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 0.25rem', fontSize: '1.4rem', color: 'var(--text-primary)' },
  sub: { margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.95rem' },
  muted: { color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.75rem' },
  startCard: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.5rem', boxShadow: '0 0 0 1px var(--border)', maxWidth: 500 },
  startBtn: { padding: '0.6rem 1.5rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 },
  startError: { padding: '0.6rem 0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontSize: '0.875rem', marginBottom: '0.75rem' },
  escalatedBanner: { background: '#dbeafe', color: '#1e40af', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' },
  chatBox: { background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)', display: 'flex', flexDirection: 'column', height: 480 },
  messages: { flex: 1, overflowY: 'auto' as const, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  bubble: { maxWidth: '75%', borderRadius: 12, padding: '0.5rem 0.75rem' },
  clientBubble: { alignSelf: 'flex-end', background: 'var(--accent)', color: '#fff', borderBottomRightRadius: 2 },
  aiBubble: { alignSelf: 'flex-start', background: 'var(--bg-subtle)', color: 'var(--text-primary)', borderBottomLeftRadius: 2 },
  bubbleContent: { fontSize: '0.9rem', lineHeight: 1.5 },
  bubbleTime: { fontSize: '0.7rem', opacity: 0.7, marginTop: '0.2rem', textAlign: 'right' as const },
  inputRow: { display: 'flex', gap: '0.5rem', padding: '0.75rem', borderTop: '1px solid var(--border-subtle)' },
  chatInput: { flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem', resize: 'none' as const, background: 'var(--bg-input)', color: 'var(--text-primary)' },
  sendBtn: { padding: '0 1.25rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' },
};
