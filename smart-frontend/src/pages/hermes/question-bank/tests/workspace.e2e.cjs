// Run against hermes.tests.serve_workspace; all API calls are isolated test data.
// 跨平台解析 playwright：默认走 devDependency 安装，可用 HERMES_E2E_PLAYWRIGHT
// 指向任意 playwright 模块路径（兼容旧缓存目录）。
const requirePlaywright = () => {
  try {
    return require('playwright');
  } catch (error) {
    if (!process.env.HERMES_E2E_PLAYWRIGHT) throw error;
    return require(process.env.HERMES_E2E_PLAYWRIGHT);
  }
};
const { chromium } = requirePlaywright();
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

(async () => {
  const artifacts = path.resolve(__dirname, '../../.artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  // 浏览器默认用 playwright 自带 Chromium；HERMES_E2E_CHROME 可指定本机 Chrome。
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.HERMES_E2E_CHROME
      ? { executablePath: process.env.HERMES_E2E_CHROME }
      : {}),
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let imports = 0;
    const chatRequests = [];
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname === '/api/currentUser' ||
        url.pathname.startsWith('/api/hermes/')
      ) {
        if (url.pathname.endsWith('/question-banks/import')) imports += 1;
        if (url.pathname.endsWith('/chat/completions'))
          chatRequests.push(route.request().postDataJSON());
        return route.continue({
          url: `http://127.0.0.1:6061${url.pathname}${url.search}`,
        });
      }
      return route.fulfill({
        json: url.pathname.startsWith('/api/chujuanji/') ? [] : { data: [] },
      });
    });
    const frontendUrl =
      process.env.HERMES_TEST_FRONTEND_URL || 'http://localhost:8002';
    await page.goto(`${frontendUrl}/hermes`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    const sender = page.getByPlaceholder(
      '输入消息，按 Enter 发送，Shift + Enter 换行...',
    );
    await sender.waitFor();
    assert.equal(
      await page.getByRole('button', { name: '返回完整对话' }).count(),
      0,
    );
    await page.getByText('智能组卷', { exact: true }).click();
    const generate = page.getByRole('button', { name: /生成试卷/ });
    await generate.waitFor();
    const quantity = page.getByRole('slider').first();
    await quantity.press('Home');
    await quantity.press('ArrowRight');
    assert.equal(
      chatRequests.length,
      0,
      'editing the form must not start a request',
    );
    await generate.click();
    const openBank = page.getByRole('button', {
      name: '查看题目',
      exact: true,
    });
    await openBank.waitFor({ timeout: 20000 }).catch(async (error) => {
      await page.screenshot({
        path: path.join(artifacts, 'workspace-failure.png'),
        fullPage: true,
      });
      console.error(
        JSON.stringify({
          pageErrors: errors,
          text: await page.locator('body').textContent(),
        }),
      );
      throw error;
    });
    assert.equal(chatRequests.length, 1);
    assert.equal(chatRequests[0].task, 'question_bank');
    assert.equal(chatRequests[0].paper_config.quantity, 2);
    const summary = await page
      .locator('[data-user-message-text]')
      .first()
      .textContent();
    assert(summary.includes('总题数：2 题'));
    assert(
      !summary.includes('question-bank') &&
        !summary.includes('实际执行与文件发布'),
    );
    assert.equal(
      await page
        .locator('.ant-bubble-start .x-markdown')
        .textContent()
        .then((t) => t?.includes('"url"')),
      false,
    );
    await sender.fill('请解释第2题');
    await sender.press('Enter');
    await page.getByText('普通回答：请解释第2题', { exact: true }).waitFor();
    assert.equal(chatRequests[1].task, 'chat');
    assert(!chatRequests[1].paper_config);
    assert.equal(
      chatRequests[1].messages.length,
      3,
      'followup must append to the original exchange',
    );
    const regenerate = page
      .locator('.ant-bubble-start .ant-actions-item:has(.anticon-sync)')
      .first();
    await regenerate.waitFor();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes('/api/hermes/v1/chat/completions'),
      ),
      regenerate.click(),
    ]);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '.ant-bubble-start .ant-actions-item .anticon-sync',
        ).length === 2,
    );
    assert.equal(chatRequests[2].task, 'question_bank');
    assert.deepEqual(
      chatRequests[2].paper_config,
      chatRequests[0].paper_config,
    );
    assert.equal(
      chatRequests[2].messages.length,
      1,
      'retry must exclude later followups',
    );
    await page.getByText('新建对话', { exact: true }).click();
    await sender.fill('你好，普通对话');
    await sender.press('Enter');
    await page.getByText('普通回答：你好，普通对话', { exact: true }).waitFor();
    assert.equal(chatRequests[3].task, 'chat');
    assert(!chatRequests[3].paper_config);
    assert.deepEqual(chatRequests[3].messages, [
      { role: 'user', content: '你好，普通对话' },
    ]);
    const forwarded = await (
      await page.request.get('http://127.0.0.1:6061/tests/upstream-requests')
    ).json();
    assert(forwarded[0].messages[0].role === 'system');
    assert(forwarded[0].messages.at(-1).content.includes('总题数严格为 2 题'));
    assert(forwarded[1].messages.every((item) => item.role !== 'system'));
    assert(forwarded[3].messages.every((item) => item.role !== 'system'));
    assert(
      forwarded.every(
        (request) => !('task' in request) && !('paper_config' in request),
      ),
    );
    await page
      .getByText('智能组卷 · 数学 · 初中一年级', { exact: true })
      .click();
    await openBank.waitFor();
    assert(
      await page
        .getByText('普通回答：请解释第2题', { exact: true })
        .isVisible(),
    );
    await sender.fill('保留这段未发送草稿');
    const originalEditor = await sender.elementHandle();
    await openBank.click();
    const panel = page.getByRole('region', { name: '题目列表与组卷' });
    await panel.getByRole('checkbox', { name: '选择题目 q2' }).waitFor();
    assert(
      await panel
        .getByRole('heading', {
          name: '一、单项选择题（本大题共1小题，每小题3分，满分3分）',
          exact: true,
        })
        .isVisible(),
    );
    assert(
      await panel
        .getByRole('heading', {
          name: '二、填空题（本大题共1小题，每小题7分，满分7分）',
          exact: true,
        })
        .isVisible(),
    );
    const checkStemLine = async (root) => {
      const metrics = await root
        .locator('[data-question-stem]')
        .first()
        .evaluate((element) => {
          const number = element
            .querySelector('strong')
            .getBoundingClientRect();
          const paragraph = element.querySelector('.x-markdown p');
          const text = document
            .createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
            .nextNode();
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 1);
          const firstCharacter = range.getBoundingClientRect();
          return {
            topDifference: Math.abs(number.top - firstCharacter.top),
            gap: firstCharacter.left - number.right,
          };
        });
      assert(
        metrics.topDifference < 7 && metrics.gap >= 0,
        `number and question must start on the same line: ${JSON.stringify(metrics)}`,
      );
    };
    await checkStemLine(panel);
    assert(
      !(await panel.locator('article').first().textContent()).includes('3 分'),
    );
    await page.locator('[data-workspace-phase="open"]').waitFor();
    assert(
      await originalEditor.evaluate((element) => element.isConnected),
      'opening workspace must not remount chat',
    );
    assert.equal(await sender.inputValue(), '保留这段未发送草稿');
    const widths = await page
      .locator('.ant-splitter-panel')
      .evaluateAll((elements) =>
        elements
          .slice(0, 2)
          .map((element) => element.getBoundingClientRect().width),
      );
    assert(
      Math.abs(widths[1] / (widths[0] + widths[1]) - 0.6) < 0.01,
      `question workspace must take 60%: ${widths}`,
    );
    assert(widths[0] > 560, `navigation must be fully hidden: ${widths}`);
    await page.screenshot({
      path: path.join(artifacts, 'workspace-open-debug.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
    await page.getByText('智能组卷', { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        (document.querySelector('.ant-pro-sider-fixed')?.getBoundingClientRect()
          .width || 0) >= 279,
    );
    await page.getByRole('button', { name: '隐藏导航', exact: true }).click();
    await page.waitForFunction(
      () =>
        (document.querySelector('.ant-pro-sider-fixed')?.getBoundingClientRect()
          .width || 0) < 1,
    );
    const editTitle = page.getByRole('button', {
      name: '编辑题库标题',
      exact: true,
    });
    const titleInput = page.getByRole('textbox', {
      name: '题库标题',
      exact: true,
    });
    const titleBeforeDrag = await editTitle.boundingBox();
    const separator = page.getByRole('separator').first();
    const separatorBounds = await separator.boundingBox();
    await page.mouse.move(
      separatorBounds.x + separatorBounds.width / 2,
      separatorBounds.y + 80,
    );
    await page.mouse.down();
    await page.mouse.move(separatorBounds.x + 100, separatorBounds.y + 80, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const titleAfterDrag = await editTitle.boundingBox();
    const rightPane = await page
      .locator('.ant-splitter-panel')
      .nth(1)
      .boundingBox();
    assert(
      titleAfterDrag.x > titleBeforeDrag.x + 70,
      'title must move with the divider',
    );
    assert(
      Math.abs(titleAfterDrag.x - rightPane.x - 24) < 2,
      'title must align with the right pane content',
    );
    await page.screenshot({
      path: path.join(artifacts, 'workspace-title-resized.png'),
      fullPage: true,
    });
    await separator.dblclick();
    await editTitle.click();
    await titleInput.fill('未确认标题');
    await titleInput.press('Escape');
    assert((await editTitle.textContent()).includes('数学练习'));
    await editTitle.click();
    await titleInput.fill('   ');
    await titleInput.press('Enter');
    assert.equal(await titleInput.getAttribute('aria-invalid'), 'true');
    await titleInput.fill(' 自选验证试卷 ');
    await titleInput.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
    });
    assert(
      await titleInput.isVisible(),
      'IME confirmation must not save the title',
    );
    await titleInput.press('Enter');
    assert((await editTitle.textContent()).includes('自选验证试卷'));
    await panel.getByRole('checkbox', { name: '选择题目 q1' }).uncheck();
    await panel.getByRole('checkbox', { name: '显示答案和解析' }).check();
    assert.equal(await panel.getByLabel('试卷标题').count(), 0);
    assert.equal(
      await panel
        .getByRole('button', { name: '关闭题目面板', exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: path.join(artifacts, 'workspace-desktop.png'),
      fullPage: true,
    });
    await panel.getByRole('button', { name: '组卷预览', exact: true }).click();
    const preview = page.getByRole('dialog', { name: '试卷预览' });
    await preview.waitFor();
    await page.waitForTimeout(350);
    const drawerBounds = await preview.boundingBox();
    assert(
      drawerBounds && Math.abs(drawerBounds.x + drawerBounds.width - 1440) < 2,
    );
    assert(drawerBounds.width > 850 && drawerBounds.width < 880);
    await page.screenshot({
      path: path.join(artifacts, 'paper-preview-desktop.png'),
      fullPage: true,
    });
    const previewText = await preview
      .locator('[data-paper-preview]')
      .textContent();
    assert(previewText.includes('题目数量：1 题'));
    assert(previewText.includes('总分 7 分'));
    assert(
      previewText.includes('一、填空题（本大题共1小题，每小题7分，满分7分）'),
    );
    await checkStemLine(preview);
    assert(!previewText.includes('求方程'));
    await page.evaluate(() => {
      const open = window.open.bind(window);
      window.open = (...args) => {
        const child = open(...args);
        if (child) {
          child.print = () => {
            child.document.documentElement.dataset.printRequested = 'true';
          };
        }
        return child;
      };
    });
    const [printPage] = await Promise.all([
      page.context().waitForEvent('page'),
      preview.getByRole('button', { name: '打印预览', exact: true }).click(),
    ]);
    await printPage
      .waitForFunction(
        () => document.documentElement.dataset.printRequested === 'true',
        undefined,
        { timeout: 10000 },
      )
      .catch(async (error) => {
        console.error(
          'Print window state:',
          await printPage.evaluate(() => ({
            text: document.body.textContent?.slice(0, 500),
            fonts: document.fonts.status,
            base: document.baseURI,
            ready: document.readyState,
            faces: Array.from(document.fonts, (font) => ({
              family: font.family,
              status: font.status,
            })).filter((font) => font.status !== 'unloaded'),
          })),
        );
        throw error;
      });
    assert.equal(await printPage.title(), '自选验证试卷');
    assert.equal(await printPage.locator('[data-paper-preview]').count(), 1);
    assert.equal(await printPage.getByRole('button').count(), 0);
    assert(
      (await printPage.locator('body').textContent()).includes('总分 7 分'),
    );
    assert(!(await printPage.locator('body').textContent()).includes('求方程'));
    await printPage.close();
    assert(await preview.isVisible());
    const exported = [];
    for (const [button, extension] of [
      ['下载 Word', 'docx'],
      ['下载双向细目表', 'xlsx'],
      ['下载 PDF', 'pdf'],
      ['下载试卷 JSON', 'json'],
    ]) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 45000 }),
        preview.getByRole('button', { name: button, exact: true }).click(),
      ]);
      assert(download.suggestedFilename().endsWith(`.${extension}`));
      const filename = path.join(artifacts, `selected-paper.${extension}`);
      await download.saveAs(filename);
      const bytes = await fs.readFile(filename);
      assert(bytes.length > 0);
      if (extension === 'pdf')
        assert(bytes.subarray(0, 5).toString() === '%PDF-');
      if (extension === 'json')
        assert.deepEqual(
          JSON.parse(bytes.toString()).questions.map((question) => question.id),
          ['q2'],
        );
      exported.push({ extension, bytes: bytes.length });
      await download.delete();
    }
    assert(await preview.locator('.ant-drawer-body').count());
    await preview.locator('button.ant-drawer-close').click();
    await page
      .getByRole('button', { name: '返回完整对话', exact: true })
      .click();
    assert.equal(
      await page.getByRole('button', { name: '返回完整对话' }).count(),
      0,
    );
    assert.equal(await sender.inputValue(), '保留这段未发送草稿');
    assert(
      await page.getByText('智能组卷', { exact: true }).isVisible(),
      'original navigation must be restored',
    );
    await openBank.click();
    assert((await editTitle.textContent()).includes('自选验证试卷'));
    assert.equal(
      await panel.getByRole('checkbox', { name: '选择题目 q1' }).isChecked(),
      false,
    );
    assert.equal(imports, 1, 'same card should use its loaded bank');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(artifacts, 'workspace-mobile.png'),
      fullPage: true,
    });
    await panel.getByRole('button', { name: '组卷预览', exact: true }).click();
    await preview.waitFor();
    await page.waitForTimeout(350);
    const mobileBounds = await preview.boundingBox();
    assert(mobileBounds && Math.abs(mobileBounds.width - 390) < 2);
    assert.equal(
      await preview.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
      false,
    );
    for (const label of [
      '打印预览',
      '下载 Word',
      '下载 PDF',
      '下载双向细目表',
      '下载试卷 JSON',
    ]) {
      assert(
        await preview
          .getByRole('button', { name: label, exact: true })
          .isVisible(),
      );
    }
    await page.screenshot({
      path: path.join(artifacts, 'paper-preview-mobile.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          splitWidths: widths,
          imports,
          selectedQuestions: 1,
          selectedScore: 7,
          exported,
          printPreview: true,
          editableTitleAndDividerAlignment: true,
          inlineQuestionNumbersAndSectionScores: true,
          formSubmitAndChatIsolation: true,
          chatPreserved: true,
          selectionPreserved: true,
          mobileOverflow: false,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack);
  process.exit(1);
});
