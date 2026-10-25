import {
  AlipayCircleOutlined,
  LockOutlined,
  MobileOutlined,
  TaobaoCircleOutlined,
  UserOutlined,
  WeiboCircleOutlined,
} from '@ant-design/icons';
import {
  LoginForm,
  ProFormCaptcha,
  ProFormCheckbox,
  ProFormText,
  type ProFormInstance,
} from '@ant-design/pro-components';
import { Helmet, history, useModel } from '@umijs/max';
import { Alert, App, Button, Tabs } from 'antd';
import { createStyles } from 'antd-style';
import React, { startTransition, useEffect, useRef, useState } from 'react';
import { Footer } from '@/components';
import {
  login,
  loginByTicket,
  currentUser as queryCurrentUser,
} from '@/services/ant-design-pro/api';
import { getFakeCaptcha } from '@/services/ant-design-pro/login';
import Settings from '../../../../config/defaultSettings';

/**
 * Validate redirect URL to prevent open redirect attacks.
 * Only allow same-origin relative paths starting with '/'.
 */
const getSafeRedirectUrl = (redirect: string | null): string => {
  if (!redirect?.startsWith('/')) return '/';

  if (redirect.startsWith('//')) return '/';

  try {
    const parsed = new URL(redirect, window.location.origin);
    if (parsed.origin !== window.location.origin) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
};

const getRedirectUrl = () => {
  const searchParams = new URL(window.location.href).searchParams;
  return getSafeRedirectUrl(searchParams.get('redirect'));
};

type PrefillCredentials = {
  username: string;
  password: string;
  autoLogin: boolean;
};

type LoginUrlParams = {
  prefillCredentials?: PrefillCredentials;
  ticket?: string;
};

const LOGIN_URL_KEYS = ['username', 'password', 'autoLogin', 'ticket'] as const;
const AUTO_LOGIN_TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'y']);

/**
 * 从地址栏读取登录 URL 参数：
 *   ?ticket=xxx                        一次性免密登录（用户管理页「登录链接」生成）
 *   ?username=u&password=p&autoLogin=1 账密预填 + 自动提交（开发/调试用，密码明文经 URL 传递）
 * 只传 username 不传 password 时，密码默认与账号相同（测试账号场景）。
 * 读取后立即从地址栏移除这些参数：避免凭证留存在浏览器历史，
 * 也避免刷新或 StrictMode 二次执行时重复自动登录。
 */
const consumeLoginUrlParams = (): LoginUrlParams => {
  const searchParams = new URLSearchParams(window.location.search);

  const ticket = searchParams.get('ticket') ?? undefined;

  const username = searchParams.get('username');
  const prefillCredentials = username
    ? {
        username,
        password: searchParams.get('password') ?? username,
        autoLogin: AUTO_LOGIN_TRUTHY_VALUES.has(
          (searchParams.get('autoLogin') ?? '').toLowerCase(),
        ),
      }
    : undefined;

  const url = new URL(window.location.href);
  let changed = false;
  LOGIN_URL_KEYS.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) {
    window.history.replaceState({}, '', url.toString());
  }

  return { prefillCredentials, ticket };
};

const useStyles = createStyles(({ token }) => {
  return {
    action: {
      marginLeft: '8px',
      color: 'rgba(0, 0, 0, 0.2)',
      fontSize: '24px',
      verticalAlign: 'middle',
      cursor: 'pointer',
      transition: 'color 0.3s',
      '&:hover': {
        color: token.colorPrimaryActive,
      },
    },
    lang: {
      width: 42,
      height: 42,
      lineHeight: '42px',
      position: 'fixed',
      right: 16,
      borderRadius: token.borderRadius,
      ':hover': {
        backgroundColor: token.colorBgTextHover,
      },
    },
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'auto',
      backgroundImage:
        "url('https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/V-_oS6r-i7wAAAAAAAAAAAAAFl94AQBr')",
      backgroundSize: '100% 100%',
    },
  };
});

const ActionIcons = () => {
  const { styles } = useStyles();

  return (
    <>
      <AlipayCircleOutlined
        key="AlipayCircleOutlined"
        className={styles.action}
      />
      <TaobaoCircleOutlined
        key="TaobaoCircleOutlined"
        className={styles.action}
      />
      <WeiboCircleOutlined
        key="WeiboCircleOutlined"
        className={styles.action}
      />
    </>
  );
};

const LoginMessage: React.FC<{
  content: string;
}> = ({ content }) => {
  return (
    <Alert
      style={{
        marginBottom: 24,
      }}
      title={content}
      type="error"
      showIcon
    />
  );
};

const Login: React.FC = () => {
  const [userLoginState, setUserLoginState] = useState<API.LoginResult>({});
  const [type, setType] = useState<string>('account');
  const [loginUrlParams] = useState(consumeLoginUrlParams);
  const { prefillCredentials, ticket } = loginUrlParams;
  const accountFormRef = useRef<ProFormInstance | undefined>(undefined);
  const autoLoginHandledRef = useRef(false);
  const ticketHandledRef = useRef(false);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { styles } = useStyles();
  const { message } = App.useApp();

  const fetchUserInfo = async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      startTransition(() => {
        setInitialState((s) => ({
          ...s,
          currentUser: userInfo,
        }));
      });
    }
  };

  const handleSubmit = async (values: API.LoginParams) => {
    try {
      // 登录
      const msg = await login({ ...values, type });
      if (msg.status === 'ok') {
        const defaultLoginSuccessMessage = '登录成功！';
        message.success(defaultLoginSuccessMessage);
        await fetchUserInfo();
        window.location.href = getRedirectUrl();
        return;
      }
      // 如果失败去设置用户错误信息
      setUserLoginState(msg);
    } catch {
      const defaultLoginFailureMessage = '登录失败，请重试！';
      message.error(defaultLoginFailureMessage);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // 先探测登录态：已登录直接跳目标页，不消费 ticket、不重复提交账密。
      // 纯查询接口，401 静默处理（skipErrorHandler），失败按未登录继续。
      try {
        const msg = await queryCurrentUser({ skipErrorHandler: true });
        if (msg.data) {
          startTransition(() => {
            setInitialState((s) => ({ ...s, currentUser: msg.data }));
          });
          history.push(getRedirectUrl());
          return;
        }
      } catch {
        // 查询失败按未登录处理
      }
      if (cancelled) return;

      // URL 带 ticket：一次性免密登录（用户管理页生成的登录链接）
      if (ticket && !ticketHandledRef.current) {
        ticketHandledRef.current = true;
        try {
          const res = await loginByTicket({ ticket }, { skipErrorHandler: true });
          if (res.status === 'ok') {
            message.success('登录成功！');
            await fetchUserInfo();
            history.push(getRedirectUrl());
            return;
          }
          message.error(res.message || '登录链接已失效，请重新获取');
        } catch {
          message.error('登录链接已失效，请重新获取');
        }
        return;
      }

      // URL 带账号密码且 autoLogin=1：自动提交账号登录（走表单原生 submit，
      // 复用校验、按钮 loading 与错误展示）
      if (!prefillCredentials?.autoLogin || autoLoginHandledRef.current) return;

      autoLoginHandledRef.current = true;
      accountFormRef.current?.submit();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [prefillCredentials, ticket, setInitialState]);
  const { status, type: loginType } = userLoginState;

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          登录
          {Settings.title && ` - ${Settings.title}`}
        </title>
      </Helmet>
      <div
        style={{
          flex: '1',
          padding: '32px 0',
        }}
      >
        <LoginForm
          formRef={accountFormRef}
          contentStyle={{
            minWidth: 280,
            maxWidth: '75vw',
          }}
          logo={<img alt="logo" src="/logo.svg" />}
          title="Ant Design"
          subTitle={'Ant Design 是西湖区最具影响力的 Web 设计规范'}
          initialValues={{
            autoLogin: true,
            ...(prefillCredentials && {
              username: prefillCredentials.username,
              password: prefillCredentials.password,
            }),
          }}
          actions={[
            'loginWith',
            <ActionIcons key="icons" />,
          ]}
          onFinish={async (values) => {
            await handleSubmit(values as API.LoginParams);
          }}
        >
          <Tabs
            activeKey={type}
            onChange={setType}
            centered
            items={[
              {
                key: 'account',
                label: '账户密码登录',
              },
              {
                key: 'mobile',
                label: '手机号登录',
              },
            ]}
          />

          {status === 'error' && loginType === 'account' && (
            <LoginMessage
              content={'错误的用户名和密码(admin/ant.design)'}
            />
          )}
          {type === 'account' && (
            <>
              <ProFormText
                name="username"
                fieldProps={{
                  size: 'large',
                  prefix: <UserOutlined />,
                }}
                placeholder={'用户名: admin or user'}
                rules={[
                  {
                    required: true,
                    message: (
                      '用户名是必填项！'
                    ),
                  },
                ]}
              />
              <ProFormText.Password
                name="password"
                fieldProps={{
                  size: 'large',
                  prefix: <LockOutlined />,
                }}
                placeholder={'密码: ant.design'}
                rules={[
                  {
                    required: true,
                    message: (
                      '密码是必填项！'
                    ),
                  },
                ]}
              />
            </>
          )}

          {status === 'error' && loginType === 'mobile' && (
            <LoginMessage content="验证码错误" />
          )}
          {type === 'mobile' && (
            <>
              <ProFormText
                fieldProps={{
                  size: 'large',
                  prefix: <MobileOutlined />,
                }}
                name="mobile"
                placeholder={'请输入手机号！'}
                rules={[
                  {
                    required: true,
                    message: (
                      '手机号是必填项！'
                    ),
                  },
                  {
                    pattern: /^1\d{10}$/,
                    message: (
                      '不合法的手机号！'
                    ),
                  },
                ]}
              />
              <ProFormCaptcha
                fieldProps={{
                  size: 'large',
                  prefix: <LockOutlined />,
                }}
                captchaProps={{
                  size: 'large',
                }}
                placeholder={'请输入验证码！'}
                captchaTextRender={(timing, count) => {
                  if (timing) {
                    return `${count} ${'秒后重新获取'}`;
                  }
                  return '获取验证码';
                }}
                name="captcha"
                rules={[
                  {
                    required: true,
                    message: (
                      '验证码是必填项！'
                    ),
                  },
                ]}
                onGetCaptcha={async (phone) => {
                  const result = await getFakeCaptcha({
                    phone,
                  });
                  if (!result) {
                    return;
                  }
                  message.success('获取验证码成功！验证码为：1234');
                }}
              />
            </>
          )}
          <div
            style={{
              marginBottom: 24,
            }}
          >
            <ProFormCheckbox noStyle name="autoLogin">
              自动登录
            </ProFormCheckbox>
            <Button
              type="link"
              style={{
                float: 'right',
                padding: 0,
              }}
            >
              忘记密码 ?
            </Button>
          </div>
        </LoginForm>
      </div>
      <Footer />
    </div>
  );
};

export default Login;
