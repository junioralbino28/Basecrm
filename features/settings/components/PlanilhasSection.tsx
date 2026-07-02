import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Copy, Plus, Trash2, RefreshCw, ShieldCheck, Download, Link2, Info } from 'lucide-react';

import { useOptionalToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase/client';

import { SettingsSection } from './SettingsSection';

type ReportTokenRow = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const SUMMARY_PATH = '/api/public/v1/reports/summary';
const EXPORT_PATH = '/api/reports/export/atendimentos';

/**
 * Planilhas conectadas (N7). Dois níveis:
 *  - Link automático de TOTAIS (token de planilha isolado → só agregados, nunca PII).
 *  - Export completo de pacientes (Excel), protegido por login.
 * Só-admin (renderizado dentro do Financeiro, que já é gated por canManageClinicSettings).
 */
export const PlanilhasSection: React.FC = () => {
  const { addToast } = useOptionalToast();

  const [origin, setOrigin] = useState('');
  const [tokens, setTokens] = useState<ReportTokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('Planilha do Adel');
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  const createdUrl = useMemo(
    () => (createdToken ? `${origin}${SUMMARY_PATH}?token=${createdToken}` : ''),
    [origin, createdToken]
  );
  const createdFormula = useMemo(
    () => (createdUrl ? `=IMPORTDATA("${createdUrl}")` : ''),
    [createdUrl]
  );

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast(`${label} copiado.`, 'success');
    } catch {
      addToast(`Não foi possível copiar ${label.toLowerCase()}.`, 'error');
    }
  };

  const loadTokens = async () => {
    if (!supabase) {
      addToast('Supabase não configurado neste ambiente.', 'error');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('report_tokens')
        .select('id,name,key_prefix,created_at,last_used_at,revoked_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTokens((data || []) as ReportTokenRow[]);
    } catch (e: any) {
      addToast(e?.message || 'Erro ao carregar links', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTokens();
  }, []);

  const createToken = async () => {
    if (!supabase) {
      addToast('Supabase não configurado neste ambiente.', 'error');
      return;
    }
    setCreating(true);
    setCreatedToken(null);
    try {
      const { data, error } = await supabase.rpc('create_report_token', { p_name: newName.trim() || 'Planilha' });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const token = row?.token as string | undefined;
      if (!token) throw new Error('Resposta inválida ao gerar o link');
      setCreatedToken(token);
      addToast('Link gerado. Copie a fórmula agora — o token aparece só uma vez.', 'success');
      await loadTokens();
    } catch (e: any) {
      addToast(e?.message || 'Erro ao gerar o link', 'error');
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (id: string) => {
    if (!supabase) {
      addToast('Supabase não configurado neste ambiente.', 'error');
      return;
    }
    setRevokingId(id);
    try {
      const { error } = await supabase.rpc('revoke_report_token', { p_report_token_id: id });
      if (error) throw error;
      addToast('Link revogado. A planilha para de atualizar.', 'success');
      await loadTokens();
    } catch (e: any) {
      addToast(e?.message || 'Erro ao revogar o link', 'error');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <SettingsSection title="Planilhas conectadas" icon={FileSpreadsheet}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
        Leve os números do CRM pra sua planilha. São dois jeitos, cada um pro seu caso.
      </p>

      {/* Nível B — export completo (com login) */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 p-4 mb-4">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1 flex items-center gap-2">
          <Download className="h-4 w-4" />
          Lista completa de pacientes (Excel)
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-300 mb-3">
          Baixa a planilha com todos os atendimentos — nome, telefone, procedimento e valor. Como tem dado de
          paciente, o download é só aqui dentro (você logado). Não vira link.
        </div>
        <a
          href={EXPORT_PATH}
          className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold"
        >
          <Download className="h-4 w-4" />
          Exportar Excel (pacientes)
        </a>
      </div>

      {/* Nível A — link automático de totais */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 p-4">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1 flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Link automático de totais (Google Sheets / Excel)
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-300 mb-3">
          Gera um link que a planilha puxa sozinha e mantém atualizado. Mostra só <span className="font-semibold">totais</span>{' '}
          (faturamento, nº de leads, agendamentos) — <span className="font-semibold">nunca</span> dado de paciente. Guarde o
          link como se fosse uma senha; se precisar, é só revogar embaixo.
        </div>

        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            placeholder="Nome (ex: Planilha do Adel)"
          />
          <button
            type="button"
            onClick={createToken}
            disabled={creating}
            className="shrink-0 px-3 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
          >
            {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Gerar link
          </button>
        </div>

        {createdToken && (
          <div className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-3">
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Link gerado — copie agora (aparece só uma vez)
            </div>

            {/* Google Sheets */}
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">No Google Sheets</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Cole esta fórmula numa célula:
            </div>
            <div className="flex gap-2 mb-3">
              <input
                readOnly
                value={createdFormula}
                className="w-full px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-white/70 dark:bg-black/20 text-slate-900 dark:text-white font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => copy('Fórmula', createdFormula)}
                className="shrink-0 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-white/70 dark:bg-black/20 hover:bg-white text-emerald-800 dark:text-emerald-200 text-sm font-semibold inline-flex items-center gap-2"
              >
                <Copy className="h-4 w-4" />
                Copiar
              </button>
            </div>

            {/* Excel */}
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">No Excel</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Aba <span className="font-semibold">Dados → Da Web</span>, cole este endereço:
            </div>
            <div className="flex gap-2">
              <input
                readOnly
                value={createdUrl}
                className="w-full px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-white/70 dark:bg-black/20 text-slate-900 dark:text-white font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => copy('Endereço', createdUrl)}
                className="shrink-0 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-white/70 dark:bg-black/20 hover:bg-white text-emerald-800 dark:text-emerald-200 text-sm font-semibold inline-flex items-center gap-2"
              >
                <Copy className="h-4 w-4" />
                Copiar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Links gerados */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Links gerados</div>
          <button
            type="button"
            onClick={loadTokens}
            disabled={loading}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-white text-sm font-semibold inline-flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="divide-y divide-slate-200 dark:divide-white/10">
            {tokens.length === 0 ? (
              <div className="p-4 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <Info className="h-4 w-4 text-slate-400" />
                Nenhum link gerado ainda.
              </div>
            ) : (
              tokens.map((t) => (
                <div key={t.id} className="p-4 bg-white dark:bg-white/5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {t.name}
                      {t.revoked_at ? (
                        <span className="ml-2 text-xs font-semibold text-rose-600 dark:text-rose-400">revogado</span>
                      ) : (
                        <span className="ml-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">ativo</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">{t.key_prefix}…</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Último uso: {t.last_used_at ? new Date(t.last_used_at).toLocaleString('pt-BR') : '—'}
                    </div>
                  </div>
                  {!t.revoked_at && (
                    <button
                      type="button"
                      disabled={revokingId === t.id}
                      onClick={() => revokeToken(t.id)}
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-60 text-rose-700 dark:text-rose-300 text-sm font-semibold inline-flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      {revokingId === t.id ? 'Revogando…' : 'Revogar'}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
};
