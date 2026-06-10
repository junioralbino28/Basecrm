import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface WeeklyRevenueBarsProps {
  /** Semanas do período: label curta ("sem 1") + faturamento + nº de atendimentos. */
  data: Array<{ semana: string; faturamento: number; atendimentos: number }>;
}

const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Barras "recebido por semana" (mockup Financeiro): só conta o que foi PAGO.
 * Tooltip mostra R$ + nº de atendimentos da semana.
 */
export const WeeklyRevenueBars: React.FC<WeeklyRevenueBarsProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Sem dados
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="semana"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
          dy={8}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
          tickFormatter={(value) => `R$${Number(value) / 1000}k`}
        />
        <Tooltip
          cursor={{ fill: 'rgba(26, 155, 130, 0.08)' }}
          formatter={(value: number | string, _name, item) => {
            const atendimentos = (item?.payload as { atendimentos?: number })?.atendimentos ?? 0;
            return [`${formatBRL(Number(value))} · ${atendimentos} atendimentos`, 'Recebido'];
          }}
          contentStyle={{
            backgroundColor: 'var(--chart-tooltip-bg)',
            border: '1px solid var(--chart-tooltip-border)',
            borderRadius: '12px',
            color: 'var(--chart-tooltip-text)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          labelStyle={{ color: 'var(--chart-text)' }}
        />
        <Bar dataKey="faturamento" fill="#0e7d69" radius={[10, 10, 0, 0]} maxBarSize={72} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default WeeklyRevenueBars;
