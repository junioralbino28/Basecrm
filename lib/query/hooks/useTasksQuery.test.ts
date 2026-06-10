import { describe, it, expect } from 'vitest';
import { queryKeys } from '../queryKeys';
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask } from './useTasksQuery';

describe('tasks query layer (N2)', () => {
  it('registra queryKeys de tasks', () => {
    expect(queryKeys.tasks.all).toEqual(['tasks']);
    expect(queryKeys.tasks.lists()).toEqual(['tasks', 'list']);
  });

  it('exporta os hooks de tarefas', () => {
    expect(typeof useTasks).toBe('function');
    expect(typeof useCreateTask).toBe('function');
    expect(typeof useUpdateTask).toBe('function');
    expect(typeof useDeleteTask).toBe('function');
  });
});
