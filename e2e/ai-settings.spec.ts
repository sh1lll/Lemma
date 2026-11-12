import { expect, test } from './helpers';

test('choose any provider and model; local servers are discovered', async ({ app }) => {
  await app.route('http://localhost:11434/v1/models', (r) => r.fulfill({ json: { object: 'list', data: [{ id: 'qwen3:8b' }, { id: 'llama3.2:3b' }] } }));
  await app.locator('#open-settings').click();
  await app.locator('input[name="aiEnabled"]').check();
  const provider = app.locator('#ai-provider');
  await expect(provider.locator('option')).toHaveCount(11);

  // Built-in model: no key, a one-time download, the two bundled choices.
  await expect(provider).toHaveValue('builtin');
  await expect(app.locator('.ai-key')).toBeHidden();
  // In a browser only the model that fits is offered (the 1.7B one needs the desktop app).
  await expect(app.locator('#ai-test')).toHaveText(/Download \(570 MB\)/);
  await expect(app.locator('#ai-models option')).toHaveCount(1);
  await expect(app.locator('#assistant-toggle')).toBeVisible();
  await expect(app.locator('#attach')).toBeVisible(); // photos are read on the device, so the camera works with any model

  // Ollama: server URL, no key, models listed from the running server. Address and models sit under "More".
  await provider.selectOption('ollama');
  await app.locator('#ai-more > summary').click();
  await expect(app.locator('.ai-base')).toBeVisible();
  await expect(app.locator('.ai-key')).toBeHidden();
  await app.locator('#ai-test').click();
  await expect(app.locator('#ai-status')).toContainText('2 models');
  await expect(app.locator('#ai-model')).toHaveValue('qwen3:8b');

  // A hosted provider needs its own key; keys are kept per provider.
  await provider.selectOption('gemini');
  await expect(app.locator('.ai-key')).toBeVisible();
  await expect(app.locator('#ai-hint a')).toHaveAttribute('href', /aistudio/);
  await expect(app.locator('#assistant-toggle')).toBeHidden();
  await app.locator('input[name="aiKey"]').fill('gemini-test-key-123');
  await expect(app.locator('#assistant-toggle')).toBeVisible();
  await provider.selectOption('anthropic');
  await expect(app.locator('input[name="aiKey"]')).toHaveValue('');
  await provider.selectOption('gemini');
  await expect(app.locator('input[name="aiKey"]')).toHaveValue('gemini-test-key-123');

  // Any model id can be typed.
  await app.locator('#ai-model').fill('gemini-2.5-pro');
  await app.keyboard.press('Escape');
  await app.reload();
  const saved = await app.evaluate(() => JSON.parse(localStorage.getItem('lemma.settings.v1')!));
  expect(saved.aiModels.gemini).toBe('gemini-2.5-pro');
  expect(saved.aiModels.ollama).toBe('qwen3:8b');
});
