import { expect, test, create, send } from './helpers';

for (const provider of ['exa', 'parallel']) {
  test(`${provider}: поиск показывает провайдера и источник и переживает reload`, async ({ page }) => {
    const chat = await create(page, `search-${provider}`);
    await send(page, 'Найди документацию Node.js');
    await page.getByTestId('conversation').getByRole('button', { name: 'Node.js', exact: true }).click();
    const linkPreview = page.locator('[data-streamdown="link-safety-modal"]');
    await expect(linkPreview).toContainText('https://nodejs.org/');
    await linkPreview.getByRole('button', { name: 'Close', exact: true }).click();
    const card = page.getByRole('button', { name: 'Поиск в интернете Готово', exact: true });
    await card.click();
    await expect(page.getByTestId('conversation')).toContainText('Official documentation');
    const saved = await (await page.request.get(`/api/chats/${chat.id}`)).json();
    expect(saved.todos).toEqual([]);
    expect(saved.messages.flatMap((m: { tools: unknown[] }) => m.tools)).toMatchObject([
      { name: 'web_search', state: 'completed', output: { provider, query: 'Node.js documentation' } },
    ]);
    await expect(page).toHaveTitle('Crewbus');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/crewbus-web-search-${provider}.png` });
    await page.reload();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId('conversation')).toContainText('Official documentation');
    if (provider === 'exa') {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
      await expect(card).toBeVisible();
      await page.screenshot({ path: '/tmp/crewbus-web-search-mobile.png' });
    }
  });
}

test('ошибка MCP видна в карточке и не выдаётся за успешный поиск', async ({ page }) => {
  const chat = await create(page, 'search-error');
  await send(page, 'Найди документацию Node.js');
  await expect(page.getByTestId('conversation').getByText('Поиск недоступен', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Поиск в интернете Ошибка', exact: true }).click();
  await expect(page.getByTestId('conversation')).toContainText('Tool execution failed');
  const saved = await (await page.request.get(`/api/chats/${chat.id}`)).json();
  expect(saved.messages.flatMap((m: { tools: unknown[] }) => m.tools)).toMatchObject([
    { name: 'web_search', state: 'failed', output: null },
  ]);
  expect(saved.todos).toEqual([]);
});
