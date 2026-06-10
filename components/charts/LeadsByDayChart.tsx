import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface LeadsByDayChartProps {
  /** Leads por dia: label 'DD/MM' + contagem. */
  data: Array<{ dia: string; leads: number }>;
}

/**
 * Área "Leads por dia" (mockup Visão Geral, N5) — paleta brand do mockup.
 */
export const LeadsByDayChart: React.FC<LeadsByDayChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Sem dados
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a9b82" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#1a9b82" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="dia"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
          dy={8}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
        />
        <Tooltip
          formatter={(value: number | string) => [`${value} leads`, 'Leads']}
          contentStyle={{
            backgroundColor: 'var(--chart-tooltip-bg)',
            border: '1px solid var(--chart-tooltip-border)',
            borderRadius: '12px',
            color: 'var(--chart-tooltip-text)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          labelStyle={{ color: 'var(--chart-text)' }}
        />
        <Area
          type="monotone"
          dataKey="leads"
          stroke="#0e7d69"
          strokeWidth={2.5}
          fillOpacity={1}
          fill="url(#leadsFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default LeadsByDayChart;
