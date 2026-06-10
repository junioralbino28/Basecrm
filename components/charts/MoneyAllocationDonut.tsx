import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface MoneyAllocationDonutProps {
  /** Fatias do donut "pra onde vai o dinheiro" (buildMoneyAllocation). */
  data: Array<{ key: string; name: string; value: number; percent: number; color: string }>;
}

const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Donut "pra onde vai o dinheiro" (mockup Financeiro): sobra · contas fixas ·
 * comissões · taxas de cartão, com tooltip em R$.
 */
export const MoneyAllocationDonut: React.FC<MoneyAllocationDonutProps> = ({ data }) => {
  const visible = data.filter((segment) => segment.value > 0);

  if (visible.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Sem dados
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={visible}
          dataKey="value"
          nameKey="name"
          innerRadius="62%"
          outerRadius="88%"
          paddingAngle={2}
          stroke="none"
        >
          {visible.map((segment) => (
            <Cell key={segment.key} fill={segment.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number | string, name: string) => [formatBRL(Number(value)), name]}
          contentStyle={{
            backgroundColor: 'var(--chart-tooltip-bg)',
            border: '1px solid var(--chart-tooltip-border)',
            borderRadius: '12px',
            color: 'var(--chart-tooltip-text)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          itemStyle={{ color: 'var(--chart-tooltip-text)' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default MoneyAllocationDonut;
