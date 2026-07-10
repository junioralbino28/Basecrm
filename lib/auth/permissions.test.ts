import { describe, it, expect } from 'vitest';
import {
  APP_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSION_DEFAULTS,
  getDefaultPermissionMap,
  resolvePermissionMap,
  hasPermission,
} from './permissions';

describe('taxonomia de permissões', () => {
  it('tem ~30 chaves em pelo menos 8 grupos', () => {
    expect(APP_PERMISSIONS.length).toBeGreaterThanOrEqual(28);
    const groups = new Set(PERMISSION_DEFINITIONS.map((d) => d.group));
    expect(groups.size).toBeGreaterThanOrEqual(8);
  });

  it('toda chave tem exatamente uma definição com label/description/group', () => {
    for (const key of APP_PERMISSIONS) {
      const defs = PERMISSION_DEFINITIONS.filter((d) => d.key === key);
      expect(defs.length, `definição de ${key}`).toBe(1);
      expect(defs[0].label.length).toBeGreaterThan(0);
      expect(defs[0].description.length).toBeGreaterThan(0);
      expect(defs[0].group.length).toBeGreaterThan(0);
    }
  });

  it('não tem definição órfã (toda definição aponta pra uma chave válida)', () => {
    const valid = new Set<string>(APP_PERMISSIONS);
    for (const def of PERMISSION_DEFINITIONS) {
      expect(valid.has(def.key), `chave órfã ${def.key}`).toBe(true);
    }
  });

  it('mantém as 5 chaves originais (retrocompat)', () => {
    for (const key of [
      'whatsapp.access',
      'whatsapp.manage_connection',
      'conversations.access',
      'conversations.reply',
      'settings.users.manage',
    ]) {
      expect(APP_PERMISSIONS as readonly string[]).toContain(key);
    }
  });
});

describe('ROLE_PERMISSION_DEFAULTS — completude e defaults', () => {
  const roles = ['agency_admin', 'agency_staff', 'clinic_admin', 'clinic_staff', 'admin', 'vendedor'];

  it('todo cargo tem um mapa COMPLETO (todas as chaves definidas)', () => {
    for (const role of roles) {
      const map = ROLE_PERMISSION_DEFAULTS[role];
      expect(map, `mapa do cargo ${role}`).toBeTruthy();
      for (const key of APP_PERMISSIONS) {
        expect(typeof map[key], `${role}.${key}`).toBe('boolean');
      }
    }
  });

  it('clinic_admin e agency_admin têm TUDO liberado', () => {
    for (const key of APP_PERMISSIONS) {
      expect(ROLE_PERMISSION_DEFAULTS.clinic_admin[key], `clinic_admin.${key}`).toBe(true);
      expect(ROLE_PERMISSION_DEFAULTS.agency_admin[key], `agency_admin.${key}`).toBe(true);
    }
  });
});

describe('clinic_staff (secretária) — operacional sim, sensível não', () => {
  const staff = getDefaultPermissionMap('clinic_staff');

  it('libera o operacional', () => {
    for (const key of [
      'dashboard.view',
      'overview.view',
      'contacts.view',
      'contacts.edit',
      'funnels.view',
      'funnels.move',
      'deals.manage',
      'conversations.access',
      'conversations.reply',
      'activities.manage',
      'tasks.manage',
      'call_list.access',
      'atendimentos.view',
      'atendimentos.manage',
      'agenda.manage',
      'ai.use',
    ] as const) {
      expect(staff[key], `staff deveria ter ${key}`).toBe(true);
    }
  });

  it('bloqueia o sensível', () => {
    for (const key of [
      'contacts.delete',
      'contacts.import_export',
      'funnels.manage',
      'whatsapp.access',
      'whatsapp.manage_connection',
      'reports.finance',
      'reports.professionals',
      'ai.configure',
      'settings.general',
      'settings.products',
      'settings.professionals',
      'settings.finance',
      'settings.integrations',
      'settings.audit',
      'settings.users.manage',
    ] as const) {
      expect(staff[key], `staff NÃO deveria ter ${key}`).toBe(false);
    }
  });

  it("'vendedor' (legado) resolve igual a clinic_staff", () => {
    expect(getDefaultPermissionMap('vendedor')['settings.finance']).toBe(false);
    expect(getDefaultPermissionMap('vendedor')['atendimentos.manage']).toBe(true);
  });
});

describe('overrides e hasPermission continuam funcionando com chaves novas', () => {
  it('override liga uma permissão sensível pontualmente', () => {
    const map = resolvePermissionMap('clinic_staff', { 'settings.finance': true });
    expect(map['settings.finance']).toBe(true);
    // sem override, o resto segue o default do cargo
    expect(map['settings.users.manage']).toBe(false);
  });

  it('hasPermission reflete override e default', () => {
    expect(hasPermission('clinic_staff', 'reports.finance')).toBe(false);
    expect(hasPermission('clinic_staff', 'reports.finance', { 'reports.finance': true })).toBe(true);
    expect(hasPermission('clinic_admin', 'settings.finance')).toBe(true);
  });
});
