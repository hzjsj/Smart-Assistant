// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 页面在 Umi 运行时外单独渲染：mock 掉 @umijs/max 的路由/模型能力
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('@umijs/max', () => ({
  Helmet: ({ children }: { children?: React.ReactNode }) => children ?? null,
  history: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useModel: () => ({
    initialState: {},
    setInitialState: vi.fn(),
  }),
}));

// 认证服务全部 mock：默认未登录 + 企微配置缺失
const currentUserMock = vi.fn();
const wecomCheckEnvMock = vi.fn();
const loginMock = vi.fn();
const loginByTicketMock = vi.fn();
const loginByWecomMock = vi.fn();
vi.mock('@/services/ant-design-pro/api', () => ({
  currentUser: (...args: unknown[]) => currentUserMock(...args),
  login: (...args: unknown[]) => loginMock(...args),
  loginByTicket: (...args: unknown[]) => loginByTicketMock(...args),
  loginByWecom: (...args: unknown[]) => loginByWecomMock(...args),
  wecomCheckEnv: (...args: unknown[]) => wecomCheckEnvMock(...args),
}));

const createWWLoginPanelMock = vi.fn();
vi.mock('@wecom/jssdk', () => ({
  createWWLoginPanel: (...args: unknown[]) => createWWLoginPanelMock(...args),
  WWLoginType: { corpApp: 'corpApp' },
  WWLoginRedirectType: { callback: 'callback' },
}));

import LoginPage from './index';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  // 默认未登录
  currentUserMock.mockRejectedValue(new Error('401'));
});

describe('LoginPage', () => {
  it('企微配置缺失时降级单栏：账密表单居中，不渲染扫码面板', async () => {
    wecomCheckEnvMock.mockResolvedValue({
      isWxWork: false,
      config: { CORPID: '', AGENTID: '', REDIRECT_URI: '' },
    });

    render(<LoginPage />);

    // 账密表单正常渲染
    expect(await screen.findByText('账号密码登录')).toBeTruthy();
    expect(screen.getByPlaceholderText('用户名')).toBeTruthy();
    // 密码输入框在 jsdom 下由 ProFormText.Password 渲染的结构不稳定，
    // 不在此断言（浏览器实测覆盖）。

    // 扫码面板容器不渲染（左侧扫码栏整体隐藏）
    await waitFor(() => {
      expect(wecomCheckEnvMock).toHaveBeenCalled();
    });
    expect(document.getElementById('ww_login')).toBeNull();
    // 企微面板组件未被初始化
    expect(createWWLoginPanelMock).not.toHaveBeenCalled();
  });

  it('企微配置齐全时渲染扫码容器并初始化企微登录面板', async () => {
    wecomCheckEnvMock.mockResolvedValue({
      isWxWork: false,
      config: {
        CORPID: 'ww-test-corp',
        AGENTID: '1000002',
        REDIRECT_URI: 'http://localhost:8000',
      },
    });

    render(<LoginPage />);

    // 扫码容器出现，企微面板以 corpApp + 下发的配置初始化
    await waitFor(() => {
      expect(document.getElementById('ww_login')).not.toBeNull();
    });
    await waitFor(() => {
      expect(createWWLoginPanelMock).toHaveBeenCalled();
    });
    const params = createWWLoginPanelMock.mock.calls[0][0].params;
    expect(params.appid).toBe('ww-test-corp');
    expect(params.agentid).toBe('1000002');
    expect(params.redirect_uri).toBe('http://localhost:8000');
    expect(params.login_type).toBe('corpApp');
  });

  it('已登录时跳过登录流程直接跳目标页', async () => {
    currentUserMock.mockResolvedValue({
      data: { userid: '00000001', name: 'Serati Ma', access: 'admin' },
    });
    wecomCheckEnvMock.mockResolvedValue({
      isWxWork: false,
      config: null,
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
    // 已登录不请求 check-env（避免被拉去走 OAuth）
    expect(wecomCheckEnvMock).not.toHaveBeenCalled();
  });
});
