import { LockOutlined, UserOutlined } from '@ant-design/icons';
import {
  LoginForm,
  ProFormCheckbox,
  type ProFormInstance,
  ProFormText,
} from '@ant-design/pro-components';
import { Helmet, history, useModel } from '@umijs/max';
import * as ww from '@wecom/jssdk';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  message,
  Row,
  Spin,
  Typography,
} from 'antd';
import React, {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  login as accountLogin,
  loginByTicket,
  loginByWecom,
  currentUser as queryCurrentUser,
  wecomCheckEnv,
} from '@/services/ant-design-pro/api';
import Settings from '../../../../config/defaultSettings';
import styles from './index.less';

type WecomConfig = {
  CORPID?: string;
  AGENTID?: string;
  REDIRECT_URI?: string;
};

type CheckEnvResponse = {
  isWxWork?: boolean;
  config?: WecomConfig | null;
  info?: Record<string, unknown>;
};

type LoginResultWithMessage = API.LoginResult & {
  message?: string;
};

const WE_COM_LOGIN_CONTAINER_ID = 'ww_login';
const WE_COM_CALLBACK_PATH = '/user/login';

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
  const urlParams = new URL(window.location.href).searchParams;
  return getSafeRedirectUrl(urlParams.get('redirect'));
};

const WECOM_REDIRECT_STORAGE_KEY = 'wecom_login_redirect';

/**
 * 取登录后应跳转的目标地址：优先用 redirectToWeCom 前存入 sessionStorage 的 redirect
 * （企业微信 OAuth 回跳后 URL 参数里会丢失 redirect），再回落地址栏 redirect 参数，
 * 最终回落 '/'。取值后即清，避免下次误跳。
 */
const consumeStoredRedirect = (): string => {
  try {
    const stored = sessionStorage.getItem(WECOM_REDIRECT_STORAGE_KEY);
    if (stored) {
      sessionStorage.removeItem(WECOM_REDIRECT_STORAGE_KEY);
      return getSafeRedirectUrl(stored);
    }
  } catch {
    // sessionStorage 不可用时回落 URL 参数
  }
  return getRedirectUrl();
};

const extractCodeFromSearch = (search: string | undefined): string | null => {
  if (!search) return null;
  return new URLSearchParams(
    search.startsWith('?') ? search : `?${search}`,
  ).get('code');
};

const extractWecomCodeFromLocation = (): string | null => {
  const searchParams = new URLSearchParams(window.location.search);
  const code = searchParams.get('code');
  if (code) return code;

  const encodedRedirect = searchParams.get('redirect');
  if (!encodedRedirect) return null;

  try {
    const decodedRedirect = decodeURIComponent(encodedRedirect);
    const redirectUrl = new URL(decodedRedirect, window.location.origin);
    return extractCodeFromSearch(redirectUrl.search);
  } catch {
    return null;
  }
};

const stripOAuthParamsFromLocation = () => {
  // 企业微信 code 只能消费一次。从地址栏立即移除 code/state，避免重试、
  // 重复渲染或 StrictMode 二次执行时再次消费同一 code 而报「不合法的oauth_code」。
  // （保留 redirect 等其它参数，仅清掉 OAuth 回跳参数）
  const url = new URL(window.location.href);
  let changed = false;
  ['code', 'state'].forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) {
    window.history.replaceState({}, '', url.toString());
  }
};

const isValidWecomConfig = (
  config?: WecomConfig | null,
): config is Required<WecomConfig> => {
  return Boolean(config?.CORPID && config.AGENTID && config.REDIRECT_URI);
};

const buildWecomOAuthUrl = (config: Required<WecomConfig>) => {
  const callbackUrl = new URL(
    WE_COM_CALLBACK_PATH,
    config.REDIRECT_URI,
  ).toString();
  const oauthUrl = new URL(
    'https://open.weixin.qq.com/connect/oauth2/authorize',
  );

  oauthUrl.searchParams.set('appid', config.CORPID);
  oauthUrl.searchParams.set('redirect_uri', callbackUrl);
  oauthUrl.searchParams.set('response_type', 'code');
  oauthUrl.searchParams.set('scope', 'snsapi_base');
  oauthUrl.searchParams.set('state', 'loginState');
  oauthUrl.searchParams.set('agentid', config.AGENTID);

  return `${oauthUrl.toString()}#wechat_redirect`;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

type PrefillCredentials = {
  username: string;
  password: string;
  autoLogin: boolean;
};

type LoginUrlParams = {
  ticket?: string;
  prefillCredentials?: PrefillCredentials;
};

const LOGIN_URL_KEYS = ['ticket', 'username', 'password', 'autoLogin'] as const;
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

  return { ticket, prefillCredentials };
};

const getConfigLogInfo = (config?: WecomConfig | null) => ({
  hasCORPID: Boolean(config?.CORPID),
  hasAGENTID: Boolean(config?.AGENTID),
  hasREDIRECT_URI: Boolean(config?.REDIRECT_URI),
  REDIRECT_URI: config?.REDIRECT_URI,
});

const LoginMessage: React.FC<{ content: string }> = ({ content }) => {
  return (
    <Alert className={styles.alert} message={content} showIcon type="error" />
  );
};

const LoginPage: React.FC = () => {
  const [envLoading, setEnvLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [accountLoginState, setAccountLoginState] =
    useState<LoginResultWithMessage>({});
  const [isWxWork, setIsWxWork] = useState<boolean>();
  const [wecomConfig, setWecomConfig] = useState<Required<WecomConfig>>();
  // 企微配置缺失时隐藏左侧扫码栏，账密表单单栏居中展示（普通用户无需感知配置问题）
  const [scanUnavailable, setScanUnavailable] = useState(false);
  const loginHandledRef = useRef(false);
  const panelCreatedRef = useRef(false);
  const [loginUrlParams] = useState(consumeLoginUrlParams);
  const { prefillCredentials, ticket } = loginUrlParams;
  const accountFormRef = useRef<ProFormInstance | undefined>(undefined);
  const autoLoginHandledRef = useRef(false);
  const ticketHandledRef = useRef(false);
  const { initialState, setInitialState } = useModel('@@initialState');

  const fetchUserInfo = useCallback(async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      startTransition(() => {
        setInitialState((state) => ({
          ...state,
          currentUser: userInfo,
        }));
      });
    }
    return userInfo;
  }, [initialState, setInitialState]);

  // 用 ref 持有最新 fetchUserInfo，避免把它放进 handleWecomLogin/bootstrap 的依赖，
  // 导致 initialState 变化时连锁重建进而触发 useEffect 重复执行。
  const fetchUserInfoRef = useRef(fetchUserInfo);
  fetchUserInfoRef.current = fetchUserInfo;

  const checkLoggedIn = useCallback(async () => {
    // 纯登录态查询：已登录则返回 currentUser 并写入 initialState；未登录返回 undefined。
    // 不复用 app.tsx 的 fetchUserInfo（其 401 会 history.replace 污染 redirect）。
    try {
      const msg = await queryCurrentUser({ skipErrorHandler: true });
      if (msg.data) {
        startTransition(() => {
          setInitialState((state) => ({ ...state, currentUser: msg.data }));
        });
      }
      return msg.data;
    } catch {
      return undefined;
    }
  }, [setInitialState]);

  const handleWecomLogin = useCallback(async (code: string) => {
    console.info('[wecom-login] handle login start', {
      hasCode: Boolean(code),
      loginHandled: loginHandledRef.current,
    });
    if (loginHandledRef.current) return;
    loginHandledRef.current = true;
    setLoginLoading(true);
    setError(undefined);

    try {
      const result = await loginByWecom({ code }, { skipErrorHandler: true });

      if (result.status === 'ok') {
        message.success('登录成功！');
        // 拿 currentUser 写入 initialState，再用 SPA 跳转避免整页刷新
        await fetchUserInfoRef.current();
        history.push(consumeStoredRedirect());
        return;
      }

      loginHandledRef.current = false;
      const errorMessage = result.message || '企业微信登录失败，请重试';
      console.error('[wecom-login] login api returned error', result);
      setError(errorMessage);
      message.error(errorMessage);
    } catch (requestError) {
      loginHandledRef.current = false;
      console.error('[wecom-login] login api request failed', requestError);
      const errorMessage = getErrorMessage(
        requestError,
        '企业微信登录请求失败，请稍后重试',
      );
      setError(errorMessage);
      message.error(errorMessage);
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const handleAccountSubmit = useCallback(
    async (values: API.LoginParams) => {
      try {
        const result = (await accountLogin({
          ...values,
          type: 'account',
        })) as LoginResultWithMessage;

        if (result.status === 'ok') {
          message.success('登录成功！');
          await fetchUserInfo();
          history.push(consumeStoredRedirect());
          return;
        }

        setAccountLoginState(result);
      } catch (accountError) {
        console.error('[wecom-login] account login failed', accountError);
        message.error('登录失败，请重试！');
      }
    },
    [fetchUserInfo],
  );

  const redirectToWeCom = useCallback((config: Required<WecomConfig>) => {
    // OAuth 回跳后 URL 参数里会丢失 redirect，跳转前先存 sessionStorage 供回跳后取回
    try {
      sessionStorage.setItem(WECOM_REDIRECT_STORAGE_KEY, getRedirectUrl());
    } catch {
      // sessionStorage 不可用时静默回落（回跳后走 '/' 兜底）
    }
    const oauthUrl = buildWecomOAuthUrl(config);
    console.info('[wecom-login] redirect to wecom oauth', {
      oauthUrl,
      config: getConfigLogInfo(config),
    });
    window.location.href = oauthUrl;
  }, []);

  const initWWLoginPanel = useCallback(
    (config: Required<WecomConfig>) => {
      const container = document.getElementById(WE_COM_LOGIN_CONTAINER_ID);
      console.info('[wecom-login] init panel start', {
        panelCreated: panelCreatedRef.current,
        hasContainer: Boolean(container),
        config: getConfigLogInfo(config),
      });

      if (panelCreatedRef.current) {
        console.info(
          '[wecom-login] skip panel init because it was already created',
        );
        return;
      }
      if (!container) {
        console.error('[wecom-login] cannot init panel: container not found', {
          id: WE_COM_LOGIN_CONTAINER_ID,
        });
        setError('企业微信扫码登录容器不存在，请刷新页面重试');
        return;
      }

      panelCreatedRef.current = true;

      try {
        console.info('[wecom-login] call createWWLoginPanel');
        ww.createWWLoginPanel({
          el: `#${WE_COM_LOGIN_CONTAINER_ID}`,
          params: {
            login_type: ww.WWLoginType.corpApp,
            appid: config.CORPID,
            agentid: config.AGENTID,
            redirect_uri: config.REDIRECT_URI,
            state: 'loginState',
            redirect_type: ww.WWLoginRedirectType.callback,
          },
          onCheckWeComLogin({ isWeComLogin }) {
            console.info('[wecom-login] onCheckWeComLogin', { isWeComLogin });
          },
          onLoginSuccess({ code }) {
            console.info('[wecom-login] onLoginSuccess', {
              hasCode: Boolean(code),
            });
            void handleWecomLogin(code);
          },
          onLoginFail(err) {
            console.error('[wecom-login] onLoginFail', err);
            const errorMessage = getErrorMessage(
              err,
              '企业微信扫码登录组件加载失败，请刷新页面重试',
            );
            setError(errorMessage);
            message.error(errorMessage);
          },
        });
        console.info('[wecom-login] createWWLoginPanel called successfully');
      } catch (panelError) {
        panelCreatedRef.current = false;
        console.error('[wecom-login] createWWLoginPanel failed', panelError);
        const errorMessage = getErrorMessage(
          panelError,
          '企业微信扫码登录组件初始化失败，请刷新页面重试',
        );
        setError(errorMessage);
        message.error(errorMessage);
      }
    },
    [handleWecomLogin],
  );

  const bootstrap = useCallback(async () => {
    const code = extractWecomCodeFromLocation();
    console.info('[wecom-login] bootstrap start', {
      href: window.location.href,
      hasCode: Boolean(code),
    });

    if (code) {
      // 立即从地址栏移除 code/state，避免重复消费（见 stripOAuthParamsFromLocation）
      stripOAuthParamsFromLocation();

      // 先判断是否已登录：已登录直接跳目标页，不消费 code。
      // （企业微信 code 只能消费一次；已登录仍消费会无谓浪费/触发「不合法的oauth_code」）
      const currentUser = await fetchUserInfoRef.current();
      if (currentUser) {
        console.info('[wecom-login] already logged in, skip code consumption');
        history.push(consumeStoredRedirect());
        return;
      }

      // 未登录，消费 code 登录
      await handleWecomLogin(code);
      return;
    }

    // 无 code：先查是否已登录。已登录直接跳目标页，避免被拉去走一遍 OAuth。
    const currentUser = await checkLoggedIn();
    if (currentUser) {
      console.info('[wecom-login] already logged in, skip oauth');
      history.push(consumeStoredRedirect());
      return;
    }

    // URL 带 ticket：一次性免密登录（用户管理页生成的登录链接）。
    // 成功即跳转；失败提示后继续正常登录流程（扫码/账密兜底），不阻塞。
    if (ticket && !ticketHandledRef.current) {
      ticketHandledRef.current = true;
      try {
        const res = await loginByTicket({ ticket }, { skipErrorHandler: true });
        if (res.status === 'ok') {
          message.success('登录成功！');
          await fetchUserInfoRef.current();
          history.push(consumeStoredRedirect());
          return;
        }
        message.error(res.message || '登录链接已失效，请重新获取');
      } catch {
        message.error('登录链接已失效，请重新获取');
      }
    }

    setEnvLoading(true);
    setError(undefined);
    // 重试场景：先恢复双栏布局，配置仍缺失时会再次置位
    setScanUnavailable(false);

    try {
      console.info('[wecom-login] request check-env');
      const env = (await wecomCheckEnv({
        skipErrorHandler: true,
      })) as CheckEnvResponse;
      const nextIsWxWork = Boolean(env.isWxWork);
      console.info('[wecom-login] check-env result', {
        isWxWork: nextIsWxWork,
        config: getConfigLogInfo(env.config),
        info: env.info,
      });
      setIsWxWork(nextIsWxWork);

      if (!isValidWecomConfig(env.config)) {
        setWecomConfig(undefined);
        // 隐藏扫码栏，账密表单单栏居中（错误仅记录控制台，不打扰普通用户）
        setScanUnavailable(true);
        console.error('[wecom-login] invalid wecom config', {
          config: getConfigLogInfo(env.config),
        });
        setError(
          '企业微信登录配置缺失，请联系管理员检查 WECOM_CORPID / WECOM_AGENTID / WECOM_REDIRECT_URI',
        );
        return;
      }

      setWecomConfig(env.config);

      if (nextIsWxWork) {
        redirectToWeCom(env.config);
      }
    } catch (envError) {
      console.error('[wecom-login] check-env request failed', envError);
      const errorMessage = getErrorMessage(
        envError,
        '无法获取企业微信登录环境，请稍后重试',
      );
      setError(errorMessage);
      message.error(errorMessage);
    } finally {
      setEnvLoading(false);
    }
  }, [handleWecomLogin, redirectToWeCom, checkLoggedIn, ticket]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (isWxWork !== false || !wecomConfig) return;
    if (panelCreatedRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      initWWLoginPanel(wecomConfig);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [initWWLoginPanel, isWxWork, wecomConfig]);

  useEffect(() => {
    // URL 带账号密码且 autoLogin=1 时自动提交账号登录。
    // 仅在普通浏览器（isWxWork === false）触发：企微内置浏览器会走 OAuth 重定向，
    // 地址栏带 OAuth code 时也跳过，避免与企微登录流程竞争。
    if (!prefillCredentials?.autoLogin || isWxWork !== false) return;
    if (extractWecomCodeFromLocation()) return;
    if (autoLoginHandledRef.current) return;

    autoLoginHandledRef.current = true;
    console.info('[wecom-login] auto login with prefilled credentials');
    // 走表单原生 submit，复用校验、按钮 loading 与错误展示
    accountFormRef.current?.submit();
  }, [prefillCredentials, isWxWork]);

  const { status, message: accountMessage } = accountLoginState;

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          登录
          {Settings.title && ` - ${Settings.title}`}
        </title>
      </Helmet>
      <Card
        className={`${styles.loginCard} ${
          scanUnavailable ? styles.loginCardSingle : ''
        }`}
        variant="borderless"
      >
        <Row align="stretch" gutter={0}>
          {/* 企微配置缺失时隐藏扫码栏（scanUnavailable），账密表单单栏居中 */}
          {!scanUnavailable && (
            <Col md={12} xs={24}>
              <Flex
                align="center"
                className={styles.scanPane}
                justify="center"
                vertical
              >
                <div className={styles.scanBox}>
                  {error && (
                    <Alert
                      action={
                        <Button
                          loading={envLoading || loginLoading}
                          size="small"
                          type="primary"
                          onClick={bootstrap}
                        >
                          重试
                        </Button>
                      }
                      className={styles.alert}
                      message={error}
                      showIcon
                      type="error"
                    />
                  )}

                  {(envLoading || loginLoading) && (
                    <div className={styles.loading}>
                      <Spin
                        description={
                          loginLoading ? '正在登录' : '正在检查企业微信登录环境'
                        }
                      />
                    </div>
                  )}

                  {isWxWork === false &&
                    !error &&
                    !envLoading &&
                    !loginLoading && (
                      <div
                        className={styles.panel}
                        id={WE_COM_LOGIN_CONTAINER_ID}
                      />
                    )}
                </div>
              </Flex>
            </Col>
          )}

          <Col md={scanUnavailable ? 24 : 12} xs={24}>
            <Flex
              align="center"
              className={styles.formPane}
              justify="center"
              vertical
            >
              <div className={styles.accountPane}>
                <Typography.Title className={styles.formTitle} level={3}>
                  账号密码登录
                </Typography.Title>
                <Typography.Text
                  className={styles.formSubTitle}
                  type="secondary"
                >
                  使用平台账号登录智能助手
                </Typography.Text>

                {status === 'error' && (
                  <LoginMessage
                    content={accountMessage || '用户名或密码错误，请重试'}
                  />
                )}
                <LoginForm
                  className={styles.accountForm}
                  formRef={accountFormRef}
                  contentStyle={{
                    minWidth: 280,
                    maxWidth: '100%',
                  }}
                  initialValues={{
                    autoLogin: true,
                    ...(prefillCredentials && {
                      username: prefillCredentials.username,
                      password: prefillCredentials.password,
                    }),
                  }}
                  onFinish={async (values) => {
                    await handleAccountSubmit(values as API.LoginParams);
                  }}
                >
                  <ProFormText
                    name="username"
                    fieldProps={{
                      size: 'large',
                      prefix: <UserOutlined />,
                    }}
                    placeholder="用户名"
                    rules={[
                      {
                        required: true,
                        message: '用户名是必填项！',
                      },
                    ]}
                  />
                  <ProFormText.Password
                    name="password"
                    fieldProps={{
                      size: 'large',
                      prefix: <LockOutlined />,
                    }}
                    placeholder="密码"
                    rules={[
                      {
                        required: true,
                        message: '密码是必填项！',
                      },
                    ]}
                  />
                  <div className={styles.formExtra}>
                    <ProFormCheckbox noStyle name="autoLogin">
                      自动登录
                    </ProFormCheckbox>
                    <a href="#">忘记密码 ?</a>
                  </div>
                </LoginForm>
                <Typography.Text className={styles.browserTip} type="secondary">
                  建议使用谷歌浏览器或 360 浏览器极速模式访问
                </Typography.Text>
              </div>
            </Flex>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default LoginPage;
