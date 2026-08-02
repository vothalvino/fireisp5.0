// =============================================================================
// FireISP 5.0 — AI Assistant Settings page (P1 §6.1)
// =============================================================================
// Admin-only page at /ai-assistant.  Five tabs:
//   1. General        — master toggle, per-channel toggles, mode, confidence,
//                        locale, tone, redact-PII switch.
//   2. Providers      — register / test / activate LLM providers.
//   3. Phrase Library — category-grouped phrase editor with locale switcher.
//   4. Forbidden Terms— simple list editor.
//   5. Audit & Metrics— read-only usage stats.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { authedFetch } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiTab = 'general' | 'providers' | 'phrases' | 'forbiddenTerms' | 'audit';

interface AiChannels {
  portal: boolean;
  email: boolean;
  whatsapp: boolean;
  sms: boolean;
}

interface AiPolicy {
  id: number;
  enabled: boolean;
  mode: string;
  active_provider_id: number | null;
  enabled_channels: AiChannels;
  auto_send_confidence: number;
  default_locale: string;
  tone: string;
  redact_pii_before_llm: boolean;
  updated_at: string;
}

interface AiProvider {
  id: number;
  name: string;
  kind: string;
  model: string | null;
  endpoint_url: string | null;
  extra_config: { deployment?: string | null } | null;
  priority: number;
  enabled: boolean;
  status: string;
  created_at: string;
}

interface AiPhrase {
  id: number;
  category: string;
  locale: string;
  text: string;
  created_at: string;
}

interface AiForbiddenTerm {
  id: number;
  term: string;
  locale: string;
  created_at: string;
}

interface AiMetrics {
  drafts_total: number;
  auto_sent: number;
  sent_or_edited: number;
  discarded: number;
  edit_rate: number;
  auto_send_rate: number;
  cost_usd_total: number;
  avg_duration_ms: number;
  date_from: string;
  date_to: string | null;
}

interface AiReplyLog {
  id: number;
  ticket_id: number;
  action: string;
  confidence: number | null;
  provider_id: number | null;
  cost_usd: number | null;
  channel: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1/ai';

// Mirrors GET /ai/providers/catalog. 'openrouter' sits before 'custom' because
// it is the friendlier route to the same hundreds of models (no endpoint URL).
const PROVIDER_KINDS = ['openai', 'azure_openai', 'anthropic', 'gemini', 'ollama', 'openrouter', 'custom'];
// Human labels for the kind dropdown. Without these the options render as raw
// slugs, so "openrouter" (lowercase, sixth in the list) is easy to scan past
// when you are looking for "OpenRouter" — which is exactly what happened. These
// mirror PROVIDER_CATALOG[].label on the backend; the proper fix (driving the
// whole form off GET /providers/catalog) is j62, but a slug in a dropdown is a
// papercut worth removing now.
const PROVIDER_KIND_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  azure_openai: 'Azure OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)',
  openrouter: 'OpenRouter',
  custom: 'Custom (OpenAI-compatible)',
};
const AI_MODES = ['draft_only', 'suggest', 'auto_send'];
const TONES = ['formal', 'friendly', 'technical', 'empathetic'];
const LOCALES = ['en', 'es', 'pt-BR'];
const LOG_ACTIONS = ['proposed', 'edited', 'sent', 'auto_sent', 'discarded', 'failed'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    // The API's error envelope is `{ error: { code, message } }`, an OBJECT.
    // This used to be typed as a string, so `new Error(body.error)` stringified
    // it and every failure on this page read "[object Object]" — no code, no
    // message, nothing to act on. Both shapes are accepted because a few older
    // handlers still return a bare string.
    const body = (await res.json().catch(() => ({}))) as {
      error?: string | { code?: string; message?: string };
      message?: string;
    };
    const detail = typeof body.error === 'string'
      ? body.error
      : body.error?.message ?? body.message;
    throw new Error(detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Shared modal shell
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={sty.overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={sty.modal}>
        <div style={sty.modalHeader}>
          <strong>{title}</strong>
          <button style={sty.closeBtn} onClick={onClose} aria-label="Close modal">✕</button>
        </div>
        <div style={sty.modalBody}>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------------

const EMPTY_POLICY: Partial<AiPolicy> = {
  enabled: false,
  mode: 'draft_only',
  enabled_channels: { portal: true, email: true, whatsapp: false, sms: false },
  auto_send_confidence: 90,
  default_locale: 'en',
  tone: 'formal',
  redact_pii_before_llm: true,
};

function GeneralTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-policy'],
    queryFn: () => apiFetch<{ data: AiPolicy }>(`${API_BASE}/policy`),
  });

  const policy: AiPolicy = data?.data ?? (EMPTY_POLICY as AiPolicy);
  const [form, setForm] = useState<typeof EMPTY_POLICY>({});

  // Initialise form from fetched policy once on first successful load
  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (data?.data && !initialised) {
      const p = data.data;
      setForm({
        enabled: p.enabled,
        mode: p.mode,
        enabled_channels: { ...p.enabled_channels },
        // Backend stores confidence as a 0–1 fraction; the slider works in whole percent.
        auto_send_confidence: Math.round(Number(p.auto_send_confidence) * 100),
        default_locale: p.default_locale,
        tone: p.tone,
        redact_pii_before_llm: p.redact_pii_before_llm,
      });
      setInitialised(true);
    }
  }, [data, initialised]);

  const current = { ...EMPTY_POLICY, ...form };

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`${API_BASE}/policy`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-policy'] });
      setSaveOk(true);
      setSaveError('');
      setTimeout(() => setSaveOk(false), 2000);
    },
    onError: (err: Error) => { setSaveError(err.message); setSaveOk(false); },
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError('');
    saveMutation.mutate({
      enabled: current.enabled,
      mode: current.mode,
      enabled_channels: current.enabled_channels,
      // Convert the whole-percent slider value back to the 0–1 fraction the API expects.
      auto_send_confidence: Number((Number(current.auto_send_confidence) / 100).toFixed(2)),
      default_locale: current.default_locale,
      tone: current.tone,
      redact_pii_before_llm: current.redact_pii_before_llm,
    });
  }

  function setChannel(ch: keyof AiChannels, val: boolean) {
    setForm(f => ({ ...f, enabled_channels: { ...(f.enabled_channels ?? policy.enabled_channels), [ch]: val } }));
  }

  if (isLoading) return <p style={sty.muted}>{t('aiAssistantSettings.general.loading')}</p>;
  if (error) return <p style={sty.errorText}>{t('aiAssistantSettings.general.loadError')}</p>;

  const channels = current.enabled_channels ?? { portal: false, email: false, whatsapp: false, sms: false };

  return (
    <div>
      <div style={sty.tabBar}>
        <h3 style={sty.sectionTitle}>{t('aiAssistantSettings.general.sectionTitle')}</h3>
      </div>

      <form onSubmit={handleSave} style={sty.form}>
        {/* Master toggle */}
        <fieldset style={sty.fieldset}>
          <legend style={sty.legend}>Chatbot</legend>
          <label style={sty.switchRow}>
            <span>{t('aiAssistantSettings.general.enabled')}</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={t('aiAssistantSettings.general.enabled')}
              checked={!!current.enabled}
              onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
            />
          </label>
        </fieldset>

        {/* Per-channel toggles */}
        <fieldset style={sty.fieldset}>
          <legend style={sty.legend}>{t('aiAssistantSettings.general.channels')}</legend>
          {(['portal', 'email', 'whatsapp', 'sms'] as (keyof AiChannels)[]).map(ch => (
            <label key={ch} style={sty.switchRow}>
              <span style={{ textTransform: 'capitalize' }}>{ch}</span>
              <input
                type="checkbox"
                role="switch"
                aria-label={`Enable ${ch} channel`}
                checked={!!channels[ch]}
                onChange={e => setChannel(ch, e.target.checked)}
              />
            </label>
          ))}
        </fieldset>

        {/* Mode */}
        <fieldset style={sty.fieldset}>
          <legend style={sty.legend}>{t('aiAssistantSettings.general.mode')}</legend>
          {AI_MODES.map(m => (
            <label key={m} style={{ ...sty.switchRow, cursor: 'pointer' }}>
              <span style={{ textTransform: 'capitalize' }}>{m.replace(/_/g, ' ')}</span>
              <input
                type="radio"
                name="mode"
                value={m}
                aria-label={`Mode: ${m.replace(/_/g, ' ')}`}
                checked={current.mode === m}
                onChange={() => setForm(f => ({ ...f, mode: m }))}
              />
            </label>
          ))}
        </fieldset>

        {/* Confidence slider — only relevant for auto_send */}
        {current.mode === 'auto_send' && (
          <label style={sty.label}>
            {t('aiAssistantSettings.general.confidence')}: <strong>{current.auto_send_confidence}%</strong>
            <input
              type="range"
              min={50}
              max={100}
              step={1}
              aria-label={t('aiAssistantSettings.general.confidence')}
              value={current.auto_send_confidence ?? 90}
              onChange={e => setForm(f => ({ ...f, auto_send_confidence: Number(e.target.value) }))}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
        )}

        {/* Locale + tone */}
        <div style={sty.row2}>
          <label style={sty.label}>
            {t('aiAssistantSettings.general.locale')}
            <select
              style={sty.select}
              aria-label={t('aiAssistantSettings.general.locale')}
              value={current.default_locale ?? 'en'}
              onChange={e => setForm(f => ({ ...f, default_locale: e.target.value }))}
            >
              {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label style={sty.label}>
            {t('aiAssistantSettings.general.tone')}
            <select
              style={sty.select}
              aria-label={t('aiAssistantSettings.general.tone')}
              value={current.tone ?? 'formal'}
              onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
            >
              {TONES.map(tone => <option key={tone} value={tone} style={{ textTransform: 'capitalize' }}>{tone}</option>)}
            </select>
          </label>
        </div>

        {/* Redact PII */}
        <label style={sty.switchRow}>
          <span>{t('aiAssistantSettings.general.redactPii')}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={t('aiAssistantSettings.general.redactPii')}
            checked={!!current.redact_pii_before_llm}
            onChange={e => setForm(f => ({ ...f, redact_pii_before_llm: e.target.checked }))}
          />
        </label>

        {saveError && <p style={sty.errorText}>{saveError}</p>}
        {saveOk && <p style={sty.successText}>{t('aiAssistantSettings.general.saved')}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="submit" style={sty.btnPrimary} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? t('aiAssistantSettings.general.saving') : t('aiAssistantSettings.general.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers tab
// ---------------------------------------------------------------------------

const EMPTY_PROVIDER = {
  name: '', kind: 'openai', model: '', endpoint: '', deployment: '',
  api_key: '', priority: 10, is_enabled: true,
};

/** Fields that are relevant per-kind */
const KIND_FIELDS: Record<string, string[]> = {
  openai:       ['model', 'api_key'],
  azure_openai: ['endpoint', 'deployment', 'model', 'api_key'],
  anthropic:    ['model', 'api_key'],
  gemini:       ['model', 'api_key'],
  ollama:       ['endpoint', 'model'],
  // No endpoint: the backend knows OpenRouter's base URL.
  openrouter:   ['model', 'api_key'],
  custom:       ['endpoint', 'model', 'api_key'],
};

// ---------------------------------------------------------------------------
// Live model catalog (OpenRouter)
// ---------------------------------------------------------------------------
// The catalog endpoint flags these kinds with `dynamicModels: true`: their
// roster changes weekly, so the model field is a picker over the live list
// instead of a free-text box.  Everything degrades to free text if the live
// list cannot be loaded — a third party being down must never block the form.

const DYNAMIC_MODEL_KINDS = ['openrouter'];

/** One row of GET /ai/providers/models. Prices are USD **per token**. */
interface OpenRouterModel {
  id: string;
  name: string | null;
  context_length: number | null;
  prompt_price: number | null;
  completion_price: number | null;
  free: boolean;
}

interface ModelCatalogResponse {
  kind: string;
  models: OpenRouterModel[];
  cached_at: string | null;
  stale: boolean;
  error: string | null;
}

interface ModelCatalogState {
  models: OpenRouterModel[];
  loading: boolean;
  loaded: boolean;
  stale: boolean;
  error: string;
}

const EMPTY_MODEL_CATALOG: ModelCatalogState = {
  models: [], loading: false, loaded: false, stale: false, error: '',
};

/** USD per token → the per-million-token figure providers actually quote. */
function pricePerMillion(perToken: number | null | undefined): string | null {
  // null means "unknown", which is NOT the same as free — show nothing.
  if (perToken == null || !Number.isFinite(perToken)) return null;
  const perM = perToken * 1e6;
  const digits = perM >= 1 ? 2 : perM >= 0.01 ? 3 : 4;
  return `$${perM.toFixed(digits)}`;
}

function formatContext(len: number | null | undefined): string | null {
  if (!len || !Number.isFinite(len)) return null;
  return len >= 1000 ? `${Math.round(len / 1000)}K` : String(len);
}

/**
 * Model field for a kind with a live catalog: a text input backed by a
 * <datalist>, so typing "claude" or "free" narrows the ~340 entries natively
 * and an unknown id can still be typed by hand.
 */
function LiveModelField({
  value, catalog, onChange, onRefresh,
}: {
  value: string;
  catalog: ModelCatalogState;
  onChange: (model: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  function summary(m: OpenRouterModel): string {
    const parts: string[] = [];
    const ctx = formatContext(m.context_length);
    if (ctx) parts.push(t('aiAssistantSettings.providers.openrouter.context', { tokens: ctx }));
    if (m.free) {
      parts.push(t('aiAssistantSettings.providers.openrouter.free'));
    } else {
      const inPrice = pricePerMillion(m.prompt_price);
      const outPrice = pricePerMillion(m.completion_price);
      if (inPrice) parts.push(t('aiAssistantSettings.providers.openrouter.priceIn', { price: inPrice }));
      if (outPrice) parts.push(t('aiAssistantSettings.providers.openrouter.priceOut', { price: outPrice }));
    }
    return parts.join(' · ');
  }

  // No usable list → plain free-text input (no `list`, no datalist).
  const canPick = catalog.models.length > 0;
  const selected = canPick ? catalog.models.find(m => m.id === value) : undefined;

  return (
    <div style={sty.label}>
      <div style={sty.fieldHeader}>
        <label htmlFor="ai-provider-model">{t('aiAssistantSettings.providers.openrouter.label')}</label>
        <button type="button" style={sty.btnTiny} onClick={onRefresh} disabled={catalog.loading}>
          {catalog.loading
            ? t('aiAssistantSettings.providers.openrouter.refreshing')
            : t('aiAssistantSettings.providers.openrouter.refresh')}
        </button>
      </div>

      <input
        id="ai-provider-model"
        style={sty.input}
        value={value}
        autoComplete="off"
        placeholder="anthropic/claude-sonnet-4.5"
        list={canPick ? 'ai-provider-model-options' : undefined}
        // The status line below (loading / N models / stale / error / unknown
        // model) is the only place the picker explains itself, so it has to be
        // part of the field's accessible description — otherwise a screen-reader
        // user gets an unlabelled text box and never hears that a list exists,
        // that it failed to load, or that the id they typed is not in it.
        aria-describedby="ai-provider-model-status"
        onChange={e => onChange(e.target.value)}
      />
      {canPick && (
        <datalist id="ai-provider-model-options">
          {catalog.models.map(m => {
            const info = summary(m);
            return (
              <option
                key={m.id}
                value={m.id}
                label={info ? `${m.name ?? m.id} — ${info}` : (m.name ?? m.id)}
              />
            );
          })}
        </datalist>
      )}

      <span id="ai-provider-model-status" role="status" aria-live="polite">
      {catalog.loading && (
        <span style={sty.hint}>{t('aiAssistantSettings.providers.openrouter.loading')}</span>
      )}
      {!!catalog.error && (
        <span style={sty.errorText}>
          {t('aiAssistantSettings.providers.openrouter.error', { error: catalog.error })}
        </span>
      )}
      {catalog.loaded && !catalog.loading && !canPick && (
        <span style={sty.hint}>{t('aiAssistantSettings.providers.openrouter.fallback')}</span>
      )}
      {canPick && (
        <span style={sty.hint}>
          {t('aiAssistantSettings.providers.openrouter.available', { total: catalog.models.length })}
        </span>
      )}
      {canPick && catalog.stale && (
        <span style={sty.hint}>{t('aiAssistantSettings.providers.openrouter.stale')}</span>
      )}
      {selected && (
        <span style={sty.hint}>
          {selected.name ?? selected.id}{summary(selected) ? ` · ${summary(selected)}` : ''}
        </span>
      )}
      {canPick && !selected && value.trim() !== '' && (
        <span style={sty.hint}>{t('aiAssistantSettings.providers.openrouter.unknownModel')}</span>
      )}
      </span>
    </div>
  );
}

function ProvidersTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PROVIDER });
  const [formError, setFormError] = useState('');
  const [verifyResult, setVerifyResult] = useState<{ id: number; ok: boolean; msg: string } | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  // Live model list, cached here for the lifetime of the tab so flipping the
  // kind select back and forth does not refetch.
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogState>(EMPTY_MODEL_CATALOG);

  // Policy is needed for active_provider_id
  const { data: policyData } = useQuery({
    queryKey: ['ai-policy'],
    queryFn: () => apiFetch<{ data: AiPolicy }>(`${API_BASE}/policy`),
  });
  const activeProviderId = policyData?.data?.active_provider_id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => apiFetch<{ data: AiProvider[] }>(`${API_BASE}/providers`),
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? apiFetch(`${API_BASE}/providers/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        : apiFetch(`${API_BASE}/providers`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-providers'] });
      closeModal();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`${API_BASE}/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-providers'] }); setDeleteId(null); },
  });

  const activateMutation = useMutation({
    mutationFn: (providerId: number) =>
      apiFetch(`${API_BASE}/policy`, { method: 'PUT', body: JSON.stringify({ active_provider_id: providerId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-policy'] }),
  });

  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: number; priority: number }) =>
      apiFetch(`${API_BASE}/providers/${id}`, { method: 'PUT', body: JSON.stringify({ priority }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  /**
   * Fetch the live model list.  Never throws to the caller: an upstream outage
   * lands in `error` and the field falls back to free text.
   */
  const loadModelCatalog = useCallback(async (force = false) => {
    setModelCatalog(s => ({ ...s, loading: true, error: '' }));
    try {
      const res = await apiFetch<{ data: ModelCatalogResponse }>(
        `${API_BASE}/providers/models?kind=openrouter${force ? '&force=1' : ''}`,
      );
      setModelCatalog({
        models: res.data?.models ?? [],
        loading: false,
        loaded: true,
        stale: !!res.data?.stale,
        error: res.data?.error ?? '',
      });
    } catch (err) {
      setModelCatalog({
        models: [], loading: false, loaded: true, stale: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // Lazy: only fetched once the operator actually picks a dynamic-model kind.
  useEffect(() => {
    if (!showModal || !DYNAMIC_MODEL_KINDS.includes(form.kind)) return;
    if (modelCatalog.loaded || modelCatalog.loading) return;
    void loadModelCatalog();
  }, [showModal, form.kind, modelCatalog.loaded, modelCatalog.loading, loadModelCatalog]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_PROVIDER });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(p: AiProvider) {
    setEditing(p);
    setForm({
      name: p.name, kind: p.kind, model: p.model ?? '',
      endpoint: p.endpoint_url ?? '', deployment: p.extra_config?.deployment ?? '',
      api_key: '', priority: p.priority, is_enabled: !!p.enabled,
    });
    setFormError('');
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError(t('aiAssistantSettings.errors.nameRequired')); return; }
    const body: Record<string, unknown> = {
      name: form.name, kind: form.kind,
      priority: Number(form.priority),
      enabled: form.is_enabled,
    };
    if (form.model) body.model = form.model;
    if (form.endpoint) body.endpoint_url = form.endpoint;
    if (form.deployment) body.extra_config = { deployment: form.deployment };
    if (form.api_key) body.api_key = form.api_key;
    saveMutation.mutate(body);
  }

  async function handleVerify(id: number) {
    setVerifyingId(id);
    setVerifyResult(null);
    try {
      const res = await apiFetch<{ data: { ok: boolean; model?: string; latency_ms?: number } }>(
        `${API_BASE}/providers/${id}/verify`, { method: 'POST' },
      );
      const ok = !!res.data.ok;
      setVerifyResult({
        id,
        ok,
        msg: ok ? `Connection OK${res.data.latency_ms != null ? ` (${res.data.latency_ms} ms)` : ''}` : 'Failed',
      });
    } catch (err) {
      setVerifyResult({ id, ok: false, msg: err instanceof Error ? err.message : 'Verify failed' });
    } finally {
      setVerifyingId(null);
    }
  }

  function moveProvider(providers: AiProvider[], fromIdx: number, direction: 'up' | 'down') {
    const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= providers.length) return;
    const a = providers[fromIdx];
    const b = providers[toIdx];
    priorityMutation.mutate({ id: a.id, priority: b.priority });
    priorityMutation.mutate({ id: b.id, priority: a.priority });
  }

  const fields = KIND_FIELDS[form.kind] ?? ['api_key'];
  const providers = [...(data?.data ?? [])].sort((a, b) => a.priority - b.priority);

  return (
    <div>
      <div style={sty.tabBar}>
        <h3 style={sty.sectionTitle}>{t('aiAssistantSettings.providers.sectionTitle')}</h3>
        <button style={sty.btnPrimary} onClick={openNew}>{t('aiAssistantSettings.providers.addProvider')}</button>
      </div>

      {isLoading && <p style={sty.muted}>{t('aiAssistantSettings.providers.loading')}</p>}
      {error && <p style={sty.errorText}>{t('aiAssistantSettings.providers.error')}</p>}
      {!isLoading && providers.length === 0 && (
        <p style={sty.muted}>{t('aiAssistantSettings.providers.empty')}</p>
      )}

      {providers.length > 0 && (
        <table style={sty.table}>
          <thead>
            <tr>
              {[
                t('aiAssistantSettings.providers.cols.active'),
                t('aiAssistantSettings.providers.cols.priority'),
                t('aiAssistantSettings.providers.cols.name'),
                t('aiAssistantSettings.providers.cols.kind'),
                t('aiAssistantSettings.providers.cols.model'),
                t('aiAssistantSettings.providers.cols.enabled'),
                t('aiAssistantSettings.providers.cols.status'),
                '',
              ].map(h => (
                <th key={h} style={sty.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {providers.map((p, idx) => (
              <tr key={p.id}>
                <td style={sty.td}>
                  <input
                    type="radio"
                    name="active-provider"
                    aria-label={`Set ${p.name} as active provider`}
                    checked={activeProviderId === p.id}
                    onChange={() => activateMutation.mutate(p.id)}
                  />
                </td>
                <td style={sty.td}>
                  <span style={sty.rowActions}>
                    <button
                      style={sty.btnTiny}
                      disabled={idx === 0}
                      aria-label="Move up"
                      onClick={() => moveProvider(providers, idx, 'up')}
                    >▲</button>
                    <button
                      style={sty.btnTiny}
                      disabled={idx === providers.length - 1}
                      aria-label="Move down"
                      onClick={() => moveProvider(providers, idx, 'down')}
                    >▼</button>
                    <span style={{ fontSize: '0.8rem', color: '#888' }}>{p.priority}</span>
                  </span>
                </td>
                <td style={sty.td}>{p.name}</td>
                <td style={sty.td}><span style={sty.kindBadge}>{PROVIDER_KIND_LABELS[p.kind] ?? p.kind}</span></td>
                <td style={sty.td}><code style={sty.code}>{p.model ?? '—'}</code></td>
                <td style={sty.td}>
                  <span style={{ ...sty.pill, background: p.enabled ? '#16a34a' : '#888' }}>
                    {p.enabled ? 'on' : 'off'}
                  </span>
                </td>
                <td style={sty.td}>
                  <span style={{ ...sty.pill, background: p.status === 'verified' ? '#16a34a' : p.status === 'error' ? '#dc2626' : '#888' }}>
                    {p.status}
                  </span>
                </td>
                <td style={sty.td}>
                  <span style={sty.rowActions}>
                    <button
                      style={sty.btnGhost}
                      disabled={verifyingId === p.id}
                      onClick={() => handleVerify(p.id)}
                      aria-label={`Test connection for ${p.name}`}
                    >
                      {verifyingId === p.id ? t('aiAssistantSettings.providers.testing') : t('aiAssistantSettings.providers.test')}
                    </button>
                    <button style={sty.btnGhost} onClick={() => openEdit(p)}>{t('common.edit')}</button>
                    <button style={sty.btnDanger} onClick={() => setDeleteId(p.id)}>{t('common.delete')}</button>
                  </span>
                  {verifyResult?.id === p.id && (
                    <p style={{ ...sty.verifyMsg, color: verifyResult.ok ? '#16a34a' : '#dc2626' }}>
                      {verifyResult.ok ? '✓' : '✗'} {verifyResult.msg}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <Modal title={editing ? t('aiAssistantSettings.providers.editTitle') : t('aiAssistantSettings.providers.addTitle')} onClose={closeModal}>
          <form onSubmit={handleSubmit} style={sty.form}>
            <label style={sty.label}>{t('aiAssistantSettings.providers.form.name')} *
              <input style={sty.input} value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </label>
            <label style={sty.label}>{t('aiAssistantSettings.providers.form.kind')} *
              <select style={sty.select} value={form.kind}
                onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                {PROVIDER_KINDS.map(k => <option key={k} value={k}>{PROVIDER_KIND_LABELS[k] ?? k}</option>)}
              </select>
            </label>

            {fields.includes('model') && (
              DYNAMIC_MODEL_KINDS.includes(form.kind) ? (
                <LiveModelField
                  value={form.model}
                  catalog={modelCatalog}
                  onChange={model => setForm(f => ({ ...f, model }))}
                  onRefresh={() => { void loadModelCatalog(true); }}
                />
              ) : (
                <label style={sty.label}>{t('aiAssistantSettings.providers.form.model')}
                  <input style={sty.input} value={form.model}
                    onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
                </label>
              )
            )}
            {fields.includes('endpoint') && (
              <label style={sty.label}>{t('aiAssistantSettings.providers.form.endpoint')}
                <input style={sty.input} type="url" value={form.endpoint}
                  onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))} />
              </label>
            )}
            {fields.includes('deployment') && (
              <label style={sty.label}>{t('aiAssistantSettings.providers.form.deployment')}
                <input style={sty.input} value={form.deployment}
                  onChange={e => setForm(f => ({ ...f, deployment: e.target.value }))} />
              </label>
            )}
            {fields.includes('api_key') && (
              <label style={sty.label}>
                {t('aiAssistantSettings.providers.form.apiKey')} {editing && <span style={sty.hint}>{t('aiAssistantSettings.providers.form.apiKeyKeep')}</span>}
                <input style={sty.input} type="password" autoComplete="new-password"
                  value={form.api_key} placeholder={editing ? '••••••••' : ''}
                  onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} />
              </label>
            )}
            <div style={sty.row2}>
              <label style={sty.label}>{t('aiAssistantSettings.providers.form.priority')}
                <input style={sty.input} type="number" min={1} max={100} value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))} />
              </label>
              <label style={{ ...sty.label, justifyContent: 'flex-end' }}>
                <span style={sty.switchRow}>
                  <span>{t('aiAssistantSettings.providers.form.providerEnabled')}</span>
                  <input type="checkbox" aria-label="Provider enabled"
                    checked={form.is_enabled}
                    onChange={e => setForm(f => ({ ...f, is_enabled: e.target.checked }))} />
                </span>
              </label>
            </div>

            {formError && <p style={sty.errorText}>{formError}</p>}
            <div style={sty.modalFooter}>
              <button type="button" style={sty.btnGhost} onClick={closeModal}>{t('common.cancel')}</button>
              <button type="submit" style={sty.btnPrimary} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : editing ? t('aiAssistantSettings.providers.update') : t('aiAssistantSettings.providers.add')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteId !== null && (
        <Modal title={t('aiAssistantSettings.confirmTitle')} onClose={() => setDeleteId(null)}>
          <p>{t('aiAssistantSettings.confirm.deleteProvider')}</p>
          <div style={sty.modalFooter}>
            <button style={sty.btnGhost} onClick={() => setDeleteId(null)}
              disabled={deleteMutation.isPending}>{t('common.cancel')}</button>
            <button style={sty.btnDanger}
              onClick={() => deleteMutation.mutate(deleteId!)}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phrase Library tab
// ---------------------------------------------------------------------------

const PHRASE_CATEGORIES = ['greeting', 'closing', 'apology', 'escalation', 'resolution', 'follow_up', 'other'];
const EMPTY_PHRASE = { category: 'greeting', locale: 'en', text: '' };

function PhrasesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [locale, setLocale] = useState('en');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AiPhrase | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PHRASE });
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-phrases', locale],
    queryFn: () => apiFetch<{ data: AiPhrase[] }>(`${API_BASE}/phrases?locale=${locale}&limit=200`),
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? apiFetch(`${API_BASE}/phrases/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
        : apiFetch(`${API_BASE}/phrases`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-phrases'] });
      closeModal();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`${API_BASE}/phrases/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-phrases'] }); setDeleteId(null); },
  });

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_PHRASE, locale });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(p: AiPhrase) {
    setEditing(p);
    setForm({ category: p.category, locale: p.locale, text: p.text });
    setFormError('');
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.text.trim()) { setFormError(t('aiAssistantSettings.errors.phraseRequired')); return; }
    saveMutation.mutate({
      category: form.category, locale: form.locale,
      text: form.text,
    });
  }

  const phrases = data?.data ?? [];
  const byCategory: Record<string, AiPhrase[]> = {};
  for (const p of phrases) {
    (byCategory[p.category] ??= []).push(p);
  }

  return (
    <div>
      <div style={sty.tabBar}>
        <h3 style={sty.sectionTitle}>{t('aiAssistantSettings.phrases.sectionTitle')}</h3>
        <div style={sty.rowActions}>
          <select
            style={{ ...sty.select, width: 'auto' }}
            aria-label="Locale"
            value={locale}
            onChange={e => setLocale(e.target.value)}
          >
            {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button style={sty.btnPrimary} onClick={openNew}>{t('aiAssistantSettings.phrases.addPhrase')}</button>
        </div>
      </div>

      {isLoading && <p style={sty.muted}>{t('aiAssistantSettings.phrases.loading')}</p>}
      {error && <p style={sty.errorText}>{t('aiAssistantSettings.phrases.error')}</p>}
      {!isLoading && phrases.length === 0 && <p style={sty.muted}>{t('aiAssistantSettings.phrases.empty', { locale })}</p>}

      {PHRASE_CATEGORIES.map(cat => {
        const catPhrases = byCategory[cat];
        if (!catPhrases?.length) return null;
        return (
          <div key={cat} style={{ marginBottom: '1.5rem' }}>
            <h4 style={sty.catTitle}>{cat.replace(/_/g, ' ')}</h4>
            <table style={sty.table}>
              <thead>
                <tr>{[t('aiAssistantSettings.phrases.cols.phrase'), ''].map(h => <th key={h} style={sty.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {catPhrases.map(p => (
                  <tr key={p.id}>
                    <td style={{ ...sty.td, maxWidth: 360 }}>{p.text}</td>
                    <td style={sty.td}>
                      <span style={sty.rowActions}>
                        <button style={sty.btnGhost} onClick={() => openEdit(p)}>{t('common.edit')}</button>
                        <button style={sty.btnDanger} onClick={() => setDeleteId(p.id)}>{t('common.delete')}</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {showModal && (
        <Modal title={editing ? t('aiAssistantSettings.phrases.editTitle') : t('aiAssistantSettings.phrases.addTitle')} onClose={closeModal}>
          <form onSubmit={handleSubmit} style={sty.form}>
            <div style={sty.row2}>
              <label style={sty.label}>{t('aiAssistantSettings.phrases.form.category')}
                <select style={sty.select} value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {PHRASE_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label style={sty.label}>{t('aiAssistantSettings.phrases.form.locale')}
                <select style={sty.select} value={form.locale}
                  onChange={e => setForm(f => ({ ...f, locale: e.target.value }))}>
                  {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            </div>
            <label style={sty.label}>
              {t('aiAssistantSettings.phrases.form.phrase')} * <span style={sty.hint}>(use {'{{variable}}'} placeholders)</span>
              <textarea
                style={{ ...sty.input, height: 100, resize: 'vertical' }}
                value={form.text}
                onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                required
              />
            </label>
            {formError && <p style={sty.errorText}>{formError}</p>}
            <div style={sty.modalFooter}>
              <button type="button" style={sty.btnGhost} onClick={closeModal}>{t('common.cancel')}</button>
              <button type="submit" style={sty.btnPrimary} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : editing ? t('aiAssistantSettings.phrases.update') : t('aiAssistantSettings.phrases.add')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteId !== null && (
        <Modal title={t('aiAssistantSettings.confirmTitle')} onClose={() => setDeleteId(null)}>
          <p>{t('aiAssistantSettings.confirm.deletePhrase')}</p>
          <div style={sty.modalFooter}>
            <button style={sty.btnGhost} onClick={() => setDeleteId(null)}
              disabled={deleteMutation.isPending}>{t('common.cancel')}</button>
            <button style={sty.btnDanger}
              onClick={() => deleteMutation.mutate(deleteId!)}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forbidden Terms tab
// ---------------------------------------------------------------------------

const EMPTY_TERM = { term: '', locale: 'en' };

function ForbiddenTermsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_TERM });
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-forbidden-terms'],
    queryFn: () => apiFetch<{ data: AiForbiddenTerm[] }>(`${API_BASE}/forbidden-terms`),
  });

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`${API_BASE}/forbidden-terms`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-forbidden-terms'] });
      setShowModal(false);
      setForm({ ...EMPTY_TERM });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`${API_BASE}/forbidden-terms/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-forbidden-terms'] }); setDeleteId(null); },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.term.trim()) { setFormError(t('aiAssistantSettings.errors.termRequired')); return; }
    // locale is NOT NULL in the DB and required by the API, so always send a concrete value.
    addMutation.mutate({ term: form.term, locale: form.locale });
  }

  const terms = data?.data ?? [];

  return (
    <div>
      <div style={sty.tabBar}>
        <h3 style={sty.sectionTitle}>{t('aiAssistantSettings.forbiddenTerms.sectionTitle')}</h3>
        <button style={sty.btnPrimary} onClick={() => { setForm({ ...EMPTY_TERM }); setFormError(''); setShowModal(true); }}>
          {t('aiAssistantSettings.forbiddenTerms.addTerm')}
        </button>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
        {t('aiAssistantSettings.forbiddenTerms.description')}
      </p>

      {isLoading && <p style={sty.muted}>{t('aiAssistantSettings.forbiddenTerms.loading')}</p>}
      {error && <p style={sty.errorText}>{t('aiAssistantSettings.forbiddenTerms.error')}</p>}
      {!isLoading && terms.length === 0 && <p style={sty.muted}>{t('aiAssistantSettings.forbiddenTerms.empty')}</p>}

      {terms.length > 0 && (
        <table style={sty.table}>
          <thead>
            <tr>{[
              t('aiAssistantSettings.forbiddenTerms.cols.term'),
              t('aiAssistantSettings.forbiddenTerms.cols.locale'),
              t('aiAssistantSettings.forbiddenTerms.cols.added'),
              '',
            ].map(h => <th key={h} style={sty.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {terms.map(term => (
              <tr key={term.id}>
                <td style={sty.td}><code style={sty.code}>{term.term}</code></td>
                <td style={sty.td}>{term.locale}</td>
                <td style={sty.td}>{term.created_at.slice(0, 10)}</td>
                <td style={sty.td}>
                  <button style={sty.btnDanger} onClick={() => setDeleteId(term.id)}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <Modal title={t('aiAssistantSettings.forbiddenTerms.addTitle')} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} style={sty.form}>
            <label style={sty.label}>{t('aiAssistantSettings.forbiddenTerms.form.term')} *
              <input style={sty.input} value={form.term} autoFocus
                onChange={e => setForm(f => ({ ...f, term: e.target.value }))} required />
            </label>
            <label style={sty.label}>
              {t('aiAssistantSettings.forbiddenTerms.form.locale')} *
              <select style={sty.select} value={form.locale}
                onChange={e => setForm(f => ({ ...f, locale: e.target.value }))}>
                {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            {formError && <p style={sty.errorText}>{formError}</p>}
            <div style={sty.modalFooter}>
              <button type="button" style={sty.btnGhost} onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
              <button type="submit" style={sty.btnPrimary} disabled={addMutation.isPending}>
                {addMutation.isPending ? t('aiAssistantSettings.forbiddenTerms.adding') : t('aiAssistantSettings.forbiddenTerms.add')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteId !== null && (
        <Modal title={t('aiAssistantSettings.confirmTitle')} onClose={() => setDeleteId(null)}>
          <p>{t('aiAssistantSettings.confirm.deleteTerm')}</p>
          <div style={sty.modalFooter}>
            <button style={sty.btnGhost} onClick={() => setDeleteId(null)}
              disabled={deleteMutation.isPending}>{t('common.cancel')}</button>
            <button style={sty.btnDanger}
              onClick={() => deleteMutation.mutate(deleteId!)}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t('aiAssistantSettings.forbiddenTerms.removing') : t('aiAssistantSettings.forbiddenTerms.remove')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit & Metrics tab
// ---------------------------------------------------------------------------

function AuditTab() {
  const { t } = useTranslation();
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [month, setMonth] = useState(currentMonth);
  const [logAction, setLogAction] = useState('');

  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['ai-metrics', month],
    queryFn: () => {
      // Backend takes date_from/date_to (inclusive lower bound), not a month string.
      // Translate the YYYY-MM picker into [first-of-month, first-of-next-month].
      const [y, mo] = month.split('-').map(Number);
      const params = new URLSearchParams({
        date_from: `${month}-01`,
        date_to: new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10),
      });
      return apiFetch<{ data: AiMetrics }>(`${API_BASE}/metrics?${params}`);
    },
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['ai-logs', logAction],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      if (logAction) params.set('action', logAction);
      return apiFetch<{ data: AiReplyLog[]; meta: { total: number } }>(`${API_BASE}/logs?${params}`);
    },
  });

  const m = metricsData?.data;
  const logs = logsData?.data ?? [];

  return (
    <div>
      <h3 style={sty.sectionTitle}>{t('aiAssistantSettings.audit.sectionTitle')}</h3>

      {/* Month picker + metrics cards */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <label style={{ fontWeight: 500, fontSize: '0.875rem' }}>
          {t('aiAssistantSettings.audit.month')}
          <input
            type="month"
            aria-label="Select metrics month"
            style={{ ...sty.input, width: 'auto', marginLeft: 6 }}
            value={month}
            max={currentMonth}
            onChange={e => setMonth(e.target.value)}
          />
        </label>
      </div>

      {metricsLoading && <p style={sty.muted}>{t('aiAssistantSettings.audit.metricsLoading')}</p>}
      {m && (
        <div style={sty.metricsGrid}>
          <MetricCard label={t('aiAssistantSettings.audit.metrics.drafts')} value={m.drafts_total ?? 0} />
          <MetricCard label={t('aiAssistantSettings.audit.metrics.sent')} value={m.sent_or_edited ?? 0} />
          <MetricCard label={t('aiAssistantSettings.audit.metrics.autoSent')} value={m.auto_sent ?? 0} />
          <MetricCard label={t('aiAssistantSettings.audit.metrics.discarded')} value={m.discarded ?? 0} />
          <MetricCard
            label={t('aiAssistantSettings.audit.metrics.cost')}
            value={m.cost_usd_total != null ? `$${m.cost_usd_total.toFixed(4)}` : '—'}
          />
        </div>
      )}

      {/* Reply log */}
      <div style={{ ...sty.tabBar, marginTop: '1.5rem' }}>
        <h4 style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>{t('aiAssistantSettings.audit.log')}</h4>
        <select
          style={{ ...sty.select, width: 'auto' }}
          aria-label="Filter by action"
          value={logAction}
          onChange={e => setLogAction(e.target.value)}
        >
          <option value="">{t('aiAssistantSettings.audit.allActions')}</option>
          {LOG_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {logsLoading && <p style={sty.muted}>{t('aiAssistantSettings.audit.logsLoading')}</p>}
      {!logsLoading && logs.length === 0 && <p style={sty.muted}>{t('aiAssistantSettings.audit.noLogs')}</p>}
      {logs.length > 0 && (
        <table style={sty.table}>
          <thead>
            <tr>{[
              t('aiAssistantSettings.audit.cols.ticket'),
              t('aiAssistantSettings.audit.cols.action'),
              t('aiAssistantSettings.audit.cols.confidence'),
              t('aiAssistantSettings.audit.cols.cost'),
              t('aiAssistantSettings.audit.cols.channel'),
              t('aiAssistantSettings.audit.cols.date'),
            ].map(h => (
              <th key={h} style={sty.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={sty.td}>#{l.ticket_id}</td>
                <td style={sty.td}><span style={actionBadge(l.action)}>{l.action}</span></td>
                <td style={sty.td}>{l.confidence !== null ? `${Math.round(l.confidence)}%` : '—'}</td>
                <td style={sty.td}>{l.cost_usd !== null ? `$${l.cost_usd.toFixed(4)}` : '—'}</td>
                <td style={sty.td}>{l.channel ?? '—'}</td>
                <td style={sty.td}>{l.created_at.slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={sty.metricCard}>
      <div style={sty.metricValue}>{value}</div>
      <div style={sty.metricLabel}>{label}</div>
    </div>
  );
}

function actionBadge(action: string): React.CSSProperties {
  const colors: Record<string, string> = {
    sent: '#16a34a', auto_sent: '#0284c7', edited: '#d97706',
    proposed: '#6d28d9', discarded: '#888', failed: '#dc2626',
  };
  return { padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
    background: colors[action] ?? '#888', color: '#fff' };
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function AIAssistantSettings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<AiTab>('general');

  const tabs: { id: AiTab; label: string }[] = [
    { id: 'general',        label: t('aiAssistantSettings.tabs.general') },
    { id: 'providers',      label: t('aiAssistantSettings.tabs.providers') },
    { id: 'phrases',        label: t('aiAssistantSettings.tabs.phrases') },
    { id: 'forbiddenTerms', label: t('aiAssistantSettings.tabs.forbiddenTerms') },
    { id: 'audit',          label: t('aiAssistantSettings.tabs.audit') },
  ];

  return (
    <div style={sty.page}>
      <h2 style={sty.pageTitle}>{t('aiAssistantSettings.title')}</h2>

      <div style={sty.tabs}>
        {tabs.map(tab_ => (
          <button
            key={tab_.id}
            style={{ ...sty.tabBtn, ...(tab === tab_.id ? sty.tabBtnActive : {}) }}
            onClick={() => setTab(tab_.id)}
          >
            {tab_.label}
          </button>
        ))}
      </div>

      <div style={sty.card}>
        {tab === 'general'       && <GeneralTab />}
        {tab === 'providers'     && <ProvidersTab />}
        {tab === 'phrases'       && <PhrasesTab />}
        {tab === 'forbiddenTerms' && <ForbiddenTermsTab />}
        {tab === 'audit'         && <AuditTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles  (mirrors Settings.tsx palette + adds AI-specific entries)// ---------------------------------------------------------------------------

const sty = {
  page:        { padding: '1.5rem 2rem', fontFamily: 'var(--font-sans)', maxWidth: 1100 },
  pageTitle:   { margin: '0 0 1rem', fontSize: '1.4rem' },
  tabs:        { display: 'flex', gap: 4, borderBottom: '2px solid var(--border)', marginBottom: '1.25rem', flexWrap: 'wrap' as const },
  tabBtn:      {
    background: 'none', border: 'none', borderBottom: '2px solid transparent',
    padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-muted)',
    marginBottom: -2, transition: 'color .15s',
  } as React.CSSProperties,
  tabBtnActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)', fontWeight: 600 } as React.CSSProperties,
  card:        { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.5rem' },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 },
  catTitle:    { margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600, textTransform: 'capitalize' as const,
    color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 },
  tabBar:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' as const, gap: 8 },
  muted:       { color: 'var(--text-faint)', fontStyle: 'italic' as const, fontSize: '0.875rem' },
  table:       { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th:          { textAlign: 'left' as const, padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--border)', fontWeight: 600, color: 'var(--text-secondary)' },
  td:          { padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' as const },
  code:        { background: 'var(--bg-subtle)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.82rem' },
  rowActions:  { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const },
  errorText:   { color: '#dc2626', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  successText: { color: '#16a34a', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  hint:        { fontWeight: 400, color: 'var(--text-faint)', fontSize: '0.8rem' },
  verifyMsg:   { margin: '4px 0 0', fontSize: '0.8rem' },
  // form
  form:        { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  label:       { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' },
  input:       { padding: '0.45rem 0.65rem', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem', width: '100%', boxSizing: 'border-box' as const },
  select:      { padding: '0.45rem 0.65rem', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem', background: 'var(--input-bg)', width: '100%', boxSizing: 'border-box' as const },
  row2:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  fieldHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  switchRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', fontSize: '0.875rem', color: 'var(--text-secondary)' } as React.CSSProperties,
  fieldset:    { border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '0.75rem 1rem', margin: 0 } as React.CSSProperties,
  legend:      { fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', padding: '0 4px' } as React.CSSProperties,
  // modal
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80, zIndex: 1000 },
  modal:       { background: 'var(--bg-card)', borderRadius: 8, width: '100%', maxWidth: 560, boxShadow: '0 8px 32px rgba(0,0,0,.2)', maxHeight: '80vh', overflow: 'auto' as const },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' },
  modalBody:   { padding: '1.25rem' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' },
  closeBtn:    { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-faint)' },
  // buttons
  btnPrimary:  { padding: '0.4rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 },
  btnGhost:    { padding: '0.4rem 1rem', background: 'var(--bg-body)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' },
  btnDanger:   { padding: '0.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' },
  btnTiny:     { padding: '0 6px', background: 'var(--bg-body)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', lineHeight: '1.6' },
  // badges / pills
  pill:        { padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, color: '#fff' } as React.CSSProperties,
  kindBadge:   { padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, background: '#6d28d9', color: '#fff' } as React.CSSProperties,
  // metrics
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: '1.5rem' } as React.CSSProperties,
  metricCard:  { background: 'var(--bg-subtle)', borderRadius: 8, padding: '1rem', textAlign: 'center' as const },
  metricValue: { fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' },
  metricLabel: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 },
};
