# RASCUNHO SUPERADO — NÃO IMPLEMENTAR

Este arquivo é o plano inicial, anterior à revisão adversarial de 25/09/2026. Ele contém passos e testes incorretos, além de um push proibido pelas regras do repositório. A proposta atual para revisão do Claude e aprovação do Junior está em [docs/features/atendimento-multi-atendente/SPEC.md](features/atendimento-multi-atendente/SPEC.md). Após a aprovação, escrever um PLAN novo; não executar as etapas abaixo.

# Atendimento multi-atendente — plano de implementação (histórico)

> **Para quem for executar:** as etapas usam caixa (`- [ ]`) para acompanhamento. Cada etapa é uma ação de 2 a 5 minutos. Escreva o teste, veja falhar, implemente, veja passar, comite.

**Objetivo:** quando um humano assume a conversa e responde, o lead passa a ver quem está falando — sem trocar de número, sem aviso de troca, e sem mudar nada no que a IA já faz hoje.

**Arquitetura:** uma função pura decide o texto assinado; a rota de envio manual aplica esse texto **só no que sai para a Evolution** (o `content` gravado no CRM continua sem prefixo, porque o histórico que a IA lê já carrega o autor num campo separado). O interruptor é um campo novo em `channel_connections.config`, que **todo cliente ganha** e nasce desligado — ninguém muda de comportamento sem ligar. A tela ganha um botão único de assumir e o nome do remetente na bolha.

**Stack:** Next.js 16 (App Router), TypeScript, zod, Supabase, vitest 4, Testing Library.

---

## Decisões fechadas com o Junior (25/09)

| Pergunta | Resposta |
|---|---|
| Aviso de troca de atendente ("SDR1 começou a te atender") | **Fica de fora.** Nem o Kommo faz. |
| O prefixo vale também para a IA? | **Só humano.** A Aurora/Julia continua exatamente como está. |
| Feature por cliente? | **Não.** Campo que todos ganham, com o comportamento de hoje como padrão. |

Consequência direta da segunda resposta: **o risco de assinatura dupla com a IA desaparece** (o prompt da Aurora se autoidentifica no texto; se ela também fosse assinada, sairia "Aurora: Oi, aqui é a Aurora"). Nada em `lib/conversations/aiReply.ts` é tocado neste plano.

---

## O que já funciona hoje (medido, não é preciso construir)

- **"Para o lead o número não muda" já é verdade.** A resposta manual sai sempre pela conexão da própria conversa — `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts:204-211` busca `channel_connections` por `threadData.channel_connection_id`. Não existe "conexão padrão" em lugar nenhum.
- **Vários números por cliente, sem limite**, cada um com nome livre e IA ligando/desligando por número.
- **O nome de exibição do atendente já é resolvido** por `getConversationAssigneeDisplayName` (`lib/conversations/server.ts:77`), que prefere `profiles.nickname` — o campo é editável pelo próprio usuário em `features/profile/ProfilePage.tsx:227`. É dele que sai o "Vitória".
- **A rota de envio já grava o autor** (`author_name`, calculado em `messages/route.ts:86-93`) e **já muda o status para `human_active`** (linhas 325-332).
- **O PATCH da conversa já aceita status e responsável no mesmo pedido** (`conversations/[threadId]/route.ts:31-41`). O botão único é trabalho **só de tela** — nenhuma mudança de API.
- **O histórico que a IA lê já separa o autor do texto**: `formatRecentMessages` (`lib/conversations/aiReply.ts:149-179`) monta `- CRM | Vitoria | <data>: <texto>`. Por isso o prefixo **não pode** entrar no `content` gravado: duplicaria a informação dentro do texto.
- **A tela enxerga o config inteiro** (menos segredos): `toPublicChannelConnection` (`lib/channels/publicChannel.ts:36-58`) repassa o resto do objeto. Campo novo chega à tela sem mudança nenhuma.

## O que NÃO muda

- A IA (`lib/conversations/aiReply.ts`), a cutucada de inatividade (`lib/conversations/idleNudge.ts`), o lembrete de reunião (`lib/conversations/meetingReminder.ts`), o executor de automação (`lib/automations/executor.ts`) e o teste de envio da conexão (`channels/[connectionId]/send-test/route.ts`) **não passam pela rota de envio manual**. Ficam de fora por construção — a Tarefa 7 trava isso com teste.
- Nota interna (`direction: 'internal'`) não sai para o lead e não entra no bloco de envio.
- O `content` gravado em `conversation_messages`, a lista de conversas, o filtro por número e o rodízio do "Falar com humano" continuam iguais.

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `lib/conversations/assinaturaAtendente.ts` | decide o texto assinado e lê o interruptor do config | **criar** |
| `lib/conversations/assinaturaAtendente.test.ts` | regras da função pura | **criar** |
| `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts` | aplica o texto assinado só no que vai à Evolution | modificar |
| `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.assinatura.test.ts` | prova o texto entregue à Evolution e o gravado no CRM | **criar** |
| `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts` | aceita e mescla o campo novo | modificar (2 linhas) |
| `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.patch.test.ts` | caso do campo novo | modificar |
| `features/platform/tenants/TenantChannelsPage.tsx` | interruptor por número | modificar |
| `features/platform/tenants/TenantConversationsPage.tsx` | botão único "Assumir atendimento" | modificar |
| `features/platform/tenants/TenantConversationsPage.test.tsx` | comportamento do botão, com e sem pertencer ao cliente | modificar |
| `features/platform/tenants/conversations/MessageBubble.tsx` | nome do remetente na bolha de saída | modificar |
| `features/platform/tenants/conversations/messageBubbleRemetente.test.tsx` | a bolha mostra quem enviou | **criar** |
| `test/fronteiraAssinatura.test.ts` | quem nunca assina | **criar** |

---

## Tarefa 1: a função que decide o texto assinado

**Arquivos:**
- Criar: `lib/conversations/assinaturaAtendente.ts`
- Teste: `lib/conversations/assinaturaAtendente.test.ts`

> ⚠️ **Ao escrever o arquivo:** a regex de acento usa os escapes `̀` e `ͯ`. A ferramenta Write converte escape Unicode em caractere literal e quebra a regex. Escreva este arquivo por `cat > arquivo <<'EOF'` (heredoc com aspas) ou confira depois com `grep -c 'u0300' lib/conversations/assinaturaAtendente.ts` — tem que devolver 1.

- [ ] **Etapa 1: escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { assinarMensagemDoAtendente, resolveAssinaturaAtivada } from './assinaturaAtendente';

describe('resolveAssinaturaAtivada: o interruptor por numero', () => {
  it('nasce desligado — conexao sem o campo, com o campo nulo ou com lixo no lugar', () => {
    expect(resolveAssinaturaAtivada(null)).toBe(false);
    expect(resolveAssinaturaAtivada({})).toBe(false);
    expect(resolveAssinaturaAtivada({ signManualReplies: null })).toBe(false);
    expect(resolveAssinaturaAtivada({ signManualReplies: 'true' })).toBe(false);
    expect(resolveAssinaturaAtivada({ signManualReplies: false })).toBe(false);
  });

  it('so liga com o booleano verdadeiro', () => {
    expect(resolveAssinaturaAtivada({ signManualReplies: true })).toBe(true);
  });
});

describe('assinarMensagemDoAtendente', () => {
  it('desligado devolve o texto intacto', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Oi, tudo bem?', nomeDoAtendente: 'Vitoria', ativada: false }),
    ).toBe('Oi, tudo bem?');
  });

  it('ligado poe o nome na frente', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Oi, tudo bem?', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Oi, tudo bem?');
  });

  it('texto vazio continua vazio — midia sem legenda nao ganha legenda', () => {
    expect(assinarMensagemDoAtendente({ texto: '', nomeDoAtendente: 'Vitoria', ativada: true })).toBe('');
    expect(assinarMensagemDoAtendente({ texto: '   ', nomeDoAtendente: 'Vitoria', ativada: true })).toBe('   ');
  });

  it('sem nome utilizavel devolve o texto intacto', () => {
    expect(assinarMensagemDoAtendente({ texto: 'Oi', nomeDoAtendente: null, ativada: true })).toBe('Oi');
    expect(assinarMensagemDoAtendente({ texto: 'Oi', nomeDoAtendente: '   ', ativada: true })).toBe('Oi');
    expect(assinarMensagemDoAtendente({ texto: 'Oi', nomeDoAtendente: '123', ativada: true })).toBe('Oi');
  });

  it('nao assina duas vezes quando o atendente ja digitou o proprio nome', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Vitoria: Oi', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Oi');
  });

  it('a guarda contra assinatura dupla ignora acento e caixa', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'vitoria: Oi', nomeDoAtendente: 'Vitória', ativada: true }),
    ).toBe('vitoria: Oi');
    expect(
      assinarMensagemDoAtendente({ texto: 'VITÓRIA: Oi', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('VITÓRIA: Oi');
  });

  it('nome de OUTRA pessoa no comeco nao conta como ja assinado', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Dr. Adel: passo amanha', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Dr. Adel: passo amanha');
  });

  it('texto de varias linhas recebe o nome so na primeira', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Oi\nsegue o endereco', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Oi\nsegue o endereco');
  });
});
```

- [ ] **Etapa 2: rodar e ver falhar**

Executar: `npx vitest run lib/conversations/assinaturaAtendente.test.ts`
Esperado: FALHA com `Failed to resolve import "./assinaturaAtendente"`.

- [ ] **Etapa 3: escrever a implementação**

```ts
/**
 * Assinatura do atendente humano na mensagem que o lead recebe.
 *
 * Decisao do Junior (25/09/2026): para o lead o NUMERO nunca muda; o que muda e o NOME de
 * quem esta atendendo, na frente da mensagem. Vale SO para humano — a IA continua se
 * apresentando pelo texto do proprio prompt, e assinar tambem ela produziria
 * "Aurora: Oi, aqui e a Aurora".
 *
 * O prefixo entra SO no texto entregue a Evolution. O `content` gravado em
 * `conversation_messages` fica sem ele de proposito: o historico que a IA le ja traz o autor
 * num campo separado (`formatRecentMessages`), e o prefixo dentro do texto duplicaria o dado.
 */

/** Tira acento e caixa — so para COMPARAR; nunca para montar o texto que sai. */
function normalizar(valor: string) {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Nasce desligado em todo cliente: so o booleano verdadeiro liga. */
export function resolveAssinaturaAtivada(config: Record<string, unknown> | null | undefined) {
  return (config as { signManualReplies?: unknown } | null | undefined)?.signManualReplies === true;
}

export function assinarMensagemDoAtendente(params: {
  texto: string;
  nomeDoAtendente: string | null | undefined;
  ativada: boolean;
}) {
  const { texto, nomeDoAtendente, ativada } = params;
  if (!ativada) return texto;

  // Midia sem legenda nao ganha legenda: assinar aqui criaria um texto onde nao havia nenhum.
  const corpo = texto.trim();
  if (!corpo) return texto;

  const nome = (nomeDoAtendente || '').trim();
  if (!nome || !/\p{L}/u.test(nome)) return texto;

  // Ja assinado a mao pelo proprio atendente — nao duplica.
  if (normalizar(corpo).startsWith(`${normalizar(nome)}:`)) return texto;

  return `${nome}: ${corpo}`;
}
```

- [ ] **Etapa 4: conferir que o escape sobreviveu à escrita**

Executar: `grep -c 'u0300' lib/conversations/assinaturaAtendente.ts`
Esperado: `1`. Se devolver `0`, o escape virou caractere literal — reescrever o arquivo por heredoc com aspas.

- [ ] **Etapa 5: rodar e ver passar**

Executar: `npx vitest run lib/conversations/assinaturaAtendente.test.ts`
Esperado: PASSA, 9 testes.

- [ ] **Etapa 6: comitar**

```bash
git add lib/conversations/assinaturaAtendente.ts lib/conversations/assinaturaAtendente.test.ts
git commit -m "feat(atendimento): funcao que assina a mensagem com o nome do atendente"
```

---

## Tarefa 2: aplicar a assinatura no envio manual

**Arquivos:**
- Modificar: `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`
- Teste: `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.assinatura.test.ts` (criar)

- [ ] **Etapa 1: escrever o teste que falha**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * A assinatura do atendente entra SO no texto que vai para a Evolution. O `content` gravado
 * fica sem o prefixo, porque o historico que a IA le ja traz o autor num campo separado.
 */

let fake: FakeSupabaseAdmin;
let conteudoGravado = '';
const requireTenantAccessMock = vi.fn();
const sendTextMock = vi.fn();
const sendMediaMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const USER = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => fake }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({
    apiUrl: 'https://evolution.example.com',
    apiKey: 'CHAVE',
    source: 'connection',
  })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendTextMock(...args),
}));
vi.mock('@/lib/conversations/conversationMedia', () => ({
  dispatchConversationMedia: (...args: unknown[]) => sendMediaMock(...args),
}));
vi.mock('@/lib/conversations/server', () => ({
  getConversationAssigneeDisplayName: () => 'Vitoria',
  loadConversationThreadInboxItem: vi.fn(async () => ({ id: THREAD })),
}));
// Executa o `deliver` de verdade e devolve o que a rota espera, sem o caminho de persistencia.
vi.mock('@/lib/conversations/dispatchConversationOutbound', () => ({
  dispatchManualConversationOutbound: async ({
    message,
    deliver,
  }: {
    message: { content: string };
    deliver: () => Promise<unknown>;
  }) => {
    conteudoGravado = message.content;
    await deliver();
    return { messageId: 'msg-1', status: 'sent', error: null };
  },
}));

import { POST } from './route';

function seed(config: Record<string, unknown>) {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [
      {
        id: THREAD,
        organization_id: TENANT,
        status: 'human_active',
        metadata: {},
        channel_connection_id: CONNECTION,
        contact_phone: '5521999990000',
        assigned_user_id: USER,
        deal_id: null,
      },
    ],
    channel_connections: [
      {
        id: CONNECTION,
        organization_id: TENANT,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'Recepcao',
        config: { instanceName: 'recepcao', ...config },
      },
    ],
    conversation_messages: [
      {
        id: 'msg-1',
        thread_id: THREAD,
        organization_id: TENANT,
        direction: 'outbound',
        message_type: 'text',
        author_name: 'Vitoria',
        content: '',
        metadata: {},
        sent_at: '2026-09-25T12:00:00.000Z',
        created_at: '2026-09-25T12:00:00.000Z',
      },
    ],
  });
}

function post(body: unknown) {
  return POST(
    new Request(`https://crm.test/api/platform/tenants/${TENANT}/conversations/${THREAD}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tenantId: TENANT, threadId: THREAD }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  conteudoGravado = '';
  sendTextMock.mockResolvedValue({ providerMessageId: 'evo-1', attemptLabel: 'number_text', raw: {} });
  sendMediaMock.mockResolvedValue({ delivery_status: 'sent', provider_message_id: 'evo-2' });
  requireTenantAccessMock.mockResolvedValue({
    profile: {
      id: USER,
      email: 'vitoria@clinica.com',
      first_name: 'Vitoria',
      last_name: null,
      nickname: 'Vitoria',
      role: 'clinic_staff',
      organization_id: TENANT,
    },
  });
});

describe('envio manual: assinatura do atendente', () => {
  it('com o interruptor LIGADO o lead recebe o nome e o CRM grava o texto puro', async () => {
    seed({ signManualReplies: true });

    const response = await post({ direction: 'outbound', content: 'Oi, confirmo amanha as 14h' });

    expect(response.status).toBe(201);
    expect(sendTextMock.mock.calls[0]?.[0]).toMatchObject({ text: 'Vitoria: Oi, confirmo amanha as 14h' });
    expect(conteudoGravado).toBe('Oi, confirmo amanha as 14h');
  });

  it('com o interruptor DESLIGADO nada muda — o comportamento de hoje', async () => {
    seed({});

    const response = await post({ direction: 'outbound', content: 'Oi, confirmo amanha as 14h' });

    expect(response.status).toBe(201);
    expect(sendTextMock.mock.calls[0]?.[0]).toMatchObject({ text: 'Oi, confirmo amanha as 14h' });
    expect(conteudoGravado).toBe('Oi, confirmo amanha as 14h');
  });

  it('nota interna nunca sai para o lead', async () => {
    seed({ signManualReplies: true });

    const response = await post({ direction: 'internal', content: 'lead pediu desconto' });

    expect(response.status).toBe(201);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('quem assina e o PERFIL autenticado, nao o author_name que veio no corpo', async () => {
    // `author_name` e campo livre do payload (ate 160 caracteres): se ele assinasse, qualquer
    // um com permissao de responder se passaria por outro atendente na mensagem do lead.
    seed({ signManualReplies: true });

    const response = await post({
      direction: 'outbound',
      author_name: 'Dr. Adel',
      content: 'pode vir amanha',
    });

    expect(response.status).toBe(201);
    expect(sendTextMock.mock.calls[0]?.[0]).toMatchObject({ text: 'Vitoria: pode vir amanha' });
  });
});
```

- [ ] **Etapa 2: rodar e ver falhar**

Executar: `npx vitest run "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.assinatura.test.ts"`
Esperado: FALHA no primeiro caso — o texto entregue é `'Oi, confirmo amanha as 14h'`, sem o nome.

- [ ] **Etapa 3: importar a função na rota**

Em `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`, junto dos outros imports de `@/lib/conversations/`:

```ts
import {
  assinarMensagemDoAtendente,
  resolveAssinaturaAtivada,
} from '@/lib/conversations/assinaturaAtendente';
```

- [ ] **Etapa 4: separar o nome que ASSINA do nome que é GRAVADO**

`author_name` é campo livre do payload (`MessageSchema`, linha 41: string de até 160 caracteres) e hoje tem prioridade sobre o perfil (linhas 86-93). Gravar isso no histórico interno é inofensivo; **assinar com isso não é** — qualquer um com `conversations.reply` se passaria por outro atendente na mensagem que o lead recebe. Substituir o bloco das linhas 86-93 por:

```ts
  // Nome do PERFIL AUTENTICADO: e ele, e so ele, que assina a mensagem que o lead recebe.
  const nomeDoAtendenteAutenticado = getConversationAssigneeDisplayName({
    email: (auth.profile as { email?: string | null }).email,
    first_name: (auth.profile as { first_name?: string | null }).first_name,
    last_name: (auth.profile as { last_name?: string | null }).last_name,
    nickname: (auth.profile as { nickname?: string | null }).nickname,
  });

  // O `author_name` do corpo continua valendo para o historico do CRM (compatibilidade com a
  // tela, que manda o nome do compositor), mas NUNCA para a assinatura.
  const authorName = parsed.data.author_name?.trim() || nomeDoAtendenteAutenticado;
```

- [ ] **Etapa 5: montar o texto assinado depois de resolver a conexão**

Dentro de `const deliver = async () => { ... }`, logo depois do bloco que valida `instanceName`/credenciais/telefone (hoje termina em `if (!phone) throw new Error('Conversation requires a valid contact phone before sending.');`), inserir:

```ts
      // O nome do atendente entra SO aqui, no que vai para a Evolution. O `storedContent`
      // gravado no CRM continua sem prefixo de proposito — ver assinaturaAtendente.ts.
      const textoParaOLead = assinarMensagemDoAtendente({
        texto: messageContent,
        nomeDoAtendente: nomeDoAtendenteAutenticado,
        ativada: resolveAssinaturaAtivada(connection.data.config as Record<string, unknown> | null),
      });
```

- [ ] **Etapa 6: usar o texto assinado nos dois caminhos de envio**

No envio de mídia, trocar a legenda:

```ts
            caption: textoParaOLead || undefined,
```

No envio de texto, trocar o corpo:

```ts
      const result = await sendEvolutionTextMessage({
        apiUrl: resolved.apiUrl,
        instanceName,
        apiKey: resolved.apiKey,
        phone,
        text: textoParaOLead,
      });
```

Não tocar em `storedContent` (linha ~173) nem no `content` passado a `dispatchManualConversationOutbound`.

- [ ] **Etapa 7: rodar e ver passar**

Executar: `npx vitest run "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.assinatura.test.ts"`
Esperado: PASSA, 4 testes.

- [ ] **Etapa 8: comitar**

```bash
git add "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts" "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.assinatura.test.ts"
git commit -m "feat(atendimento): o lead ve o nome de quem assumiu, so no texto enviado"
```

---

## Tarefa 3: o interruptor na API da conexão

**Arquivos:**
- Modificar: `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:24-51` (schema) e `:111-155` (merge)
- Teste: `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.patch.test.ts`

- [ ] **Etapa 1: escrever o teste que falha**

Acrescentar ao fim do `describe` existente em `route.patch.test.ts`:

```ts
  it('liga a assinatura do atendente sem apagar o resto da configuracao', async () => {
    const response = await patch({ config: { signManualReplies: true } });

    expect(response.status).toBe(200);
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({
      config: { ...baseConfig, signManualReplies: true },
    });
  });

  it('desligar a assinatura grava o falso, nao apaga o campo', async () => {
    currentConfig = { ...baseConfig, signManualReplies: true };

    const response = await patch({ config: { signManualReplies: false } });

    expect(response.status).toBe(200);
    const saved = updateMock.mock.calls[0]?.[0] as { config: Record<string, unknown> };
    expect(saved.config.signManualReplies).toBe(false);
  });

  it('recusa valor que nao seja booleano', async () => {
    expect((await patch({ config: { signManualReplies: 'sim' } })).status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
```

- [ ] **Etapa 2: rodar e ver falhar**

Executar: `npx vitest run "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.patch.test.ts"`
Esperado: FALHA — o schema é `.strict()`, então `signManualReplies` devolve 400 nos dois primeiros casos.

- [ ] **Etapa 3: aceitar o campo no schema**

Em `route.ts`, dentro de `ChannelUpdateSchema.config`, depois da linha de `meetingChannelText`:

```ts
    // Assinatura do atendente humano no texto que o lead recebe. Todo cliente tem o campo;
    // ausente ou falso = o comportamento de hoje (sem nome na frente).
    signManualReplies: z.boolean().optional(),
```

- [ ] **Etapa 4: mesclar o campo**

No bloco `nextConfig`, depois da linha de `meetingChannelText`:

```ts
        if (incoming.signManualReplies !== undefined) merged.signManualReplies = incoming.signManualReplies;
```

- [ ] **Etapa 5: rodar e ver passar**

Executar: `npx vitest run "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.patch.test.ts"`
Esperado: PASSA, incluindo os 3 casos novos.

- [ ] **Etapa 6: comitar**

```bash
git add "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts" "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.patch.test.ts"
git commit -m "feat(canais): interruptor da assinatura do atendente por numero"
```

---

## Tarefa 4: o interruptor na tela de canais

**Arquivos:**
- Modificar: `features/platform/tenants/TenantChannelsPage.tsx` (função nova perto de `updateAIEnabled`, linha ~707; controle novo logo abaixo do rótulo "IA responde automático", linha ~1053)

Segue o padrão exato do interruptor de IA que já existe ao lado.

- [ ] **Etapa 1: acrescentar o estado do salvamento**

Junto da declaração de `savingAIConnectionId` (procurar `const [savingAIConnectionId`), acrescentar:

```tsx
  const [savingSignConnectionId, setSavingSignConnectionId] = React.useState<string | null>(null);
  const [signOverrides, setSignOverrides] = React.useState<Record<string, boolean>>({});
```

> Se o arquivo importar `useState` diretamente em vez de `React`, usar a mesma forma das linhas vizinhas.

- [ ] **Etapa 2: acrescentar a função que salva**

Logo depois da função `updateAIEnabled` (que termina por volta da linha 739):

```tsx
  async function updateSignManualReplies(connectionId: string, enabled: boolean) {
    if (!tenantId) return;
    setSavingSignConnectionId(connectionId);
    setSignOverrides((current) => ({ ...current, [connectionId]: enabled }));
    setMessage(null);

    try {
      const res = await fetch(`/api/platform/tenants/${tenantId}/channels/${connectionId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ config: { signManualReplies: enabled } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao alterar a assinatura (HTTP ${res.status})`);

      setMessageKind('success');
      setMessage(
        enabled
          ? 'As respostas dos atendentes passam a sair com o nome de quem atendeu.'
          : 'As respostas dos atendentes voltam a sair sem o nome na frente.',
      );
      await reload();
    } catch (updateError) {
      setSignOverrides((current) => {
        const next = { ...current };
        delete next[connectionId];
        return next;
      });
      setMessageKind('error');
      setMessage(updateError instanceof Error ? updateError.message : 'Falha ao alterar a assinatura deste numero.');
    } finally {
      setSavingSignConnectionId(null);
    }
  }
```

- [ ] **Etapa 3: acrescentar o controle na tela**

Logo depois do `</label>` do interruptor "IA responde automático" (por volta da linha 1070), antes do bloco `{tenantId ? (<ChannelCalendarSettings ...`:

```tsx
                    <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 dark:border-white/10 dark:bg-card dark:text-slate-100">
                      <span>
                        Assinar com o nome de quem atende
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          Vale só para mensagem enviada por uma pessoa. A IA continua como está.
                        </span>
                        {savingSignConnectionId === connection.id ? (
                          <span className="ml-2 text-xs font-normal text-slate-500">Salvando...</span>
                        ) : null}
                      </span>
                      <input
                        type="checkbox"
                        checked={
                          signOverrides[connection.id] ??
                          (connection.config?.signManualReplies === true)
                        }
                        disabled={!canManageChannelConfig || savingSignConnectionId === connection.id}
                        onChange={(event) => void updateSignManualReplies(connection.id, event.target.checked)}
                        className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>
```

- [ ] **Etapa 4: conferir tipo e testes da tela**

Executar: `npx tsc --noEmit`
Esperado: sem erro. Se acusar `signManualReplies` desconhecido no tipo do `config`, trocar a leitura por `(connection.config as Record<string, unknown> | undefined)?.signManualReplies === true`.

Executar: `npx vitest run features/platform/tenants/TenantChannelsPage.test.tsx`
Esperado: PASSA, sem regressão.

- [ ] **Etapa 5: comitar**

```bash
git add features/platform/tenants/TenantChannelsPage.tsx
git commit -m "feat(canais): interruptor da assinatura na tela de cada numero"
```

---

## Tarefa 5: botão único "Assumir atendimento"

**Arquivos:**
- Modificar: `features/platform/tenants/TenantConversationsPage.tsx` (grupo de botões que começa por volta da linha 1297, onde ficam "Falar com humano" e "Marcar como resolvido")
- Teste: `features/platform/tenants/TenantConversationsPage.test.tsx`

Hoje assumir uma conversa exige **dois** controles em popovers diferentes: o status (select "Humano atendendo") e o responsável (select no ícone de pessoa). O botão faz os dois num clique.

> ⚠️ **Descoberto na medição, e é o que decide o desenho:** o PATCH valida que o `assigned_user_id` pertence àquele cliente (`conversations/[threadId]/route.ts:76-86`). Quem entra como **agência** dentro do tenant de um cliente **não pertence** àquela organização e tomaria 404 ao se atribuir. Por isso o botão só manda o responsável quando o usuário atual está na lista `assignees` (que é a lista de gente daquele cliente); fora disso ele muda só o status, e o texto do botão muda junto.

- [ ] **Etapa 1: dar um `id` ao perfil mockado**

O arquivo de teste hoje tem, na linha 27, `const profile = { role: 'clinic_staff', first_name: 'Ana' };` — **sem `id`**. O mock de `useAuth` (linha ~150) devolve essa referência, e a lista fixa de responsáveis do mock do `useQuery` (linha ~98) tem um único `{ id: 'user-1', display_name: 'Ana Souza' }`. Trocar a linha 27 por:

```tsx
// `id` casa com o unico responsavel do mock do inbox: por padrao o usuario PERTENCE ao cliente.
// Os casos que precisam do contrario trocam `profile.id` — o mock le a referencia.
const profile: { role: string; first_name: string; id?: string } = {
  role: 'clinic_staff',
  first_name: 'Ana',
  id: 'user-1',
};
```

E acrescentar ao `beforeEach` existente (linha ~179), junto de `resetThreads();`:

```tsx
  profile.id = 'user-1';
```

- [ ] **Etapa 2: escrever o teste que falha**

Acrescentar ao `describe` existente, no mesmo estilo dos casos vizinhos (`render` direto, `mutateSpy` como espião das mutações):

```tsx
  it('assumir atendimento muda status e responsavel num clique so', async () => {
    // `profile.id` = 'user-1' = o responsavel do mock: o usuario PERTENCE a este cliente.
    render(<TenantConversationsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /assumir atendimento/i }));

    expect(mutateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-reception',
        body: { status: 'human_active', assigned_user_id: 'user-1' },
      }),
    );
  });

  it('quem nao pertence ao cliente assume sem virar responsavel', async () => {
    // Admin da agencia dentro do tenant do cliente: o PATCH recusaria o responsavel (404).
    profile.id = 'admin-da-agencia';
    render(<TenantConversationsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /assumir a conversa/i }));

    expect(mutateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-reception',
        body: { status: 'human_active' },
      }),
    );
  });
```

- [ ] **Etapa 3: rodar e ver falhar**

Executar: `npx vitest run features/platform/tenants/TenantConversationsPage.test.tsx -t "assumir"`
Esperado: FALHA com `Unable to find an accessible element with the role "button" and name /assumir atendimento/i`.

- [ ] **Etapa 4: calcular se o usuário pertence ao cliente**

Logo depois de `const assignees = inboxQuery.data?.assignees || [];` (linha ~639):

```tsx
  /**
   * So quem PERTENCE a este cliente pode virar responsavel: o PATCH valida o vinculo e devolve
   * 404 para quem esta aqui como agencia. Nesse caso o botao muda so o status.
   */
  const souResponsavelPossivel = Boolean(profile?.id && assignees.some(a => a.id === profile.id));
```

- [ ] **Etapa 5: acrescentar o botão**

Como **primeiro** botão do grupo `<div className="mt-2 flex flex-wrap gap-2">` (antes do "Falar com humano"):

```tsx
                  <button
                    type="button"
                    onClick={() =>
                      updateThreadMutation.mutate({
                        threadId: selectedThread.id,
                        body: souResponsavelPossivel && profile?.id
                          ? { status: 'human_active', assigned_user_id: profile.id }
                          : { status: 'human_active' },
                      })
                    }
                    disabled={
                      updateThreadMutation.isPending
                      || (selectedThread.status === 'human_active'
                        && (!souResponsavelPossivel || selectedThread.assigned_user_id === profile?.id))
                    }
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <UserRound size={16} />
                    {souResponsavelPossivel ? 'Assumir atendimento' : 'Assumir a conversa'}
                  </button>
```

`UserRound` já está importado no arquivo (usado no ícone de responsável).

- [ ] **Etapa 6: rodar e ver passar**

Executar: `npx vitest run features/platform/tenants/TenantConversationsPage.test.tsx`
Esperado: PASSA, incluindo os 2 casos novos e sem regressão nos existentes — em especial os que afirmam o `author_name` do compositor, que lê o mesmo `profile`.

- [ ] **Etapa 7: comitar**

```bash
git add features/platform/tenants/TenantConversationsPage.tsx features/platform/tenants/TenantConversationsPage.test.tsx
git commit -m "feat(conversas): botao unico para assumir o atendimento"
```

---

## Tarefa 6: o nome do remetente na bolha

**Arquivos:**
- Modificar: `features/platform/tenants/conversations/MessageBubble.tsx:293-298`
- Teste: `features/platform/tenants/conversations/messageBubbleRemetente.test.tsx` (criar)

Hoje o autor só aparece em nota interna. Com vários atendentes no mesmo número, quem abre a conversa precisa ver quem respondeu — inclusive quando a assinatura está desligada.

- [ ] **Etapa 1: escrever o teste que falha**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';

/** Com varios atendentes no mesmo numero, quem abre a conversa precisa ver quem respondeu. */

function mensagem(extra: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    thread_id: 't1',
    organization_id: 'o1',
    direction: 'outbound',
    message_type: 'text',
    author_name: 'Vitoria',
    content: 'Confirmo amanha as 14h',
    metadata: {},
    sent_at: '2026-09-25T12:00:00.000Z',
    created_at: '2026-09-25T12:00:00.000Z',
    ...extra,
  } as never;
}

describe('MessageBubble: quem enviou', () => {
  it('mostra o nome do atendente na mensagem que saiu', () => {
    render(<MessageBubble message={mensagem()} />);
    expect(screen.getByText('Vitoria')).toBeInTheDocument();
  });

  it('nao mostra nada quando a mensagem saiu sem autor', () => {
    render(<MessageBubble message={mensagem({ author_name: null })} />);
    expect(screen.queryByTestId('remetente-da-bolha')).not.toBeInTheDocument();
  });

  it('a mensagem do lead nao ganha rotulo de remetente', () => {
    render(<MessageBubble message={mensagem({ direction: 'inbound', author_name: 'Maria' })} />);
    expect(screen.queryByTestId('remetente-da-bolha')).not.toBeInTheDocument();
  });
});
```

> Assinatura medida: `export const MessageBubble: React.FC<{ message: ConversationMessage }>` (`MessageBubble.tsx:256`). `message` é a única prop.

- [ ] **Etapa 2: rodar e ver falhar**

Executar: `npx vitest run features/platform/tenants/conversations/messageBubbleRemetente.test.tsx`
Esperado: FALHA no primeiro caso — `Unable to find an element with the text: Vitoria`.

- [ ] **Etapa 3: acrescentar o rótulo**

Em `MessageBubble.tsx`, logo depois do bloco `{isInternal ? (...) : null}`:

```tsx
        {!isInternal && isOutbound && message.author_name ? (
          <div
            data-testid="remetente-da-bolha"
            className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700"
          >
            {message.author_name}
          </div>
        ) : null}
```

- [ ] **Etapa 4: rodar e ver passar**

Executar: `npx vitest run features/platform/tenants/conversations/messageBubbleRemetente.test.tsx`
Esperado: PASSA, 3 testes.

- [ ] **Etapa 5: comitar**

```bash
git add features/platform/tenants/conversations/MessageBubble.tsx features/platform/tenants/conversations/messageBubbleRemetente.test.tsx
git commit -m "feat(conversas): a bolha mostra quem respondeu"
```

---

## Tarefa 7: travar quem NUNCA assina

**Arquivos:**
- Teste: `test/fronteiraAssinatura.test.ts` (criar)

A IA, a cutucada, o lembrete de reunião, o executor de automação e o teste de envio da conexão não passam pela rota de envio manual — ficam de fora **por construção**. Este teste trava essa fronteira: se alguém importar a assinatura num desses arquivos, quebra e explica por quê.

- [ ] **Etapa 1: escrever o teste**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A assinatura do atendente vale SO para mensagem enviada por uma pessoa pela tela do CRM
 * (decisao do Junior, 25/09/2026: "so humano"). Estes caminhos mandam mensagem sem ninguem
 * no teclado — assinar ali poria um nome de gente numa mensagem automatica, e na IA
 * produziria "Aurora: Oi, aqui e a Aurora", porque o prompt dela ja se apresenta no texto.
 */

const NUNCA_ASSINAM = [
  ['a resposta da IA', 'lib/conversations/aiReply.ts'],
  ['a cutucada de inatividade', 'lib/conversations/idleNudge.ts'],
  ['o lembrete de reuniao', 'lib/conversations/meetingReminder.ts'],
  ['o executor de automacao', 'lib/automations/executor.ts'],
  ['o teste de envio da conexao', 'app/api/platform/tenants/[tenantId]/channels/[connectionId]/send-test/route.ts'],
] as const;

describe('fronteira da assinatura do atendente', () => {
  it.each(NUNCA_ASSINAM)('%s nao assina a mensagem', (_rotulo, caminho) => {
    const fonte = readFileSync(resolve(process.cwd(), caminho), 'utf8');
    expect(fonte).not.toContain('assinarMensagemDoAtendente');
    expect(fonte).not.toContain('signManualReplies');
  });

  it('a rota de envio manual e a UNICA que assina', () => {
    const rota = resolve(
      process.cwd(),
      'app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts',
    );
    expect(readFileSync(rota, 'utf8')).toContain('assinarMensagemDoAtendente');
  });
});
```

- [ ] **Etapa 2: rodar e ver passar**

Executar: `npx vitest run test/fronteiraAssinatura.test.ts`
Esperado: PASSA, 6 testes. Se algum caminho não existir, corrigir o caminho no array — **não** remover a linha.

- [ ] **Etapa 3: comitar**

```bash
git add test/fronteiraAssinatura.test.ts
git commit -m "test(atendimento): travar que so o envio manual assina"
```

---

## Fechamento

- [ ] **Etapa 1: rodar a suíte inteira, em comando separado**

Executar: `npx vitest run`
Esperado: tudo verde. **Ler o resultado antes de qualquer commit ou push** — nunca encadear `suite && commit`.

- [ ] **Etapa 2: conferir tipos**

Executar: `npx tsc --noEmit`
Esperado: sem erro.

- [ ] **Etapa 3: publicar na prévia (não em produção)**

```bash
git push origin feat/aurora-implantacao
```

Depois conferir qual banco a prévia usa **pelo pedido de login real** (abrir `/login`, tentar entrar com credencial inválida e ler o host de `/auth/v1/token`) — nunca por grep do JS servido.

---

## Critério de pronto (o que o Junior vai ver)

1. Na tela do número da recepção, existe o interruptor **"Assinar com o nome de quem atende"**, desligado.
2. Com ele **desligado**, responder pela tela sai exatamente como hoje — sem nome na frente.
3. Ligando, a Vitória responde pela tela e o lead recebe **"Vitoria: ..."**. O nome vem do apelido dela no perfil.
4. A Julia/Aurora continua respondendo igual, sem nome na frente.
5. Um clique em **"Assumir atendimento"** muda o status para "Humano atendendo" e põe quem clicou como responsável.
6. Na conversa, cada mensagem enviada mostra quem a enviou.

---

## Limites conhecidos (fora deste plano)

- **Resposta pelo celular não é assinada.** Quem responde pelo aparelho, e não pela tela, escapa de tudo isso — o CRM só recebe o eco pelo webhook, depois de a mensagem já ter saído. A chave `manualReplyPausesAI` já pausa a IA nesse caso, mas o nome não tem como entrar. Isso reforça que o fluxo certo é responder pela tela.
- **O prefixo é somado depois da validação de tamanho.** `MessageSchema` limita `content` a 4000 caracteres e o nome entra depois, então o texto entregue pode chegar a ~4000 + 82 (80 do nome + `": "`). O WhatsApp aceita 4096 por mensagem, então cabe — mas é margem, não folga. Se o limite do schema subir algum dia, a conta tem que subir junto.
- **A Meta não tem identificação de remetente por agente.** Qualquer prefixo é texto literal na mensagem — decisão de produto, não recurso de plataforma. Nem o Kommo nem o GoHighLevel fazem isso hoje (o GoHighLevel tem pedido de funcionalidade aberto e não atendido).
- **Duração configurável da reunião** e o **defeito latente da agenda** (`activities` guarda só o início; o conflito é uma janela fixa de 60 min duplicada em TypeScript e em SQL) ficam para uma SPEC própria. Sem guardar o fim, duração variável sobrepõe reunião em silêncio.
- **O agente por funil** (`boards.agent_name`, `agent_role`, `agent_behavior`, `default_product_id` — modelado e povoado em 3 clientes, não lido pelo atendimento de WhatsApp) também fica para SPEC própria. É o lugar natural da duração e da identidade do agente.
