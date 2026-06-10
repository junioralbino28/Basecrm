import { describe, it, expect } from 'vitest';
import { queryKeys } from '../queryKeys';
import {
  useProfessionals,
  useCreateProfessional,
  useUpdateProfessional,
  useDeleteProfessional,
} from './useProfessionalsQuery';

describe('professionals query layer', () => {
  it('registra queryKeys.professionals', () => {
    expect(queryKeys.professionals.all).toEqual(['professionals']);
    expect(queryKeys.professionals.lists()).toEqual(['professionals', 'list']);
  });

  it('exporta os hooks esperados', () => {
    expect(typeof useProfessionals).toBe('function');
    expect(typeof useCreateProfessional).toBe('function');
    expect(typeof useUpdateProfessional).toBe('function');
    expect(typeof useDeleteProfessional).toBe('function');
  });
});
