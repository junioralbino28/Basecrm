import { describe, it, expect } from 'vitest';
import { queryKeys } from '../queryKeys';
import {
  useLeadSources,
  useCreateLeadSource,
  useUpdateLeadSource,
  useDeleteLeadSource,
} from './useLeadSourcesQuery';

describe('lead sources query layer (N1)', () => {
  it('registra queryKeys de leadSources', () => {
    expect(queryKeys.leadSources.all).toEqual(['leadSources']);
    expect(queryKeys.leadSources.lists()).toEqual(['leadSources', 'list']);
  });

  it('exporta os hooks de origens de lead', () => {
    expect(typeof useLeadSources).toBe('function');
    expect(typeof useCreateLeadSource).toBe('function');
    expect(typeof useUpdateLeadSource).toBe('function');
    expect(typeof useDeleteLeadSource).toBe('function');
  });
});
