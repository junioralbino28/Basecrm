// Camada de query do nudge de tarefas (N3) — smoke de keys + exports
// (espelha useTasksQuery.test.ts) + domínio do schema zod do intervalo.
import { describe, it, expect } from 'vitest';
import { queryKeys } from '../queryKeys';
import {
  useTaskNudgeInterval,
  useUpdateTaskNudgeInterval,
} from './useOrganizationSettingsQuery';
import { taskNudgeIntervalSchema } from '@/lib/validations/schemas';

describe('organization settings query layer (N3 — nudge)', () => {
  it('registra queryKeys de organizationSettings', () => {
    expect(queryKeys.organizationSettings.all).toEqual(['organizationSettings']);
    expect(queryKeys.organizationSettings.lists()).toEqual(['organizationSettings', 'list']);
  });

  it('exporta os hooks do intervalo do nudge', () => {
    expect(typeof useTaskNudgeInterval).toBe('function');
    expect(typeof useUpdateTaskNudgeInterval).toBe('function');
  });

  it('schema do intervalo aceita só null/15/30/60 (espelha o CHECK do banco)', () => {
    expect(taskNudgeIntervalSchema.parse('15')).toBe(15);
    expect(taskNudgeIntervalSchema.parse('30')).toBe(30);
    expect(taskNudgeIntervalSchema.parse('60')).toBe(60);
    expect(taskNudgeIntervalSchema.parse('')).toBeNull();
    expect(taskNudgeIntervalSchema.safeParse('45').success).toBe(false);
    expect(taskNudgeIntervalSchema.safeParse('abc').success).toBe(false);
  });
});
