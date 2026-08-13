// =============================================================================
// FireISP 5.0 — Email Verification Banner
// =============================================================================
// Slim, non-blocking inline bar shown to ANY authenticated user (no permission
// gate — this is a self-service identity action, not an RBAC-scoped one) while
// their email_verified_at is null. Unlike DrDrillBanner (a full-screen modal
// appropriate for an admin-urgent DR compliance issue) this never blocks page
// content — it renders alongside it, and is dismissible per browser session
// via the same sessionStorage mechanism DrDrillBanner uses.
//
// Resend uses authedFetch (not the typed `api` client) to match AuthContext's
// own networking convention for auth-adjacent calls, and because it already
// carries the Bearer/cookie + CSRF + silent-refresh-on-401 handling this POST
// needs.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { authedFetch } from '@/api/client';
import './EmailVerificationBanner.css';

// ---------------------------------------------------------------------------
// Dismiss key — unique per session (mirrors DrDrillBanner.tsx)
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'emailVerifyBannerDismissed';

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // sessionStorage not available (private browsing, etc.) — ignore
  }
}

// ---------------------------------------------------------------------------
// Cooldown durations
// ---------------------------------------------------------------------------

// UX-only local cooldowns — never a security control. The server-side
// verifyEmailResendLimiter (5/window, see src/middleware/rateLimit.js) is the
// real limit; a tampered/bypassed frontend cannot exceed it.
const RESEND_COOLDOWN_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

type SendState = 'idle' | 'sending' | 'sent' | 'rateLimited' | 'error';

interface ResendResponseBody {
  message?: string;
  alreadyVerified?: boolean;
  error?: { code?: string; message?: string };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmailVerificationBanner() {
  const { user, refresh } = useAuth();
  const { t } = useTranslation();
  const [dismissed, setDismissedState] = useState(() => isDismissed());
  const [sendState, setSendState] = useState<SendState>('idle');
  const [cooldown, setCooldown] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If another tab cleared the dismiss flag while this tab was open, pick up
  // the latest value when the component re-evaluates (same as DrDrillBanner).
  useEffect(() => {
    setDismissedState(isDismissed());
  }, []);

  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    [],
  );

  if (!user || user.email_verified_at || dismissed) return null;

  const startCooldown = (ms: number) => {
    setCooldown(true);
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    cooldownTimer.current = setTimeout(() => setCooldown(false), ms);
  };

  const handleResend = async () => {
    setSendState('sending');
    setErrorMsg('');
    try {
      const res = await authedFetch('/api/v1/auth/verify-email/resend', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as ResendResponseBody;

      if (res.status === 429) {
        setErrorMsg(body.error?.message || t('emailVerify.rateLimited'));
        setSendState('rateLimited');
        startCooldown(RATE_LIMIT_COOLDOWN_MS);
        return;
      }
      if (!res.ok) {
        setSendState('error');
        setErrorMsg(t('emailVerify.sendFailed'));
        return;
      }
      if (body.alreadyVerified) {
        // Verified in another tab/request since we last checked — refresh the
        // profile so this banner unmounts on the next render.
        await refresh();
        return;
      }
      setSendState('sent');
      startCooldown(RESEND_COOLDOWN_MS);
    } catch {
      setSendState('error');
      setErrorMsg(t('emailVerify.sendFailed'));
    }
  };

  const handleAlreadyVerified = () => {
    void refresh();
  };

  const handleDismiss = () => {
    setDismissed();
    setDismissedState(true);
  };

  const busy = sendState === 'sending';
  const resendDisabled = busy || cooldown;

  return (
    <div role="status" className="email-verification-banner">
      <span className="email-verification-banner__icon" aria-hidden="true">✉️</span>
      <span className="email-verification-banner__text">
        {sendState === 'sent' ? t('emailVerify.sentConfirm') : t('emailVerify.banner')}
      </span>
      {errorMsg && (sendState === 'rateLimited' || sendState === 'error') && (
        <span className="email-verification-banner__error">{errorMsg}</span>
      )}
      <div className="email-verification-banner__actions">
        <button
          type="button"
          className="email-verification-banner__resend"
          disabled={resendDisabled}
          onClick={handleResend}
        >
          {busy ? t('emailVerify.sending') : t('emailVerify.resend')}
        </button>
        <button
          type="button"
          className="email-verification-banner__refresh"
          onClick={handleAlreadyVerified}
        >
          {t('emailVerify.alreadyDone')}
        </button>
      </div>
      <button
        type="button"
        className="email-verification-banner__dismiss"
        onClick={handleDismiss}
        aria-label={t('emailVerify.dismiss')}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
