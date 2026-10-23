// 使用真实浏览器核对 sandbox iframe 的首次排版、错误回传和重试。
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { chromium } = require(process.env.FBD_PLAYWRIGHT || 'playwright');

const backend = path.resolve(__dirname, '../..');
const python = process.env.FBD_TEST_PYTHON || path.join(backend, '.venv', 'Scripts', 'python.exe');
const html = execFileSync(python, ['-X', 'utf8', '-c', `
from shuban.fbdview import render_html
from shuban.fbdview.bytes_io import decode
from shuban.fbdview.lexer import tokenize
from shuban.fbdview.layout import Geometry
dec = decode(b'First preview.\\xaa\\xa4Second line.\\xaa\\xa6\\xaa\\xa6')
geo = Geometry(page_w=210, page_h=297, text_w=170, text_h=250, columns=1, column_w=170, m_left=20, m_top=20)
layout = render_html.preview_html(dec, tokenize(dec), geo, inline=True, document_key='browser-test')
print('<!doctype html><html><head><style>' + render_html.CSS + '</style></head><body>' + layout + '<script>' + render_html.JS + '</script></body></html>')
`], { cwd: backend, encoding: 'utf8' });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FBD_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<main id="root"></main>');
    await page.evaluate(() => {
      window.states = [];
      window.addEventListener('message', (event) => {
        if (event.source !== document.querySelector('iframe')?.contentWindow) return;
        if (event.data.type === 'shuban-layout-state') window.states.push(event.data);
      });
    });
    async function open(content) {
      await page.evaluate((source) => {
        window.states = [];
        document.querySelector('iframe')?.remove();
        const frame = document.createElement('iframe');
        frame.sandbox = 'allow-scripts allow-modals';
        frame.srcdoc = source;
        document.querySelector('#root').appendChild(frame);
      }, content);
      await page.waitForFunction(() => window.states.some((event) => event.phase === 'ready' || event.phase === 'error'));
      return page.evaluate(() => window.states);
    }
    let states = await open(html);
    assert.equal(states[0].phase, 'rendering');
    assert.equal(states.at(-1).phase, 'ready');
    const frame = page.frames().find((item) => item !== page.mainFrame());
    assert.ok(await frame.locator('#measured-pages .pageframe').count());
    states = await open(html.replace(/"expectedCharacters":\s*\d+/, '"expectedCharacters":999999'));
    assert.equal(states.at(-1).phase, 'error');
    assert.match(states.at(-1).message, /布局计算失败/);
    states = await open(html);
    assert.equal(states.at(-1).phase, 'ready');
    assert.deepEqual(errors, []);
    console.log('浏览器验证通过：首次打开完成、错误回传、重新加载恢复；无未捕获异常。');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
