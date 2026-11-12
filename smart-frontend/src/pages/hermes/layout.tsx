import { PageContainer, ProLayout } from '@ant-design/pro-components';
import { Link, useLocation } from '@umijs/max';
import { Button } from 'antd';
import {
  type CSSProperties,
  cloneElement,
  isValidElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import sidebarToggleIcon from './assets/sidebar-toggle.png';
import { chatTokens } from './chatTokens';
import { WorkbenchActionsContext } from './components/question-bank/WorkbenchActionsContext';
import { useStyles } from './style';

const HermesLayout = ({
  children,
  conversations,
  workbenchOpen = false,
  onCloseWorkspace,
}: {
  children: ReactNode;
  conversations: ReactNode;
  workbenchOpen?: boolean;
  onCloseWorkspace?: () => void;
}) => {
  const { styles } = useStyles();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  // 收起态悬浮「显示侧栏」按钮时，侧栏内容以悬浮圆角面板临时滑出（豆包样式）。
  const [peeking, setPeeking] = useState(false);
  // 退出淡出：鼠标移开 → 面板原位淡出 150ms → 切回隐藏态（避免瞬间跳变）。
  const [peekClosing, setPeekClosing] = useState(false);
  const peekCloseTimer = useRef<number | undefined>(undefined);
  const peekActive = peeking && collapsed;
  const startPeekClosing = () => {
    if (!peeking || peekClosing) return;
    setPeekClosing(true);
    peekCloseTimer.current = window.setTimeout(() => {
      setPeekClosing(false);
      setPeeking(false);
      peekCloseTimer.current = undefined;
    }, 150);
  };
  const cancelPeekClosing = () => {
    if (peekCloseTimer.current !== undefined) {
      window.clearTimeout(peekCloseTimer.current);
      peekCloseTimer.current = undefined;
    }
    setPeekClosing(false);
  };
  const previousOpen = useRef(false);
  const previousCollapsed = useRef(false);
  useLayoutEffect(() => {
    if (workbenchOpen && !previousOpen.current) {
      previousCollapsed.current = collapsed;
      setCollapsed(true);
    } else if (!workbenchOpen && previousOpen.current)
      setCollapsed(previousCollapsed.current);
    previousOpen.current = workbenchOpen;
  }, [workbenchOpen]);
  // ⌘B / Ctrl+B 快捷键切换侧栏（输入框内不拦截）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'b')
        return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setPeeking(false);
      setPeekClosing(false);
      setCollapsed((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  // 收起态用原生 mouseenter 触发窥视（双保险：不依赖 React 事件委托，
  // 热更新残留等极端场景下也能保证悬浮生效）。
  // 整个按钮为触发区 + 250ms 悬停延时：路过按钮不弹出，停留才显示。
  const navButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = navButtonRef.current;
    if (!el) return;
    let timer: number | undefined;
    const onEnter = () => {
      if (!collapsed) return;
      timer = window.setTimeout(() => setPeeking(true), 250);
    };
    const onLeave = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      onLeave();
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [collapsed]);
  // 窥视面板滚动条自动显隐：面板整体滚动时显示，停止 600ms 后隐藏
  // （滚动容器是 .ant-pro-sider-fixed 本身，与停靠态会话列表是两个元素，
  //  故在此单独监听并切换 data-scrolling，样式见 style.ts）。
  useEffect(() => {
    if (!peekActive) return;
    const sider = document.querySelector<HTMLElement>('.ant-pro-sider-fixed');
    if (!sider) return;
    let timer: number | undefined;
    const onScroll = () => {
      sider.dataset.scrolling = 'true';
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        delete sider.dataset.scrolling;
        timer = undefined;
      }, 600);
    };
    sider.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sider.removeEventListener('scroll', onScroll);
      if (timer !== undefined) window.clearTimeout(timer);
      delete sider.dataset.scrolling;
    };
  }, [peekActive]);
  return (
    <div
      className={styles.workspace}
      data-nav-hidden={collapsed}
      data-nav-peek={peekActive ? 'true' : undefined}
      data-nav-closing={peekClosing ? 'true' : undefined}
    >
      {peekActive && (
        <div
          className="hermes-nav-peek-mask"
          onClick={startPeekClosing}
          onMouseEnter={startPeekClosing}
        />
      )}
      <div style={{ height: '100dvh', overflow: 'hidden' }}>
        <ProLayout
          style={{ height: '100dvh', minHeight: 0, background: '#fff' }}
          title="Hermes Agent"
          contentWidth="Fluid"
          fixedHeader
          fixSiderbar
          siderWidth={chatTokens.sidebarWidth}
          breakpoint="md"
          // 隐藏/窥视完全由 data-nav-hidden / data-nav-peek CSS 控制，
          // ProLayout 恒渲染展开态内容，窥视面板才能显示完整菜单与会话列表。
          collapsed={false}
          onCollapse={setCollapsed}
          // 自定义侧栏展开/收起按钮：替换默认圆形箭头，图标与对话区按钮统一。
          collapsedButtonRender={(collapsed) => (
            <button
              type="button"
              className="hermes-sidebar-toggle-button"
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              onClick={() => {
                setPeeking(false);
                setCollapsed(!collapsed);
              }}
              data-collapsed={collapsed}
            >
              <img src={sidebarToggleIcon} alt="" />
            </button>
          )}
          footerRender={false}
          contentStyle={{
            background: '#fff',
            padding: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
          token={{
            bgLayout: '#fff',
            header: { heightLayoutHeader: 56 },
            pageContainer: {
              colorBgPageContainer: '#fff',
              paddingInlinePageContainerContent: 0,
              paddingBlockPageContainerContent: 0,
            },
          }}
          location={location}
          menu={{ locale: false }}
          menuItemRender={(item, dom) =>
            item.path ? <Link to={item.path}>{dom}</Link> : dom
          }
          menuContentRender={(props, defaultDom) => (
            <>
              {isValidElement<{ style?: CSSProperties }>(defaultDom)
                ? cloneElement(defaultDom, {
                    // ProLayout's default min-height: 100% pushes the
                    // appended conversations below the entire sidebar.
                    style: {
                      ...defaultDom.props.style,
                      minHeight: 0,
                      height: 'auto',
                    },
                  })
                : defaultDom}
              {(!props.collapsed || props.isMobile) && (
                <aside
                  className={`${styles.menuConversations} hermes-menu-conversations`}
                  aria-label="侧栏会话列表"
                >
                  {conversations}
                </aside>
              )}
            </>
          )}
          // route={{
          //   routes: [{ path: '/', name: '首页', icon: <HomeOutlined /> }],
          // }}
        >
          <PageContainer
            title={false}
            pageHeaderRender={false}
            style={{ flex: 1, minHeight: 0 }}
            childrenContentStyle={{
              padding: 0,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <WorkbenchActionsContext.Provider
              value={{
                navHidden: collapsed,
                navigation: (
                  <Button
                    ref={navButtonRef}
                    type="text"
                    aria-label={collapsed ? '展开导航' : '隐藏导航'}
                    icon={
                      <img
                        src={sidebarToggleIcon}
                        alt=""
                        className={styles.sidebarToggleIcon}
                        data-collapsed={collapsed}
                      />
                    }
                    onMouseEnter={cancelPeekClosing}
                    onFocus={() => {
                      cancelPeekClosing();
                      if (collapsed) setPeeking(true);
                    }}
                    onClick={() => {
                      cancelPeekClosing();
                      setPeeking(false);
                      setCollapsed((value) => !value);
                    }}
                  >
                    {collapsed ? '展开导航' : '隐藏导航'}
                  </Button>
                ),
                close: (
                  <Button type="text" onClick={onCloseWorkspace}>
                    返回完整对话
                  </Button>
                ),
              }}
            >
              {children}
            </WorkbenchActionsContext.Provider>
          </PageContainer>
        </ProLayout>
      </div>
    </div>
  );
};

export default HermesLayout;
