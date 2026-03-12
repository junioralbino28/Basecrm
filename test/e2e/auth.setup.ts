import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authDir = path.join(process.cwd(), 'playwright', '.auth');
const authStatePath = path.join(authDir, 'user.json');

setup('authenticate and persist session', async ({ page }) => {
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (!email || !password) {
    test.skip(true, 'Defina PLAYWRIGHT_EMAIL e PLAYWRIGHT_PASSWORD para gerar o storageState autenticado.');
  }

  fs.mkdirSync(authDir, { recursive: true });

  await page.goto('/login');

  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Senha').fill(password!);
  await page.getByRole('button', { name: /Entrar/i }).click();

  await expect(page).not.toHaveURL(/\/login$/);
  await page.context().storageState({ path: authStatePath });
});
