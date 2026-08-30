import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserItem } from '@/services/user';

const listUsersMock = vi.fn();

vi.mock('@/services/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/user')>()),
  listUsers: (...args: unknown[]) => listUsersMock(...args),
}));

vi.mock('@ant-design/pro-components', () => ({
  PageContainer: ({ children }: any) => (
    <div data-testid="page-container">{children}</div>
  ),
  ProTable: ({ request }: any) => {
    request?.({ current: 1, pageSize: 10 }, {}, {});
    return <div data-testid="pro-table" />;
  },
}));

const { default: UserList } = await import('./index');

const mockUsers: UserItem[] = [
  {
    id: 1,
    username: 'admin',
    name: 'Serati Ma',
    userid: '00000001',
    access: 'admin',
  },
];

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UserList />
    </QueryClientProvider>,
  );

describe('UserList 页面', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染并调用 listUsers 拉取数据', async () => {
    listUsersMock.mockResolvedValue({
      data: mockUsers,
      total: 1,
      success: true,
    });
    renderPage();
    await waitFor(() => {
      expect(listUsersMock).toHaveBeenCalledWith({
        current: 1,
        pageSize: 10,
        username: undefined,
        name: undefined,
      });
    });
    expect(screen.getByTestId('pro-table')).toBeTruthy();
  });
});
