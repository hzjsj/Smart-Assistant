// Layout-only fixture; no model calls, downloads, or backend mutations.
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
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let imports = 0;
    const document = {
      type: 'question_bank',
      version: 1,
      id: 'motion-bank',
      title: '平滑布局验证题库',
      subject: '数学',
      grade: '初中一年级',
      exam_type: '单元测试',
      difficulty: 5,
      questions: [1, 2].map((n) => ({
        id: `q${n}`,
        type: '填空题',
        content: `计算 $${n}+1$。`,
        options: [],
        answer: `${n + 1}`,
        analysis: '相加。',
        score: 4,
        knowledge_points: [],
        cognitive_level: '理解',
        difficulty: 5,
      })),
    };
    const card = {
      type: 'question_bank',
      version: 1,
      id: 'motion-bank',
      name: '平滑布局验证题库.json',
      url: 'https://files.example.com/bank.json',
      question_count: 2,
    };
    const content = `题库已生成。\n\`\`\`question-bank\n${JSON.stringify(card)}\n\`\`\``;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/currentUser')
        return route.fulfill({
          json: {
            data: { userid: 'motion-test', name: '动画测试', access: 'admin' },
          },
        });
      if (url.pathname.endsWith('/chat/completions'))
        return route.fulfill({
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        });
      if (url.pathname.endsWith('/question-banks/import')) {
        imports += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return route.fulfill({
          json: {
            id: 'saved-motion-bank',
            question_count: 2,
            total_score: 8,
            document,
          },
        });
      }
      // 会话端点按应用期望的响应形状 mock：catch-all 的裸数组会让自动
      // 建会话拿到 id: undefined，触发错误边界（页面出错）。
      const method = route.request().method();
      if (url.pathname === '/api/conversations' && method === 'POST')
        return route.fulfill({
          json: {
            id: `mock-conv-${Date.now()}`,
            title: '测试会话',
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
    await sender.fill('动画测试');
    await sender.press('Enter');
    const open = page.getByRole('button', { name: '查看题目', exact: true });
    await open.waitFor();
    await sender.fill('保留动画测试草稿');
    const editor = await sender.elementHandle();
    const settled = (phase) =>
      page.locator(`[data-workspace-phase="${phase}"]`).waitFor();
    const sample = async (name) => {
      await page.evaluate(() => {
        window.__workspaceFrames = [];
        const started = performance.now();
        const frame = () => {
          const shell = document.querySelector('[data-workspace-phase]');
          const rect = (node) => {
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return { x: r.x, w: r.width, h: r.height };
          };
          window.__workspaceFrames.push({
            t: performance.now() - started,
            phase: shell?.getAttribute('data-workspace-phase'),
            panels: Array.from(document.querySelectorAll('.ant-splitter-panel'))
              .slice(0, 2)
              .map(rect),
            toolbar: rect(
              document.querySelector('[aria-label="题目列表与组卷"] header'),
            ),
          });
          if (performance.now() - started < 1000) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await open.click();
      await page.waitForTimeout(1050);
      const frames = await page.evaluate(() => window.__workspaceFrames);
      await fs.writeFile(
        path.join(artifacts, `workspace-motion-${name}.json`),
        JSON.stringify(frames, null, 2),
      );
      const opening = frames.filter(
        (frame) => frame.phase === 'opening' && frame.panels[1]?.w > 1,
      );
      assert(
        opening.length > 2,
        'opening must have intermediate animation frames',
      );
      for (let i = 1; i < opening.length; i++) {
        assert(
          opening[i].panels[1].w >= opening[i - 1].panels[1].w - 1,
          'right pane must grow without reversing',
        );
        assert(
          opening[i].panels[1].x <= opening[i - 1].panels[1].x + 1,
          'divider must move left without jumping back',
        );
      }
      const final = frames.at(-1);
      assert(Math.abs(final.panels[0].w - 576) < 2);
      assert(Math.abs(final.panels[1].w - 864) < 2);
      const ready = frames.filter(
        (frame) => frame.phase === 'open' && frame.toolbar?.w > 800,
      );
      assert(
        Math.max(...ready.map((frame) => frame.toolbar.h)) -
          Math.min(...ready.map((frame) => frame.toolbar.h)) <
          1,
        'loading completion must not resize the toolbar',
      );
      return { frames: opening.length, toolbarHeight: final.toolbar.h };
    };
    const cold = await sample('cold');
    assert.equal(imports, 1);
    assert(await editor.evaluate((node) => node.isConnected));
    assert.equal(await sender.inputValue(), '保留动画测试草稿');
    const panel = page.getByRole('region', { name: '题目列表与组卷' });
    await panel.getByRole('checkbox', { name: '选择题目 q1' }).uncheck();
    await page
      .getByRole('button', { name: '返回完整对话', exact: true })
      .click();
    await settled('closed');
    const cached = await sample('cached');
    assert.equal(imports, 1);
    assert.equal(
      await panel.getByRole('checkbox', { name: '选择题目 q1' }).isChecked(),
      false,
    );
    const divider = page.getByRole('separator').first();
    const bounds = await divider.boundingBox();
    await page.mouse.move(bounds.x, bounds.y + 80);
    await page.mouse.down();
    await page.mouse.move(700, bounds.y + 80, { steps: 8 });
    await page.mouse.up();
    const size = await page
      .locator('.ant-splitter-panel')
      .first()
      .evaluate((node) => node.getBoundingClientRect().width);
    assert(
      size > 650 && size < 750,
      'manual dragging must track the pointer without an animation delay',
    );
    await divider.dblclick();
    await page
      .getByRole('button', { name: '返回完整对话', exact: true })
      .click();
    await settled('closed');
    await open.click();
    await page
      .getByRole('button', { name: '返回完整对话', exact: true })
      .click();
    await settled('closed');
    await open.click();
    await settled('open');
    assert.equal(imports, 1);
    await page
      .getByRole('button', { name: '返回完整对话', exact: true })
      .click();
    await settled('closed');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open.click();
    await settled('open');
    assert.equal(
      await page
        .locator('.ant-splitter-panel')
        .first()
        .evaluate((node) => getComputedStyle(node).transitionDuration),
      '0s',
    );
    await page.screenshot({
      path: path.join(artifacts, 'workspace-motion-final.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: '返回完整对话', exact: true })
      .click();
    await settled('closed');
    await page.setViewportSize({ width: 900, height: 1000 });
    await open.click();
    await panel.waitFor();
    // 900px 下 ProLayout 为桌面 flex 停靠模式（非抽屉）：隐藏即 transform
    // 移出视口且 visibility: hidden（带 280ms 延迟生效），宽度不变。
    // 等待收起动画完成后再断言「导航彻底不可见」。
    await page.waitForFunction(
      () => {
        const sider = document.querySelector('.ant-pro-sider-fixed');
        if (!sider) return true;
        const rect = sider.getBoundingClientRect();
        return (
          getComputedStyle(sider).visibility === 'hidden' ||
          rect.left <= -rect.width
        );
      },
      undefined,
      { timeout: 5000 },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          cold,
          cached,
          originalEditorRetained: true,
          selectionRetained: true,
          dragImmediate: true,
          rapidReversal: true,
          reducedMotion: true,
          tabletAndMobile: true,
          imports,
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
  process.exitCode = 1;
});
