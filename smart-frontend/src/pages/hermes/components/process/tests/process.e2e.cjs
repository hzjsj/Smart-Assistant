// Isolated streaming HTTP fixture: no real model, backend changes, or commands.
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
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const streams = [];
const server = http.createServer((request, response) => {
  response.setHeader(
    'Access-Control-Allow-Origin',
    request.headers.origin || 'http://localhost:8000',
  );
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  request.resume();
  request.on('end', () => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    response.flushHeaders();
    const send = (data, event = '') => {
      if (!response.destroyed)
        response.write(
          `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`,
        );
    };
    streams.push({
      response,
      think: (text) =>
        send({ choices: [{ delta: { reasoning_content: text } }] }),
      tool: (
        status,
        percent,
        label = '核对题目要求',
        id = 'a',
        event = 'hermes.tool.progress',
      ) =>
        send(
          {
            tool: 'inspect_questions',
            toolCallId: id,
            status,
            percent,
            label,
            message:
              status === 'error' ? '示例失败原因' : '正在核对题目覆盖情况',
          },
          event,
        ),
      send,
      finish: (content) => {
        send({ choices: [{ delta: { content }, finish_reason: 'stop' }] });
        response.end('data: [DONE]\n\n');
      },
    });
  });
});

async function waitStream(count) {
  const deadline = Date.now() + 15000;
  while (streams.length < count && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(streams.length, count);
  return streams[count - 1];
}

(async () => {
  const artifacts = path.resolve(__dirname, '../../../.artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // 浏览器默认用 playwright 自带 Chromium；HERMES_E2E_CHROME 可指定本机 Chrome。
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.HERMES_E2E_CHROME
      ? { executablePath: process.env.HERMES_E2E_CHROME }
      : {}),
    args: ['--no-sandbox'],
  });
  const bank = {
    id: 'saved-process-bank',
    question_count: 2,
    total_score: 8,
    document: {
      type: 'question_bank',
      version: 1,
      id: 'process-bank',
      title: '过程测试题库',
      subject: '数学',
      grade: '初中一年级',
      exam_type: '单元测试',
      difficulty: 5,
      questions: [1, 2].map((number) => ({
        id: `q${number}`,
        type: '填空题',
        content: `计算 $${number}+1$。`,
        options: [],
        answer: `${number + 1}`,
        analysis: '相加。',
        score: 4,
        knowledge_points: ['算术'],
        cognitive_level: '理解',
        difficulty: 5,
      })),
    },
  };
  const card = {
    type: 'question_bank',
    version: 1,
    id: 'process-bank',
    name: '过程测试题库.json',
    url: 'https://files.example.com/bank.json',
    question_count: 2,
  };
  const withCard = (text) =>
    `${text}\n\n\`\`\`question-bank\n${JSON.stringify(card)}\n\`\`\``;
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/currentUser')
        return route.fulfill({
          json: {
            data: { userid: 'process-test', name: '过程测试', access: 'admin' },
          },
        });
      if (url.pathname.endsWith('/chat/completions'))
        return route.continue({
          url: `http://127.0.0.1:${server.address().port}/chat`,
        });
      if (url.pathname.endsWith('/question-banks/import'))
        return route.fulfill({ json: bank });
      if (url.pathname.endsWith('/approval'))
        return route.fulfill({
          json: {
            object: 'approval',
            run_id: 'fixture-run',
            choice: 'once',
            resolved: 1,
          },
        });
      // 会话端点按应用期望的响应形状 mock：catch-all 的裸数组会让自动
      // 建会话拿到 id: undefined，触发错误边界（页面出错）。
      const method = route.request().method();
      if (url.pathname === '/api/conversations' && method === 'POST')
        return route.fulfill({
          json: {
            id: 'mock-conv',
            title: '过程测试会话',
            model: 'deepseek',
            message_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      if (/^\/api\/conversations\/[^/]+\/messages$/.test(url.pathname))
        return route.fulfill({
          json: { messages: [], has_more: false, next_before_id: null },
        });
      return route.fulfill({ json: [] });
    });
    await page.goto(
      `${process.env.HERMES_TEST_FRONTEND_URL || 'http://localhost:8000'}/hermes`,
      { waitUntil: 'domcontentloaded', timeout: 45000 },
    );
    const sender = page.getByPlaceholder(
      '输入消息，按 Enter 发送，Shift + Enter 换行...',
    );
    await sender.fill('验证思考过程');
    await sender.press('Enter');
    const first = await waitStream(1);
    first.think('独立思考全文，默认不显示。');
    const trace = page.locator('[data-process-trace]').first();
    const toggle = trace.getByRole('button', { name: '执行过程', exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(
      await page
        .getByText('独立思考全文，默认不显示。', { exact: true })
        .count(),
      0,
    );
    first.tool('running', 25);
    first.think('工具关联思考全文，只有点击才显示。');
    const toolToggle = trace.getByRole('button', {
      name: '工具详情：核对题目要求',
      exact: true,
    });
    await toolToggle.waitFor();
    assert.equal(await toolToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await trace.locator('[data-tool-details]').count(), 0);
    await page.screenshot({
      path: path.join(artifacts, 'process-default-streaming.png'),
      fullPage: true,
    });
    await toolToggle.click();
    const details = trace.locator('[data-tool-details="tool:a"]');
    await details.waitFor();
    const reasoning = details.getByRole('button', {
      name: '思考过程',
      exact: true,
    });
    assert.equal(await reasoning.getAttribute('aria-expanded'), 'false');
    await reasoning.click();
    await details
      .getByText('工具关联思考全文，只有点击才显示。', { exact: true })
      .waitFor();
    await toggle.click();
    first.tool('running', 55);
    await page.waitForTimeout(150);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    await details
      .getByText('工具关联思考全文，只有点击才显示。', { exact: true })
      .waitFor();
    first.send(
      {
        run_id: 'fixture-run',
        request_id: 'approval-1',
        description: '模拟审批，不执行任何命令',
        choices: ['once', 'deny'],
      },
      'approval.request',
    );
    await toggle.click();
    await page.getByRole('button', { name: '允许一次', exact: true }).click();
    await page.getByText('已提交审批', { exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    first.tool('completed', 100);
    await trace.locator('.ant-progress-status-success').waitFor();
    assert.equal(await trace.locator('.ant-progress-status-active').count(), 0);
    await page.screenshot({
      path: path.join(artifacts, 'process-streaming.png'),
      fullPage: true,
    });
    const fullText = `第一轮完整结果：${'这是最终正文，继续逐字显示。'.repeat(24)}`;
    first.finish(withCard(fullText));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-process-trace]')
          ?.getAttribute('data-request-active') === 'false',
    );
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(
      await page.getByText(fullText, { exact: true }).count(),
      0,
      'process must close before the typewriter drains',
    );
    await toggle.click();
    await page.waitForTimeout(150);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText(fullText, { exact: true }).waitFor();
    await page.getByRole('button', { name: '查看题目', exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await details
      .getByText('工具关联思考全文，只有点击才显示。', { exact: true })
      .waitFor();
    await toggle.click();
    await page.screenshot({
      path: path.join(artifacts, 'process-completed.png'),
      fullPage: true,
    });

    await page
      .locator('.ant-bubble-start .ant-actions-item:has(.anticon-sync)')
      .first()
      .click();
    const retry = await waitStream(2);
    retry.think('重试思考默认收起。');
    retry.tool('running', 35);
    await toolToggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await toolToggle.getAttribute('aria-expanded'), 'false');
    retry.tool('error', 35, '核对题目要求', 'a', 'tool.progress');
    await page.getByRole('alert').filter({ hasText: '示例失败原因' }).waitFor();
    retry.finish('重试返回了部分结果。');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-process-trace]')
          ?.getAttribute('data-request-active') === 'false',
    );
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await trace.getAttribute('data-process-state'), 'error');
    assert(
      await page
        .getByRole('alert')
        .filter({ hasText: '示例失败原因' })
        .isVisible(),
    );
    await toggle.click();
    await toolToggle.click();
    await trace.locator('.ant-progress-status-exception').waitFor();
    assert.equal(await trace.locator('.ant-progress-status-active').count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await sender.fill('停止测试');
    await sender.press('Enter');
    const stopped = await waitStream(3);
    stopped.think('停止请求前的思考。');
    stopped.tool('running', 20);
    const stoppedTrace = page.locator('[data-process-trace]').nth(1);
    await stoppedTrace
      .getByRole('button', { name: '执行过程', exact: true })
      .waitFor();
    await page.locator('.ant-sender-actions-btn-loading-button').click();
    await page.waitForFunction(
      () =>
        document
          .querySelectorAll('[data-process-trace]')[1]
          ?.getAttribute('data-request-active') === 'false',
    );
    assert.equal(
      await stoppedTrace
        .getByRole('button', { name: '执行过程', exact: true })
        .getAttribute('aria-expanded'),
      'false',
    );
    assert.equal(
      await stoppedTrace.getAttribute('data-process-state'),
      'abort',
    );

    await sender.fill('后台测试');
    await sender.press('Enter');
    const background = await waitStream(4);
    const longLabel =
      '校验题目内容、知识点、选项、答案和解析，并核对题目数量与题型分配，确保文件完整可用';
    background.tool('running', 30, longLabel);
    const backgroundTrace = page.locator('[data-process-trace]').nth(2);
    await backgroundTrace
      .getByRole('button', { name: '执行过程', exact: true })
      .waitFor();
    const foreground = await browser.newPage();
    await foreground.goto('about:blank');
    await foreground.bringToFront();
    const nativeBackground = await page.evaluate(() => document.hidden);
    if (!nativeBackground)
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    background.tool('completed', 100, longLabel);
    const backgroundText =
      '后台完整结果，返回后应直接看到已收起的过程和完整正文。';
    background.finish(withCard(backgroundText));
    await page.waitForFunction(
      () =>
        document
          .querySelectorAll('[data-process-trace]')[2]
          ?.getAttribute('data-request-active') === 'false',
    );
    await page.bringToFront();
    if (!nativeBackground)
      await page.evaluate(() => {
        Reflect.deleteProperty(document, 'hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      });
    await foreground.close();
    await page.getByText(backgroundText, { exact: true }).waitFor();
    const backgroundToggle = backgroundTrace.getByRole('button', {
      name: '执行过程',
      exact: true,
    });
    assert.equal(await backgroundToggle.getAttribute('aria-expanded'), 'false');
    await backgroundToggle.click();
    await page.getByRole('button', { name: '查看题目', exact: true }).click();
    await page.getByRole('region', { name: '题目列表与组卷' }).waitFor();
    await page.locator('[data-workspace-phase="open"]').waitFor();
    await backgroundTrace.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifacts, 'process-workspace.png'),
      fullPage: true,
    });
    const separator = page.getByRole('separator').first();
    const divider = await separator.boundingBox();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + 60);
    await page.mouse.down();
    await page.mouse.move(360, divider.y + 60, { steps: 8 });
    await page.mouse.up();
    assert.equal(
      await backgroundTrace
        .locator('[data-tool-toggle]')
        .evaluate((node) => getComputedStyle(node).whiteSpace),
      'normal',
    );
    assert(
      await backgroundTrace.evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, 'process-narrow-pane.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: '返回完整对话', exact: true })
      .click();
    await page.locator('[data-workspace-phase="closed"]').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const mask = document.querySelector(
        '.ant-drawer-open > .ant-drawer-mask',
      );
      if (mask instanceof HTMLElement) mask.click();
    });
    await page.waitForTimeout(350);
    await backgroundTrace.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(artifacts, 'process-mobile.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          streamedOpen: true,
          nestedDetailsClosed: true,
          manualChoicesPreserved: true,
          rawCompletionBeforeTypewriter: true,
          retryReset: true,
          errorVisibleOutside: true,
          stoppedClosed: true,
          backgroundCompletion: true,
          nativeBackground,
          responsive: true,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    for (const stream of streams) stream.response.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
