import React, { useMemo, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { Atendimento } from '@/types';
import {
  useAtendimentos,
  useCreateAtendimento,
  useUpdateAtendimento,
  useDeleteAtendimento,
} from '@/lib/query/hooks/useAtendimentosQuery';
import { useDeals } from '@/lib/query/hooks/useDealsQuery';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useProfessionals } from '@/lib/query/hooks/useProfessionalsQuery';
import { useProducts } from '@/lib/query/hooks/useProductsQuery';
import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';

export interface AtendimentoFormState {
  procedimento: string;
  productId: string;
  valor: string;
  /** Desconto (planilha do Adel) — total a receber = valor − desconto. */
  desconto: string;
  professionalId: string;
  dealId: string;
  paymentMethod: string;
  cardBrand: string;
  installments: string;
  recebido: boolean;
}

const emptyForm: AtendimentoFormState = {
  procedimento: '',
  productId: '',
  valor: '',
  desconto: '',
  professionalId: '',
  dealId: '',
  paymentMethod: 'pix',
  cardBrand: '',
  installments: '1',
  recebido: false,
};

/**
 * Hook controlador da tela de Atendimentos.
 * Deriva contactId do deal selecionado (mesma lógica de activities) e
 * carimba paid_at no momento em que "recebido" é marcado.
 */
export const useAtendimentosController = () => {
  const { profile } = useAuth();

  const { data: atendimentos = [], isLoading: atendimentosLoading } = useAtendimentos();
  const { data: deals = [], isLoading: dealsLoading } = useDeals();
  const { data: contacts = [], isLoading: contactsLoading } = useContacts();
  const { data: professionals = [], isLoading: professionalsLoading } = useProfessionals();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const createMutation = useCreateAtendimento();
  const updateMutation = useUpdateAtendimento();
  const deleteMutation = useDeleteAtendimento();

  useRealtimeSync('atendimentos');

  const { showToast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Atendimento | null>(null);
  const [formData, setFormData] = useState<AtendimentoFormState>(emptyForm);

  const isLoading =
    atendimentosLoading ||
    dealsLoading ||
    contactsLoading ||
    professionalsLoading ||
    productsLoading;

  const dealsById = useMemo(() => new Map(deals.map(d => [d.id, d])), [deals]);
  const contactsById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);
  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const filteredAtendimentos = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return atendimentos.filter(a => (a.procedimento || '').toLowerCase().includes(q));
  }, [atendimentos, searchTerm]);

  const handleNew = () => {
    setEditing(null);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const handleEdit = (atendimento: Atendimento) => {
    setEditing(atendimento);
    setFormData({
      procedimento: atendimento.procedimento,
      productId: atendimento.productId || '',
      valor: String(atendimento.valor ?? 0),
      desconto: String(atendimento.desconto ?? 0),
      professionalId: atendimento.professionalId || '',
      dealId: atendimento.dealId || '',
      paymentMethod: atendimento.paymentMethod || 'pix',
      cardBrand: atendimento.cardBrand || '',
      installments: String(atendimento.installments ?? 1),
      recebido: atendimento.recebido ?? false,
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir este atendimento?')) {
      deleteMutation.mutate(id, {
        onSuccess: () => showToast('Atendimento excluído com sucesso', 'success'),
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const selectedDeal = formData.dealId ? dealsById.get(formData.dealId) : undefined;
    const selectedContact = selectedDeal?.contactId
      ? contactsById.get(selectedDeal.contactId)
      : undefined;
    const selectedProduct = formData.productId ? productsById.get(formData.productId) : undefined;
    const nowIso = new Date().toISOString();

    const basePayload = {
      procedimento: formData.procedimento || selectedProduct?.name || '',
      productId: formData.productId || undefined,
      valor: Number(formData.valor) || 0,
      desconto: Number(formData.desconto) || 0,
      professionalId: formData.professionalId || undefined,
      dealId: formData.dealId || undefined,
      contactId: selectedContact?.id || undefined,
      paymentMethod: formData.paymentMethod || undefined,
      cardBrand: formData.cardBrand || undefined,
      installments: Number(formData.installments) || 1,
      recebido: formData.recebido,
    };

    if (editing) {
      const wasRecebido = editing.recebido ?? false;
      const updates: Omit<Atendimento, 'id'> = {
        ...basePayload,
        // Edição NUNCA re-carimba performed_at (o form não tem campo de data).
        performedAt: editing.performedAt,
        // paid_at só recomputa quando `recebido` MUDOU:
        // false→true carimba agora; true→false zera; true→true preserva o carimbo original.
        paidAt: formData.recebido ? (wasRecebido ? editing.paidAt : nowIso) : undefined,
      };
      updateMutation.mutate(
        { id: editing.id, updates },
        {
          onSuccess: () => {
            showToast('Atendimento atualizado com sucesso', 'success');
            setIsModalOpen(false);
          },
        }
      );
    } else {
      const atendimento: Omit<Atendimento, 'id'> = {
        ...basePayload,
        paidAt: formData.recebido ? nowIso : undefined,
        performedAt: nowIso,
      };
      createMutation.mutate(
        { atendimento },
        {
          onSuccess: () => {
            showToast('Atendimento registrado com sucesso', 'success');
            setIsModalOpen(false);
          },
          onError: (error: Error) => {
            showToast(`Erro ao registrar atendimento: ${error.message}`, 'error');
          },
        }
      );
    }
  };

  return {
    profile,
    searchTerm,
    setSearchTerm,
    isModalOpen,
    setIsModalOpen,
    editing,
    formData,
    setFormData,
    filteredAtendimentos,
    deals,
    professionals,
    products,
    isLoading,
    handleNew,
    handleEdit,
    handleDelete,
    handleSubmit,
  };
};
