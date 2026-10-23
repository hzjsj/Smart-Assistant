import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'alice' }));
const api = vi.hoisted(() => ({ listFiles: vi.fn(), getReport: vi.fn(), getPreview: vi.fn(), importFiles: vi.fn() }));
vi.mock('@umijs/max', () => ({ useModel: () => ({ initialState: { currentUser: { userid: state.userId } } }) }));
vi.mock('./service', () => ({
  ...api,
  getTokens: vi.fn(), getAst: vi.fn(), getText: vi.fn(), getWordTemplates: vi.fn(),
  convertWord: vi.fn(), saveWordConversion: vi.fn(),
}));

import ShubanPage from './index';

const document = { id: 'doc-alice', version: 'v1', name: '试卷.fbd', size: 128, updatedAt: 1 };
let queryClient: QueryClient;
function page() {
  return <QueryClientProvider client={queryClient}><ShubanPage /></QueryClientProvider>;
}

async function openPreview() {
  fireEvent.click(await screen.findByTitle('试卷.fbd'));
  return await waitFor(() => {
    const frame = screen.getByTitle('试卷.fbd 近似版面') as HTMLIFrameElement;
    expect(frame.contentWindow).toBeTruthy();
    return frame;
  });
}

function layoutMessage(frame: HTMLIFrameElement, phase: string, message: string) {
  act(() => window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow,
    data: { type: 'shuban-layout-state', phase, message },
  })));
}

describe('书版文档导入与预览状态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.userId = 'alice';
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.listFiles.mockResolvedValue({ files: [document] });
    api.getReport.mockResolvedValue({ warnings: [] });
    api.getPreview.mockResolvedValue('<html><body>test</body></html>');
    api.importFiles.mockResolvedValue({ documents: [document], files: [], ignoredCount: 0 });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('首次打开等待排版完成，忽略其他窗口消息，完成后才允许打印', async () => {
    render(page());
    const frame = await openPreview();
    const print = screen.getByRole('button', { name: '打印或另存为 PDF' });
    expect(print).toBeDisabled();
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: window, data: { type: 'shuban-layout-state', phase: 'ready', message: '其他窗口' },
    })));
    expect(print).toBeDisabled();
    layoutMessage(frame, 'ready', '基础横排布局完成');
    await waitFor(() => expect(print).toBeEnabled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('分页失败会展示原因并可重试', async () => {
    render(page());
    const frame = await openPreview();
    layoutMessage(frame, 'error', '布局计算失败：测试字体异常');
    expect(await screen.findByText('布局计算失败：测试字体异常')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打印或另存为 PDF' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(api.getPreview.mock.calls.length).toBeGreaterThan(1));
    expect(screen.queryByText('布局计算失败：测试字体异常')).not.toBeInTheDocument();
  });

  it('账号切换后清除旧缓存和选中文档', async () => {
    const view = render(page());
    await openPreview();
    state.userId = 'bob';
    api.listFiles.mockResolvedValue({ files: [] });
    view.rerender(page());
    await waitFor(() => expect(screen.queryByTitle('试卷.fbd')).not.toBeInTheDocument());
    expect(screen.queryByTitle('试卷.fbd 近似版面')).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['shuban', 'alice'] })).toHaveLength(0);
  });

  it('一次选择的 FBD、PRO、图片只发送一个完整批次', async () => {
    const view = render(page());
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const files = [new File(['fbd'], '试卷.fbd'), new File(['pro'], '试卷.PRO'), new File(['image'], '1.TIF')];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(api.importFiles).toHaveBeenCalledTimes(1));
    expect(api.importFiles.mock.calls[0][0].map((file: File) => file.name)).toEqual(['试卷.fbd', '试卷.PRO', '1.TIF']);
  });
});
