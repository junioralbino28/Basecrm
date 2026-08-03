import React, { useEffect, useMemo, useState } from 'react';
import { Stethoscope, Pencil, Plus, Save, Trash2, ToggleLeft, ToggleRight, X, ChevronDown, ChevronRight, Percent } from 'lucide-react';
import { CommissionsManager } from './CommissionsManager';
import type { Professional, ProfessionalPayType } from '@/types';
import { formatBRL } from '@/lib/utils';
import { teamCatalogsService, type TeamCatalogItem } from '@/lib/supabase/teamCatalogs';
import {
  useProfessionals,
  useCreateProfessional,
  useUpdateProfessional,
  useDeleteProfessional,
} from '@/lib/query/hooks/useProfessionalsQuery';
import { mascararMoedaBR, paraNumeroBR, paraCampoMoedaBR } from '@/lib/utils/moedaBR';
import { useTenant } from '@/context/TenantContext';

/**
 * Escolha de VÁRIAS especialidades (Junior, 2026-07-27: "pode colocar mais de uma
 * especialidade por funcionário, pois ele pode fazer vários procedimentos").
 *
 * Deliberadamente em pastilhas de ligar/desligar, não em `<select multiple>`: o
 * select múltiplo exige segurar Ctrl pra marcar mais de um — ninguém que não é
 * técnico descobre isso sozinho.
 */
const SeletorEspecialidades: React.FC<{
  opcoes: TeamCatalogItem[];
  selecionadas: string[];
  onChange: (ids: string[]) => void;
  idPrefixo: string;
}> = ({ opcoes, selecionadas, onChange, idPrefixo }) => {
  if (opcoes.length === 0) {
    return (
      <p className="text-xs text-muted">
        Nenhuma especialidade cadastrada. Cadastre na aba Especialidades.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const marcada = selecionadas.includes(o.id);
        return (
          <button
            key={`${idPrefixo}-${o.id}`}
            type="button"
            aria-pressed={marcada}
            onClick={() => onChange(
              marcada ? selecionadas.filter((id) => id !== o.id) : [...selecionadas, o.id],
            )}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${
              marcada
                ? 'border-brand-500 bg-brand-600/15 text-brand-600 dark:text-brand-400'
                : 'border-line bg-card text-muted hover:bg-surface'
            }`}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Componente React `ProfessionalsManager`.
 * Gestão de profissionais (dentistas). Só clinic_admin/agency_admin enxerga esta tela
 * (gate canManageSettings no SettingsPage); a RLS bloqueia mutação de clinic_staff.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ProfessionalsManager: React.FC = () => {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || '';
  const { data, isLoading, error } = useProfessionals();
  const createMutation = useCreateProfessional();
  const updateMutation = useUpdateProfessional();
  const deleteMutation = useDeleteProfessional();

  const professionals = useMemo(() => data ?? [], [data]);

  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [specialtyIds, setSpecialtyIds] = useState<string[]>([]);
  const [role, setRole] = useState('');
  const [payType, setPayType] = useState<ProfessionalPayType>('commission');
  // Começa vazio: o placeholder aparece e ninguém precisa apagar um zero.
  const [fixedAmount, setFixedAmount] = useState('');

  const canCreate = name.trim().length > 1;

  // Comissão MORA na ficha da pessoa (Junior, 2026-07-27: "pra cadastrar certo
  // profissional, especialidade, serviço e comissão preciso ir em 3 menus").
  const [comissoesAbertas, setComissoesAbertas] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpecialtyIds, setEditSpecialtyIds] = useState<string[]>([]);
  const [editRole, setEditRole] = useState('');
  const [editPayType, setEditPayType] = useState<ProfessionalPayType>('commission');
  const [editFixedAmount, setEditFixedAmount] = useState('');

  const SEM_CARGO = 'Sem cargo definido';

  // Cargo e especialidade vêm de LISTA (Configurações → Profissionais → Cargos /
  // Especialidades). Antes eram texto livre e "Ortodontia" × "ortodontia" viravam
  // duas coisas, quebrando agrupamento e relatório em silêncio (Junior, 24/07).
  const [cargos, setCargos] = useState<TeamCatalogItem[]>([]);
  const [especialidades, setEspecialidades] = useState<TeamCatalogItem[]>([]);
  useEffect(() => {
    if (!organizationId) return;
    void teamCatalogsService.list('job_roles', organizationId).then(({ data }) => setCargos(data));
    void teamCatalogsService.list('specialties', organizationId).then(({ data }) => setEspecialidades(data));
  }, [organizationId]);

  // Agrupado por CARGO (decisão do Junior, 24/07): as secretárias juntas, os
  // dentistas juntos, os vendedores juntos. Inativos vão pro fim de cada grupo.
  const groups = useMemo(() => {
    const map = new Map<string, Professional[]>();
    for (const p of professionals) {
      const key = (p.role || '').trim() || SEM_CARGO;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const aActive = a.active !== false;
        const bActive = b.active !== false;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === SEM_CARGO) return 1;
      if (b === SEM_CARGO) return -1;
      return a.localeCompare(b);
    });
  }, [professionals]);

  const totalCount = professionals.length;

  const create = async () => {
    if (!canCreate) return;
    setFormError(null);
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        specialtyIds,
        role: role.trim() || undefined,
        payType,
        fixedAmount: paraNumeroBR(fixedAmount),
        active: true,
      });
      setName('');
      setSpecialtyIds([]);
      setRole('');
      setPayType('commission');
      setFixedAmount('');
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const toggleActive = async (p: Professional, next: boolean) => {
    setFormError(null);
    try {
      await updateMutation.mutateAsync({ id: p.id, updates: { active: next } });
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const startEdit = (p: Professional) => {
    setEditingId(p.id);
    setEditName(p.name || '');
    setEditSpecialtyIds(p.specialtyIds ?? []);
    setEditRole(p.role || '');
    setEditPayType(p.payType || 'commission');
    setEditFixedAmount(paraCampoMoedaBR(p.fixedAmount));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditSpecialtyIds([]);
    setEditRole('');
    setEditPayType('commission');
    setEditFixedAmount('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const nextName = editName.trim();
    if (nextName.length < 2) {
      setFormError('Nome inválido.');
      return;
    }
    setFormError(null);
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        updates: {
          name: nextName,
          specialtyIds: editSpecialtyIds,
          role: editRole.trim() || undefined,
          payType: editPayType,
          fixedAmount: paraNumeroBR(editFixedAmount),
        },
      });
      cancelEdit();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const remove = async (p: Professional) => {
    const ok = window.confirm(`Excluir "${p.name}"? Atendimentos históricos não são removidos.`);
    if (!ok) return;
    setFormError(null);
    try {
      await deleteMutation.mutateAsync(p.id);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const busy = isLoading || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const displayError = formError || (error ? (error as Error).message : null);

  return (
    <div className="mb-12">
      <div className="bg-card border border-line rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
              <Stethoscope className="h-5 w-5" /> Profissionais
            </h3>
            <p className="text-sm text-muted">
              Cadastre a equipe e diga como cada pessoa ganha. A lista fica agrupada por cargo.
              Quem recebe comissão tem o valor definido na aba Comissões.
            </p>
          </div>
        </div>

        {displayError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {displayError}
          </div>
        )}

        {/* Create */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-4">
            <label className="block text-xs font-semibold text-muted mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Ana Souza"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-3">
            <label htmlFor="novo-cargo" className="block text-xs font-semibold text-muted mb-1">Cargo</label>
            <select
              id="novo-cargo"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="">Sem cargo</option>
              {cargos.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="lg:col-span-3">
            <span className="block text-xs font-semibold text-muted mb-1">
              Especialidades (pode marcar várias)
            </span>
            <SeletorEspecialidades
              opcoes={especialidades}
              selecionadas={specialtyIds}
              onChange={setSpecialtyIds}
              idPrefixo="nova"
            />
          </div>
          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={create}
              disabled={busy || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Adicionar pessoa à equipe"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </button>
          </div>

          <div className="lg:col-span-4">
            <label className="block text-xs font-semibold text-muted mb-1">Como essa pessoa ganha</label>
            <select
              aria-label="Como essa pessoa ganha"
              value={payType}
              onChange={(e) => setPayType(e.target.value as ProfessionalPayType)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="commission">Só comissão</option>
              <option value="fixed">Só valor fixo</option>
              <option value="both">Fixo + comissão</option>
            </select>
          </div>
          {payType !== 'commission' && (
            <div className="lg:col-span-3">
              <label className="block text-xs font-semibold text-muted mb-1">Valor fixo do mês (R$)</label>
              <input
                inputMode="decimal"
                value={fixedAmount}
                onChange={(e) => setFixedAmount(mascararMoedaBR(e.target.value))}
                placeholder="0"
                className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
            </div>
          )}
        </div>

        {/* List */}
        <div className="mt-6 border-t border-line pt-4">
          {totalCount === 0 ? (
            <div className="text-sm text-muted py-6">
              Ninguém cadastrado ainda.
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map(([cargo, pessoas]) => (
            <div key={cargo} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted">{cargo}</h4>
                <span className="text-[11px] text-muted/70">
                  {pessoas.length === 1 ? '1 pessoa' : `${pessoas.length} pessoas`}
                </span>
              </div>
              {pessoas.map((p) => {
                const isActive = p.active !== false;
                const isEditing = editingId === p.id;
                const comissaoAberta = comissoesAbertas === p.id;
                return (
                  <div key={p.id} className="rounded-xl border border-line bg-surface/60">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      {isEditing ? (
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <div className="sm:col-span-6">
                            <label className="block text-[11px] font-semibold text-muted mb-1">Nome</label>
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            />
                          </div>
                          <div className="sm:col-span-6">
                            <span className="block text-[11px] font-semibold text-muted mb-1">
                              Especialidades (pode marcar várias)
                            </span>
                            <SeletorEspecialidades
                              opcoes={especialidades}
                              selecionadas={editSpecialtyIds}
                              onChange={setEditSpecialtyIds}
                              idPrefixo={`edit-${p.id}`}
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <label className="block text-[11px] font-semibold text-muted mb-1">Cargo</label>
                            <select
                              aria-label="Cargo"
                              value={editRole}
                              onChange={(e) => setEditRole(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            >
                              <option value="">Sem cargo</option>
                              {cargos.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                              {editRole && !cargos.some((c) => c.name === editRole) && (
                                <option value={editRole}>{editRole} (fora da lista)</option>
                              )}
                            </select>
                          </div>
                          <div className="sm:col-span-4">
                            <label className="block text-[11px] font-semibold text-muted mb-1">Como ganha</label>
                            <select
                              aria-label="Como essa pessoa ganha"
                              value={editPayType}
                              onChange={(e) => setEditPayType(e.target.value as ProfessionalPayType)}
                              className="w-full px-3 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            >
                              <option value="commission">Só comissão</option>
                              <option value="fixed">Só valor fixo</option>
                              <option value="both">Fixo + comissão</option>
                            </select>
                          </div>
                          {editPayType !== 'commission' && (
                            <div className="sm:col-span-4">
                              <label className="block text-[11px] font-semibold text-muted mb-1">Valor fixo (R$)</label>
                              <input
                                inputMode="decimal"
                                value={editFixedAmount}
                                onChange={(e) => setEditFixedAmount(mascararMoedaBR(e.target.value))}
                                className="w-full px-3 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-ink truncate">{p.name}</div>
                            {!isActive && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface text-muted">
                                Inativo
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted mt-0.5 truncate">
                            <span className="mr-2 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold">
                              {p.payType === 'fixed' ? 'Só valor fixo'
                                : p.payType === 'both' ? 'Fixo + comissão'
                                : 'Só comissão'}
                            </span>
                            {p.payType !== 'commission' && Number(p.fixedAmount ?? 0) > 0 && (
                              <span className="mr-2 text-[11px]">
                                {formatBRL(Number(p.fixedAmount))}/mês
                              </span>
                            )}
                            {p.specialtyNames && p.specialtyNames.length > 0
                              ? p.specialtyNames.join(' · ')
                              : (p.specialty || 'Sem especialidade')}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Salvar"
                            aria-label="Salvar alterações"
                            disabled={busy}
                          >
                            <Save className="h-4 w-4 text-brand-600" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Cancelar"
                            aria-label="Cancelar edição"
                            disabled={busy}
                          >
                            <X className="h-4 w-4 text-muted" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setComissoesAbertas(comissaoAberta ? null : p.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-line bg-card hover:bg-surface text-xs font-semibold text-ink"
                            aria-expanded={comissaoAberta}
                            title="Ver e definir as comissões desta pessoa"
                          >
                            {comissaoAberta
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted" />}
                            <Percent className="h-3.5 w-3.5 text-muted" />
                            Comissões
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(p)}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Editar"
                            aria-label="Editar profissional"
                            disabled={busy}
                          >
                            <Pencil className="h-4 w-4 text-muted" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActive(p, !isActive)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                        title={isActive ? 'Desativar' : 'Ativar'}
                        aria-label={isActive ? 'Desativar profissional' : 'Ativar profissional'}
                        disabled={busy}
                      >
                        {isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-red-500" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir profissional"
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                  {comissaoAberta && (
                    <div className="border-t border-line px-4 pb-4">
                      <CommissionsManager professionalId={p.id} />
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
