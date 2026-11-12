import { expect, it, vi } from 'vitest';
import {
  collectMessageAttachments,
  downloadMessageAttachment,
  getMessageAttachment,
} from './attachments';

it.each([
  [
    'https://files.example.com/试卷.DOCX?token=a%2Bb&expires=123',
    '试卷.DOCX',
    'word',
  ],
  ['/downloads/双向细目表.xlsx', '双向细目表.xlsx', 'excel'],
  ['https://files.example.com/a%20b.pdf#page=2', 'a b.pdf', 'pdf'],
  ['https://files.example.com/archive.zip', 'archive.zip', 'zip'],
  ['https://files.example.com/readme.md', 'readme.md', 'markdown'],
  ['https://files.example.com/data.json', 'data.json', 'default'],
  ['https://files.example.com/notes.MD?token=1', 'notes.MD', 'markdown'],
  ['https://files.example.com/readme.markdown', 'readme.markdown', 'markdown'],
  ['https://files.example.com/data.xlsm', 'data.xlsm', 'excel'],
  ['https://files.example.com/data.csv', 'data.csv', 'excel'],
  ['https://files.example.com/course.pptx', 'course.pptx', 'ppt'],
])('recognizes %s without losing its signed query', (url, name, icon) => {
  const file = getMessageAttachment(url, '', 'http://localhost:8000/hermes');
  expect(file?.name).toBe(name);
  expect(file?.icon).toBe(icon);
  expect(file?.url).toBe(new URL(url, 'http://localhost:8000/hermes').href);
});

it('uses a download filename or explicit filename label for extensionless endpoints', () => {
  expect(
    getMessageAttachment('https://files.example.com/download?filename=表.xlsx')
      ?.name,
  ).toBe('表.xlsx');
  expect(
    getMessageAttachment('https://files.example.com/download/123', '试卷.docx')
      ?.icon,
  ).toBe('word');
});

it('keeps explicit HTML pages as webpages even with a filename link label', () => {
  expect(
    getMessageAttachment('https://example.com/readme.html', 'readme.md'),
  ).toBeNull();
  expect(
    getMessageAttachment('https://example.com/help.htm', '试卷.pdf'),
  ).toBeNull();
});

it.each([
  'javascript:alert(1)',
  'data:text/plain,a.pdf',
  'file:///tmp/a.docx',
  'sandbox:/mnt/data/a.pdf',
  'https://user:password@example.com/a.pdf',
  'https://example.com/a.docx.exe',
  'https://example.com/page',
])('ignores unsafe or unsupported link %s', (url) => {
  expect(getMessageAttachment(url)).toBeNull();
});

it('collects actual anchors, deduplicates PDF fragments, and ignores code examples', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<a href="https://example.com/a.pdf#page=1">PDF</a><a href="https://example.com/a.pdf#page=2">PDF again</a><a href="/b.xlsx?token=abc&amp;sig=xyz">表格</a><pre><code><a href="https://example.com/sample.docx">example</a></code></pre><a href="https://example.com/help">帮助</a>';
  const files = collectMessageAttachments(root);
  expect(files).toHaveLength(2);
  expect(files[1].url).toContain('?token=abc&sig=xyz');
});

it.each([
  '试卷.pdf',
  '说明.md',
  '说明.markdown',
])('downloads %s as a blob and never navigates the current page', async (name) => {
  vi.useFakeTimers();
  const file = getMessageAttachment(`https://example.com/${name}`);
  if (!file) throw new Error('fixture attachment missing');
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/pdf' },
    blob: async () => new Blob(['pdf']),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/test');
  URL.revokeObjectURL = vi.fn();
  const clicked: HTMLAnchorElement[] = [];
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  try {
    await downloadMessageAttachment(file);
    expect(fetchMock).toHaveBeenCalledWith(
      file.url,
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(clicked[0].download).toBe(name);
    expect(clicked[0].href).toBe('blob:http://localhost/test');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      'blob:http://localhost/test',
    );
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    click.mockRestore();
    vi.useRealTimers();
  }
});
