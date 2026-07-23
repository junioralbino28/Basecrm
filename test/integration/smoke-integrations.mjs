/**
 * Smoke E2E da Public API (+ webhook opcional) — RESGATADO do histórico
 * (`3c99d29`, removido em `dfb7c19`) por decisão do parecer do pente fino
 * (2026-07-23): a suíte atual não cobre este percurso ponta a ponta.
 *
 * ⚠️ LOCAL-ONLY. Este smoke MUTA dados (contatos, negócios, atividades).
 * A trava abaixo recusa qualquer alvo fora de loopback e qualquer referência
 * ao projeto de produção. Não remover a trava.
 *
 * Uso:
 *   BASE_URL=http://localhost:3000 API_KEY="ncrm_..." npm run smoke:integrations
 *
 * Webhook opcional (Supabase LOCAL):
 *   WEBHOOK_URL="http://127.0.0.1:54321/functions/v1/webhook-in/<source_id>" WEBHOOK_SECRET="<secret>"
 */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = val;
  }
  return out;
}

function must(v, name) {
  if (!v) throw new Error(`Missing ${name}. Provide via env or CLI.`);
  return v;
}

function joinUrl(base, path) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

async function readJsonSafe(res) {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function httpJson({ baseUrl, apiKey, method, path, body }) {
  const url = joinUrl(baseUrl, path);
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await readJsonSafe(res);
  if (!res.ok) {
    const msg = json?.error || json?.message || res.statusText || 'Request failed';
    throw new Error(`${method} ${path} -> ${res.status} ${msg}\n${JSON.stringify(json, null, 2)}`);
  }
  return json;
}

async function step(title, fn) {
  process.stdout.write(`- ${title}... `);
  try {
    const out = await fn();
    console.log('OK');
    return out;
  } catch (e) {
    console.log('FAIL');
    throw e;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = (args['base-url'] || process.env.BASE_URL || '').trim();
  const apiKey = (args['api-key'] || process.env.API_KEY || '').trim();
  const webhookUrl = (args['webhook-url'] || process.env.WEBHOOK_URL || '').trim();
  const webhookSecret = (args['webhook-secret'] || process.env.WEBHOOK_SECRET || '').trim();

  must(baseUrl, 'BASE_URL/--base-url');
  must(apiKey, 'API_KEY/--api-key');

  // ==========================================================================
  // TRAVA ANTI-PRODUÇÃO (não remover — parecer do pente fino, 2026-07-23)
  // ==========================================================================
  const PROD_PROJECT_REF = 'eqidsihasmwwamkaqfka';
  const assertLocalOnly = (label, value) => {
    let host = '';
    try {
      host = new URL(value).hostname;
    } catch {
      throw new Error(`${label} inválida: ${value}`);
    }
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLoopback) {
      throw new Error(`${label} precisa ser loopback (localhost/127.0.0.1). Recebido: ${host}. Este smoke MUTA dados e não roda fora do ambiente local.`);
    }
    if (value.includes(PROD_PROJECT_REF)) {
      throw new Error(`${label} referencia o projeto de PRODUÇÃO — abortado.`);
    }
  };
  assertLocalOnly('BASE_URL', baseUrl);
  if (webhookUrl) assertLocalOnly('WEBHOOK_URL', webhookUrl);

  const runId = `smoke-${Date.now()}`;
  const uniqueEmail = `smoke+${Date.now()}@exemplo.com`;
  const uniquePhone = `+5511${String(Math.floor(100000000 + Math.random() * 900000000))}`; // E.164-ish

  console.log(`\nSmoke test (${runId})`);
  console.log(`Base: ${baseUrl}`);

  await step('GET /api/public/v1/openapi.json', () => httpJson({ baseUrl, apiKey, method: 'GET', path: '/api/public/v1/openapi.json' }));
  await step('GET /api/public/v1/me', () => httpJson({ baseUrl, apiKey, method: 'GET', path: '/api/public/v1/me' }));

  const boards = await step('GET /api/public/v1/boards', async () => {
    const res = await httpJson({ baseUrl, apiKey, method: 'GET', path: '/api/public/v1/boards?limit=50' });
    if (!Array.isArray(res?.data) || res.data.length === 0) throw new Error('No boards found. Create at least one board.');
    return res.data;
  });

  const board = boards.find((b) => b?.key) || boards[0];
  const boardKeyOrId = board.key || board.id;
  if (!boardKeyOrId) throw new Error('Board missing id/key.');
  console.log(`  Using board: ${board.name} (${board.key || board.id})`);

  const stagesRes = await step('GET /api/public/v1/boards/{board}/stages', () =>
    httpJson({ baseUrl, apiKey, method: 'GET', path: `/api/public/v1/boards/${encodeURIComponent(boardKeyOrId)}/stages` })
  );
  const stages = Array.isArray(stagesRes?.data) ? stagesRes.data : [];
  if (stages.length === 0) throw new Error('No stages found for selected board.');
  const toStage = stages[1] || stages[0];
  if (!toStage?.label && !toStage?.name) throw new Error('Stage missing label/name.');
  const toStageLabel = toStage.label || toStage.name;
  console.log(`  Using stage label: ${toStageLabel}`);

  const contactRes = await step('POST /api/public/v1/contacts (create)', () =>
    httpJson({
      baseUrl,
      apiKey,
      method: 'POST',
      path: '/api/public/v1/contacts',
      body: {
        name: 'Lead Smoke',
        email: uniqueEmail,
        phone: uniquePhone,
        source: 'smoke',
        role: 'Gerente',
        company_name: `Empresa Smoke ${runId}`,
        notes: `Criado pelo smoke test (${runId}).`,
      },
    })
  );
  const contactId = contactRes?.data?.id;
  if (!contactId) throw new Error('Contact creation did not return data.id');

  await step('GET /api/public/v1/contacts?email=...', () =>
    httpJson({ baseUrl, apiKey, method: 'GET', path: `/api/public/v1/contacts?email=${encodeURIComponent(uniqueEmail)}&limit=5` })
  );

  const companyRes = await step('POST /api/public/v1/companies (upsert)', () =>
    httpJson({
      baseUrl,
      apiKey,
      method: 'POST',
      path: '/api/public/v1/companies',
      body: { name: `Empresa Smoke ${runId}`, website: `https://empresa-smoke-${Date.now()}.exemplo.com`, industry: 'Test' },
    })
  );
  const companyId = companyRes?.data?.id || null;

  const dealRes = await step('POST /api/public/v1/deals (create)', () =>
    httpJson({
      baseUrl,
      apiKey,
      method: 'POST',
      path: '/api/public/v1/deals',
      body: {
        title: `Deal Smoke ${runId}`,
        value: 0,
        board_key: board.key || undefined,
        board_id: !board.key ? board.id : undefined,
        contact_id: contactId,
        client_company_id: companyId || undefined,
      },
    })
  );
  const dealId = dealRes?.data?.id;
  if (!dealId) throw new Error('Deal creation did not return data.id');

  await step('GET /api/public/v1/deals?status=open', () =>
    httpJson({ baseUrl, apiKey, method: 'GET', path: `/api/public/v1/deals?status=open&limit=10` })
  );
  await step('GET /api/public/v1/deals/{dealId}', () => httpJson({ baseUrl, apiKey, method: 'GET', path: `/api/public/v1/deals/${dealId}` }));

  await step('POST /api/public/v1/deals/{dealId}/move-stage (by id)', () =>
    httpJson({
      baseUrl,
      apiKey,
      method: 'POST',
      path: `/api/public/v1/deals/${dealId}/move-stage`,
      body: { to_stage_label: toStageLabel },
    })
  );

  await step('POST /api/public/v1/deals/move-stage (by identity)', () =>
    httpJson({
      baseUrl,
      apiKey,
      method: 'POST',
      path: `/api/public/v1/deals/move-stage`,
      body: { board_key_or_id: String(boardKeyOrId), phone: uniquePhone, to_stage_label: toStageLabel },
    })
  );

  await step('POST /api/public/v1/activities (create)', () =>
    httpJson({
      baseUrl,
      apiKey,
      method: 'POST',
      path: '/api/public/v1/activities',
      body: {
        type: 'NOTE',
        title: `Nota Smoke ${runId}`,
        description: 'Criada pelo smoke test',
        deal_id: dealId,
        contact_id: contactId,
        client_company_id: companyId || undefined,
      },
    })
  );

  await step('GET /api/public/v1/activities?deal_id=...', () =>
    httpJson({ baseUrl, apiKey, method: 'GET', path: `/api/public/v1/activities?deal_id=${encodeURIComponent(dealId)}&limit=5` })
  );

  // Optional webhook test (inbound)
  if (webhookUrl && webhookSecret) {
    await step('POST webhook-in (optional)', async () => {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
          Authorization: `Bearer ${webhookSecret}`,
        },
        body: JSON.stringify({
          external_event_id: runId,
          contact_name: 'Lead Smoke (Webhook)',
          email: uniqueEmail,
          phone: uniquePhone,
          source: 'smoke-webhook',
          deal_title: `Deal Webhook ${runId}`,
          deal_value: 0,
          company_name: `Empresa Webhook ${runId}`,
        }),
      });
      const json = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || json?.message || res.statusText || 'Webhook failed';
        throw new Error(`WEBHOOK -> ${res.status} ${msg}\n${JSON.stringify(json, null, 2)}`);
      }
      return json;
    });
  } else {
    console.log('- POST webhook-in (optional)... SKIP (provide WEBHOOK_URL + WEBHOOK_SECRET)');
  }

  console.log('\nAll good ✅');
  console.log('Tip: if something fails, re-run with the same BASE_URL/API_KEY and inspect the error JSON above.');
}

main().catch((e) => {
  console.error('\nSmoke test failed.');
  console.error(String(e?.stack || e?.message || e));
  process.exit(1);
});

