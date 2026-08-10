import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Deal } from '@/types';
import {
  buildFinanceKpiGrid,
  generateFinanceReportPDF,
  generateReportPDF,
} from './generateReportPDF';

// Regressão do achado High 5 (deps): jspdf <=4.2.0 tem CVE CRÍTICO (Path Traversal /
// LFI + PDF Injection com execução de JS + DoS). O relatório é gerado no browser do
// usuário, então:
//   (1) a versão instalada TEM que ser >= 4.2.1 (guarda contra downgrade acidental);
//   (2) o bump MAJOR (v3 -> v4) NÃO pode ter quebrado a geração do PDF — provamos
//       rodando a função inteira com strings hostis e conferindo que não lança.

function parseVersion(v: string) {
  const [major, minor, patch] = v.split('.').map((p) => parseInt(p, 10));
  return { major, minor, patch };
}

const adversarialData = {
  pipelineValue: 1_250_000,
  actualWinRate: 42.5,
  avgSalesCycle: 18,
  fastestDeal: 3,
  wonRevenue: 380_000,
  wonDeals: [
    { owner: { name: '"><img src=x onerror=alert(1)>' }, value: 120_000 } as unknown as Deal,
    { owner: { name: '../../../../etc/passwd' }, value: 90_000 } as unknown as Deal,
  ],
  changes: { pipeline: 12.3, winRate: -4.1, revenue: 8.8 },
  funnelData: [
    { name: '<b>Lead</b>', count: 12 },
    { name: 'javascript:alert(1)', count: 7 },
    { name: 'Ganho', count: 3 },
  ],
};

describe('generateReportPDF — hardening de deps (H5)', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let createUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    // happy-dom pode não implementar as duas — garante presença antes de espionar.
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    }
    createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('usa jspdf >= 4.2.1 (CVE crítico corrigido)', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'node_modules/jspdf/package.json'), 'utf8'),
    ) as { version: string };
    const { major, minor, patch } = parseVersion(pkg.version);
    const atLeast421 =
      major > 4 || (major === 4 && (minor > 2 || (minor === 2 && patch >= 1)));
    expect(atLeast421, `jspdf instalado = ${pkg.version}, exige >= 4.2.1`).toBe(true);
  });

  it('gera o PDF sem lançar mesmo com strings adversariais (bump MAJOR não quebrou)', async () => {
    await expect(
      generateReportPDF(
        adversarialData,
        'last_30_days',
        '../../../../etc/passwd',
        '<script>alert(1)</script>',
      ),
    ).resolves.toBeUndefined();

    expect(createUrlSpy).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('blob:mock', '_blank');
  });

  it('relatório financeiro imprime salário fixo e recompõe o líquido com essa dedução', async () => {
    await generateFinanceReportPDF(
      {
        faturamento: 0,
        taxas: 0,
        comissoes: 0,
        contasFixas: 0,
        salariosFixos: 2500,
        // Valor propositalmente inconsistente: o PDF deve ignorá-lo e recomputar -2500.
        liquido: 999999,
        totalAtendimentos: 0,
        porMes: [],
        porSemana: [],
      },
      'this_month'
    );

    const pdfBlob = createUrlSpy.mock.calls.at(-1)?.[0] as Blob;
    const pdfText = new TextDecoder('latin1').decode(await pdfBlob.arrayBuffer());

    expect(pdfText).toContain('Salários fixos');
    expect(pdfText.match(/2\.500,00/g)).toHaveLength(2);
  });

  it('distribui os 6 KPIs financeiros em grade 3×2 com largura segura', () => {
    const grid = buildFinanceKpiGrid(180, 6);

    expect(grid.columns).toBe(3);
    expect(grid.rows).toBe(2);
    expect(grid.cardWidth).toBeGreaterThan(55);
    expect(grid.positions.map(({ row, column }) => [row, column])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    expect(grid.positions[2].x + grid.cardWidth).toBeLessThanOrEqual(180);
    expect(grid.positions[3].y).toBeGreaterThanOrEqual(grid.cardHeight + grid.gap);
    expect(grid.totalHeight).toBe(grid.cardHeight * 2 + grid.gap);
  });
});
