import React from 'react';
import { AtendimentoFormModal } from './AtendimentoFormModal';
import {
  useAtendimentosController,
  formVazioDeAtendimento,
} from '../hooks/useAtendimentosController';

/**
 * A PORTA do atendimento dentro do card do lead (Junior, 28/07/2026, item 6 da
 * fila): registrar dentista/procedimento/valor SEM sair pro menu Atendimentos.
 *
 * O modelo já ligava atendimento a contato e oportunidade — faltava só a porta.
 * Reaproveita o MESMO controller e o MESMO drawer da tela de Atendimentos
 * (duplicar formulário faria as versões divergirem na primeira correção);
 * a diferença é o lead vir TRAVADO: a lista de oportunidades entregue ao
 * drawer contém só a do card, já pré-selecionada.
 *
 * Montar SÓ quando aberto — o controller carrega as consultas da tela de
 * Atendimentos, e não faz sentido pagá-las com a porta fechada.
 */
export function RegistrarAtendimentoDoLead({
  dealId,
  onClose,
}: {
  dealId: string;
  onClose: () => void;
}) {
  const controller = useAtendimentosController();
  const { setFormData, setIsModalOpen, isModalOpen } = controller;

  // Ao montar: form zerado com o lead do card já escolhido.
  React.useEffect(() => {
    setFormData({ ...formVazioDeAtendimento, dealId });
    setIsModalOpen(true);
  }, [dealId, setFormData, setIsModalOpen]);

  // O salvar com sucesso fecha pelo controller (setIsModalOpen(false)) — o
  // card precisa saber. `chegouAbrir` evita fechar no primeiro render, quando
  // o estado do controller ainda não virou true.
  const chegouAbrir = React.useRef(false);
  React.useEffect(() => {
    if (isModalOpen) {
      chegouAbrir.current = true;
      return;
    }
    if (chegouAbrir.current) {
      chegouAbrir.current = false;
      onClose();
    }
  }, [isModalOpen, onClose]);

  const dealsDoLead = React.useMemo(
    () => controller.deals.filter((deal) => deal.id === dealId),
    [controller.deals, dealId],
  );

  return (
    <AtendimentoFormModal
      isOpen
      onClose={onClose}
      onSubmit={controller.handleSubmit}
      formData={controller.formData}
      setFormData={controller.setFormData}
      editing={null}
      deals={dealsDoLead}
      professionals={controller.professionals}
      products={controller.products}
    />
  );
}
