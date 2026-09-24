'use client';

/**
 * Escolher a empresa (conta) de um negócio — ou criar uma na hora.
 *
 * Pedido do Junior (24/09/2026): o card do funil mostrava "Sem empresa" e não havia nenhuma tela
 * que deixasse mudar isso. O campo de empresa só existia no modal de CRIAR negócio à mão, e o
 * negócio que nasce de uma conversa de WhatsApp nunca passa por ele.
 *
 * A sugestão vem do que o lead contou na conversa: a Aurora grava o nome da empresa em
 * `contacts.company_name`, e aqui ele vira um atalho de um clique em vez de digitação.
 */
import React from 'react';
import { Building2, Check, Plus, X } from 'lucide-react';
import { useCRM } from '@/context/CRMContext';

const CAMPO =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 '
  + 'focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:border-white/10 dark:bg-white/5 dark:text-white';

/** Compara nome de empresa ignorando acento, caixa e espaço sobrando. */
function mesmaEmpresa(a: string, b: string) {
  const limpa = (valor: string) =>
    valor.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return limpa(a) === limpa(b);
}

export function DealCompanySelector({
  clientCompanyId,
  sugestao,
  onChange,
  disabled,
}: {
  clientCompanyId?: string | null;
  /** O que o lead disse na conversa, quando ainda não virou empresa de verdade. */
  sugestao?: string | null;
  onChange: (companyId: string | null) => void | Promise<void>;
  disabled?: boolean;
}) {
  // O contexto pode ainda não ter carregado as empresas (e há telas que montam o modal com um
  // CRM parcial). Sem esta rede, um `undefined.find` derruba o modal inteiro do negócio.
  const crm = useCRM() as { companies?: { id: string; name: string }[]; addCompany?: (empresa: { name: string }) => Promise<{ id: string } | null> };
  const companies = crm.companies ?? [];
  const addCompany = crm.addCompany;
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);

  const atual = React.useMemo(
    () => companies.find((c) => c.id === clientCompanyId) || null,
    [companies, clientCompanyId],
  );

  const filtradas = React.useMemo(() => {
    const q = busca.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    const lista = q
      ? companies.filter((c) =>
          (c.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q))
      : companies;
    return lista.slice(0, 30);
  }, [companies, busca]);

  const nomeNovo = busca.trim();
  const jaExiste = nomeNovo !== '' && companies.some((c) => mesmaEmpresa(c.name || '', nomeNovo));

  // A sugestão da conversa só aparece quando ainda não há empresa escolhida e ela não existe
  // cadastrada — senão vira um botão que não faz nada de novo.
  const sugestaoUtil = React.useMemo(() => {
    const nome = (sugestao || '').trim();
    if (!nome || atual) return null;
    const cadastrada = companies.find((c) => mesmaEmpresa(c.name || '', nome));
    return { nome, cadastrada: cadastrada || null };
  }, [sugestao, atual, companies]);

  async function escolher(companyId: string | null) {
    setSalvando(true);
    try {
      await onChange(companyId);
      setAberto(false);
      setBusca('');
    } finally {
      setSalvando(false);
    }
  }

  async function criarEEscolher(nome: string) {
    if (!addCompany) return;
    setSalvando(true);
    try {
      const criada = await addCompany({ name: nome });
      if (criada?.id) {
        await onChange(criada.id);
        setAberto(false);
        setBusca('');
      }
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">
            {atual?.name || 'Sem empresa'}
          </p>
          <button
            type="button"
            onClick={() => setAberto(true)}
            disabled={disabled}
            className="shrink-0 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-300"
          >
            {atual ? 'Trocar' : 'Escolher'}
          </button>
        </div>

        {sugestaoUtil ? (
          <button
            type="button"
            disabled={disabled || salvando}
            onClick={() =>
              sugestaoUtil.cadastrada
                ? escolher(sugestaoUtil.cadastrada.id)
                : criarEEscolher(sugestaoUtil.nome)
            }
            className="mt-2 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-brand-400/60 px-2.5 py-1.5 text-left text-xs text-brand-700 transition hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
          >
            <Building2 size={13} className="shrink-0" />
            <span className="min-w-0 truncate">
              Na conversa ele falou <strong>{sugestaoUtil.nome}</strong> — usar
            </span>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-white/10">
      <div className="mb-2 flex items-center gap-2">
        <input
          type="text"
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar ou escrever o nome…"
          aria-label="Empresa do negócio"
          className={CAMPO}
        />
        <button
          type="button"
          onClick={() => { setAberto(false); setBusca(''); }}
          aria-label="Fechar escolha de empresa"
          className="shrink-0 text-slate-400 hover:text-slate-600"
        >
          <X size={16} />
        </button>
      </div>

      <div className="max-h-44 overflow-y-auto">
        {atual ? (
          <button
            type="button"
            disabled={salvando}
            onClick={() => escolher(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/5"
          >
            <X size={13} /> Tirar a empresa deste negócio
          </button>
        ) : null}

        {filtradas.map((empresa) => (
          <button
            key={empresa.id}
            type="button"
            disabled={salvando}
            onClick={() => escolher(empresa.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            {empresa.id === clientCompanyId ? <Check size={13} className="shrink-0 text-brand-500" /> : <Building2 size={13} className="shrink-0 opacity-50" />}
            <span className="min-w-0 truncate">{empresa.name}</span>
          </button>
        ))}

        {nomeNovo && !jaExiste ? (
          <button
            type="button"
            disabled={salvando}
            onClick={() => criarEEscolher(nomeNovo)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
          >
            <Plus size={13} className="shrink-0" />
            <span className="min-w-0 truncate">Criar “{nomeNovo}”</span>
          </button>
        ) : null}

        {filtradas.length === 0 && !nomeNovo ? (
          <p className="px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400">
            Nenhuma empresa cadastrada ainda. Escreva o nome acima para criar a primeira.
          </p>
        ) : null}
      </div>
    </div>
  );
}
