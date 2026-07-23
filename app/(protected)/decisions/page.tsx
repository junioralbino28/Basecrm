import { redirect } from 'next/navigation'

/**
 * QUARENTENA (parecer do pente fino, 2026-07-23 — §3.3/§4.5):
 * o módulo decisions persiste em localStorage sem tenant e a UI dispara
 * mutações reais sem aguardar o resultado, podendo marcar falha como
 * aprovada. A rota fica fora do ar até existir uma central de ações
 * server-side tenantizada. O código em features/decisions/ está preservado
 * como referência de UX/analisadores.
 */
export default function Decisions() {
    redirect('/visao-geral')
}
