// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type RangeCall = {
  table: string;
  from: number;
  to: number;
  orders: Array<{ column: string; ascending: boolean }>;
};

const datasets: Record<string, Row[]> = {
  specialty_products: [],
  professional_product_overrides: [],
};
const rangeCalls: RangeCall[] = [];

const fromMock = vi.fn((table: string) => {
  const orders: RangeCall['orders'] = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn((column: string, options?: { ascending?: boolean }) => {
      orders.push({ column, ascending: options?.ascending !== false });
      return query;
    }),
    range: vi.fn(async (from: number, to: number) => {
      rangeCalls.push({ table, from, to, orders: [...orders] });
      return { data: datasets[table]?.slice(from, to + 1) ?? [], error: null };
    }),
  };
  return query;
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: (...args: [string]) => fromMock(...args) },
}));

import {
  professionalProductsService,
  specialtyProductsService,
} from '@/lib/supabase/specialtyProducts';

describe('specialtyProductsService — paginação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rangeCalls.length = 0;
    datasets.specialty_products = [];
    datasets.professional_product_overrides = [];
  });

  it('carrega 1.001 vínculos em páginas determinísticas sem perda ou duplicata', async () => {
    datasets.specialty_products = Array.from({ length: 1_001 }, (_, index) => ({
      specialty_id: `specialty-${String(Math.floor(index / 250)).padStart(2, '0')}`,
      product_id: `product-${String(index).padStart(4, '0')}`,
    }));

    const result = await specialtyProductsService.list('org-1');

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1_001);
    expect(new Set(result.data.map((link) => `${link.specialtyId}:${link.productId}`)).size)
      .toBe(1_001);
    expect(rangeCalls).toEqual([
      {
        table: 'specialty_products',
        from: 0,
        to: 999,
        orders: [
          { column: 'specialty_id', ascending: true },
          { column: 'product_id', ascending: true },
        ],
      },
      {
        table: 'specialty_products',
        from: 1_000,
        to: 1_999,
        orders: [
          { column: 'specialty_id', ascending: true },
          { column: 'product_id', ascending: true },
        ],
      },
    ]);
  });

  it('carrega 1.001 exceções em páginas determinísticas sem perda ou duplicata', async () => {
    datasets.professional_product_overrides = Array.from({ length: 1_001 }, (_, index) => ({
      product_id: `product-${String(index).padStart(4, '0')}`,
      enabled: index % 2 === 0,
    }));

    const result = await professionalProductsService.listOverrides('professional-1', 'org-1');

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1_001);
    expect(new Set(result.data.map((override) => override.productId)).size).toBe(1_001);
    expect(rangeCalls).toEqual([
      {
        table: 'professional_product_overrides',
        from: 0,
        to: 999,
        orders: [{ column: 'product_id', ascending: true }],
      },
      {
        table: 'professional_product_overrides',
        from: 1_000,
        to: 1_999,
        orders: [{ column: 'product_id', ascending: true }],
      },
    ]);
  });
});
