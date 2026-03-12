import { test, expect } from '@playwright/test';

const tenantId = process.env.PLAYWRIGHT_TENANT_ID || 'bd43a9bc-5bab-410a-a5a6-c214f3836f0e';

test.describe('Tenant workspace navigation', () => {
  test('sidebar keeps working when the board selector dropdown is open', async ({ page }) => {
    await page.goto(`/platform/tenants/${tenantId}/boards`);

    if (page.url().includes('/login')) {
      test.skip(true, 'Faça login antes e salve o estado em playwright/.auth/user.json para rodar este fluxo autenticado.');
    }

    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${tenantId}/boards`));

    const boardSelectorButton = page.getByLabel(/Selecionar funil da clinica/i);
    await expect(boardSelectorButton).toBeVisible();
    await boardSelectorButton.click();

    const contactsLink = page.getByRole('link', { name: /Contatos/i }).first();
    await expect(contactsLink).toBeVisible();
    await contactsLink.click();

    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${tenantId}/contacts`));

    const settingsLink = page.getByRole('link', { name: /Configurações|Configuracoes/i }).first();
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${tenantId}/settings`));
  });
});
