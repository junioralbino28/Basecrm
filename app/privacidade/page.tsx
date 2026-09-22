import type { Metadata } from 'next';

// Pagina publica (sem login): o Google exige o link da politica de privacidade para publicar o app
// OAuth do Google Agenda (tela de consentimento externa, 22/09/2026). Liberada em
// lib/supabase/middleware.ts. O texto descreve so o que o sistema faz de fato.

export const metadata: Metadata = {
  title: 'Política de Privacidade — CENNO CRM',
  description: 'Como o CENNO CRM trata dados pessoais e dados do Google Agenda.',
};

const ATUALIZADO_EM = '22 de setembro de 2026';

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{titulo}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{children}</div>
    </section>
  );
}

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-dark-bg px-4 py-12">
      <article className="mx-auto max-w-3xl space-y-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-dark-card">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-display">
            Política de Privacidade
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            CENNO CRM, operado pela Cenoura Hub. Atualizada em {ATUALIZADO_EM}.
          </p>
        </header>

        <Secao titulo="1. Sobre este documento">
          <p>
            O CENNO CRM é o sistema de atendimento e vendas usado pela Cenoura Hub e por empresas clientes dela
            (&quot;empresas usuárias&quot;) para organizar contatos, conversas de WhatsApp, negócios e reuniões. Esta
            política explica quais dados tratamos, para quê, com quem compartilhamos e como você exerce seus direitos,
            nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018).
          </p>
        </Secao>

        <Secao titulo="2. Dados que tratamos">
          <p>
            <strong>Dos usuários do sistema</strong> (equipe das empresas usuárias): nome, e-mail, telefone e registros
            de uso necessários para login e segurança.
          </p>
          <p>
            <strong>Dos contatos atendidos</strong> (por exemplo, quem escreve para o WhatsApp de uma empresa usuária):
            nome, telefone, e-mail quando informado, mensagens trocadas (texto, áudio e imagem), dados do negócio e
            reuniões marcadas.
          </p>
          <p>
            <strong>Do Google Agenda</strong>, somente quando um usuário conecta a própria conta Google por vontade
            própria: o e-mail da conta, os períodos em que a agenda está ocupada (sem título nem conteúdo dos eventos)
            e os eventos de reunião que o próprio CRM cria.
          </p>
        </Secao>

        <Secao titulo="3. Para que usamos">
          <p>
            Para prestar o serviço: registrar e responder conversas, organizar o funil de vendas, oferecer horários
            livres para reunião e confirmar reuniões. Mensagens podem ser processadas por serviços de inteligência
            artificial contratados para gerar respostas automáticas, transcrever áudios e descrever imagens.
          </p>
        </Secao>

        <Secao titulo="4. Dados do Google (uso limitado)">
          <p>Quando um usuário conecta o Google Agenda, o CRM pede apenas duas permissões:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>ver os horários ocupados da agenda, para não oferecer a um cliente um horário que já está tomado;</li>
            <li>criar, alterar e cancelar os eventos das reuniões marcadas pelo CRM, com o convidado e o link do Google Meet.</li>
          </ul>
          <p>
            O CRM não lê títulos, descrições nem participantes dos outros eventos da agenda, não usa esses dados para
            publicidade, não os vende e não os usa para treinar modelos de inteligência artificial. O acesso é guardado
            criptografado e pode ser revogado a qualquer momento pelo botão &quot;Desconectar&quot; no CRM ou em{' '}
            <a
              className="font-medium text-brand-600 hover:text-brand-500"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>
          <p>
            O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs do Google
            seguem a{' '}
            <a
              className="font-medium text-brand-600 hover:text-brand-500"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Política de Dados do Usuário dos Serviços de API do Google
            </a>
            , incluindo os requisitos de Uso Limitado.
          </p>
        </Secao>

        <Secao titulo="5. Com quem compartilhamos">
          <p>
            Somente com fornecedores necessários para o serviço funcionar, sob contrato: hospedagem e banco de dados,
            provedores de WhatsApp, provedores de inteligência artificial e o Google, quando a agenda está conectada.
            Alguns desses fornecedores ficam fora do Brasil; nesses casos a transferência segue a LGPD. Não vendemos
            dados pessoais.
          </p>
        </Secao>

        <Secao titulo="6. Por quanto tempo guardamos">
          <p>
            Enquanto a empresa usuária mantiver a conta ativa ou pelo tempo exigido por lei. O acesso ao Google Agenda
            é apagado quando o usuário desconecta a conta.
          </p>
        </Secao>

        <Secao titulo="7. Seus direitos">
          <p>
            Você pode pedir confirmação de tratamento, acesso, correção, anonimização, portabilidade ou exclusão dos
            seus dados, e revogar consentimentos. Se você é contato de uma empresa usuária, o pedido também pode ser
            feito diretamente a ela.
          </p>
        </Secao>

        <Secao titulo="8. Contato">
          <p>
            Pedidos e dúvidas sobre privacidade:{' '}
            <a className="font-medium text-brand-600 hover:text-brand-500" href="mailto:cenourahub@gmail.com">
              cenourahub@gmail.com
            </a>
            .
          </p>
        </Secao>
      </article>
    </main>
  );
}
