import { createStyles } from 'antd-style';
import { chatTokens } from './chatTokens';
import { WORKSPACE_MOTION_MS } from './question-bank/workspaceMotion';

export const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  workspace: css`
    --hermes-chat-column: ${chatTokens.columnWidth}px;
    --hermes-chat-column-padding: ${chatTokens.columnPadding}px;
    --hermes-composer-column: ${chatTokens.composerWidth}px;
    --hermes-composer-max-height: min(${chatTokens.composerMaxHeight}px, calc(100dvh - 144px));
    --hermes-chat-paragraph-gap: ${chatTokens.paragraphGap}px;
    --hermes-chat-message-gap: ${chatTokens.messageGap}px;
    --hermes-chat-line-height: ${chatTokens.lineHeight}px;
    --hermes-chat-list-line-height: ${chatTokens.listLineHeight}px;
    --hermes-selection-bg: ${isDarkMode ? chatTokens.selectionDark : chatTokens.selectionLight};
    font-family: ${chatTokens.fontFamily};
    letter-spacing: normal;
    height: 100dvh;
    overflow: hidden;
    background: #fff;

    @media (max-width: 576px) {
      --hermes-chat-column-padding: 16px;
    }

    &::selection,
    & *::selection {
      background: var(--hermes-selection-bg);
      color: inherit;
      text-shadow: none;
    }

    .ant-pro-layout-container {
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: #fff;
    }

    /* 首帧不播放侧栏宽度/位置过渡，避免初始布局修正被动画化 */
    &:not([data-ready='true']) {
      .ant-pro-layout .ant-layout > div:has(+ .ant-pro-sider-fixed),
      .ant-pro-layout .ant-layout > .ant-pro-sider-fixed,
      .ant-pro-layout .ant-pro-layout-container {
        transition: none !important;
      }
    }

    @media (min-width: 768px) {
      /* ProLayout emits an anonymous width placeholder directly before its fixed sider. */
      .ant-pro-layout .ant-layout > div:has(+ .ant-pro-sider-fixed),
      .ant-pro-layout .ant-layout > .ant-pro-sider-fixed {
        visibility: visible;
        transition: width ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1), min-width ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1), max-width ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1), flex-basis ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1), opacity 160ms ease, visibility 0s linear !important;
      }
    }
    /* ===== 桌面专属侧栏方案（≥768px，flex 停靠布局） =====
       移动端（<768px）ProLayout 把侧栏渲染成 inline Drawer，DOM 结构不同，
       负边距/位移方案会把内容区推出屏幕，故全部限定在桌面断点内。 */
    @media (min-width: 768px) {
      /* 固定侧栏恒在内容层之上：隐藏/显示的滑动过程不被白色内容区盖住。 */
      .ant-pro-layout .ant-layout > .ant-pro-sider-fixed {
        z-index: 104 !important;
      }
      /* 折叠即完整隐藏侧栏：不限视口宽度，隐藏/展开在任意窗口尺寸下一致。
         侧栏本体 transform 滑出（豆包同款）；占位符宽度交给 ProLayout 管理，
         内容区用负边距动画平滑左移盖住空列（避免与 ProLayout JS 宽度竞争）。 */
      .ant-pro-layout .ant-pro-layout-container {
        transition: margin-inline-start ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1) !important;
      }
      &[data-nav-hidden='true'] .ant-pro-layout .ant-pro-layout-container {
        margin-inline-start: calc(-1 * ${chatTokens.sidebarWidth}px) !important;
      }
      &[data-nav-hidden='true'] .ant-pro-layout .ant-layout > .ant-pro-sider-fixed {
        transform: translateX(calc(-100% - 28px)) !important;
        opacity: 0; pointer-events: none;
        visibility: hidden;
        transition: transform ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1), opacity ${WORKSPACE_MOTION_MS}ms ease, visibility 0s linear ${WORKSPACE_MOTION_MS}ms !important;
      }
      /* 窥视态（收起时悬浮展开按钮）：侧栏内容以悬浮圆角面板出现在
         头部下方（对齐豆包），四周留边、带阴影；内容区不推挤、不变暗。
         属性选择器比隐藏规则多一层，优先级更高。
         面板自身不滚动：改为纵向 flex 容器，内部由「入口按钮固定 +
         会话列表内部滚动」分区（与停靠态一致，见下方 flex 链规则）。 */
      &[data-nav-peek='true'] .ant-pro-layout .ant-layout > .ant-pro-sider-fixed {
        position: fixed;
        /* 与触发按钮（y 6~38）留出 6px 间距，不重叠；
           高度自适应内容（菜单+会话列表），超过上限时由列表内部滚动。 */
        inset-block-start: 44px;
        inset-inline-start: 12px;
        width: ${chatTokens.sidebarWidth}px !important;
        min-width: ${chatTokens.sidebarWidth}px !important;
        max-width: ${chatTokens.sidebarWidth}px !important;
        height: auto !important;
        max-height: calc(100dvh - 56px) !important;
        transform: translateX(0) !important;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid ${token.colorBorderSecondary};
        border-radius: 12px;
        background: ${token.colorBgContainer};
        visibility: visible;
        opacity: 1;
        pointer-events: auto;
        z-index: 104;
        box-shadow:
          0 12px 32px -8px rgba(0, 0, 0, 0.18),
          0 4px 12px -4px rgba(25, 15, 15, 0.08);
        transition: transform ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1), opacity 160ms ease !important;
        transition-delay: 0s !important;
      }
      /* 退出淡出：鼠标移开时面板原位淡出（几何不变），
         淡出完成后才切回隐藏态（不可见瞬移，无感）。 */
      &[data-nav-peek='true'][data-nav-closing='true'] .ant-pro-layout .ant-layout > .ant-pro-sider-fixed {
        opacity: 0 !important;
        transition: opacity 150ms ease !important;
        transition-delay: 0s !important;
      }
      /* 窥视捕获层：透明，覆盖触发按钮以下的区域；
         悬浮/点击即关闭窥视（顶部按钮区除外，避免与面板间来回闪烁）。 */
      .hermes-nav-peek-mask {
        position: fixed;
        inset-block-start: 38px;
        inset-inline: 0;
        inset-block-end: 0;
        z-index: 103;
        background: transparent;
      }
      /* 窥视面板的会话列表底部留白（仅悬浮面板，停靠侧栏不变）。 */
      &[data-nav-peek='true'] .hermes-menu-conversations {
        padding-block-end: 16px;
      }
    }
    /* 侧栏纵向分区（停靠态与窥视悬浮面板共用）——头部菜单与
       「新建对话/智能组卷/作文助手」入口固定，会话列表在自身区域内
       滚动（数据多时不滚动整个侧栏/面板）。 */
    .ant-pro-layout
      .ant-layout
      > .ant-pro-sider-fixed
      .ant-layout-sider-children {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
    /* ProLayout 的菜单容器（无类名 div，默认 overflow-y:auto 会滚动整块）：
       改为纵向 flex 承载「菜单 + 会话列表」两段。排除 logo，避免其被拉伸。 */
    .ant-pro-layout
      .ant-layout
      > .ant-pro-sider-fixed
      .ant-layout-sider-children
      > div:not(.ant-pro-sider-logo) {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden !important;
    }
    /* logo 区固定高度，不参与剩余空间分配。 */
    .ant-pro-layout
      .ant-layout
      > .ant-pro-sider-fixed
      .ant-layout-sider-children
      > .ant-pro-sider-logo {
      flex: 0 0 auto;
    }
    /* 会话列表容器占满剩余高度，滚动交给内部 conversationList。 */
    .ant-pro-layout
      .ant-layout
      > .ant-pro-sider-fixed
      .ant-layout-sider-children
      > div:not(.ant-pro-sider-logo)
      > .hermes-menu-conversations {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
    /* 固定区（会话列表之外的菜单/按钮）不参与压缩。 */
    .ant-pro-layout
      .ant-layout
      > .ant-pro-sider-fixed
      .ant-layout-sider-children
      > div:not(.ant-pro-sider-logo)
      > :not(.hermes-menu-conversations) {
      flex: 0 0 auto;
    }
    /* ===== 移动端抽屉（<768px）：ProLayout 将侧栏渲染为 inline Drawer，
       sider 不再是 .ant-layout 直接子级，上方分区选择器不会命中；
       以下选择器在抽屉内重建「入口固定 + 会话列表内部滚动」分区。 ===== */
    @media (max-width: 767.98px) {
      .ant-drawer-content-wrapper .ant-drawer-body {
        padding: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .ant-drawer-content-wrapper .ant-drawer-body > .ant-pro-drawer-sider,
      .ant-drawer-content-wrapper .ant-drawer-body .ant-layout-sider {
        flex: 1 1 auto;
        min-height: 0;
        height: auto;
        max-height: 100%;
      }
      .ant-drawer-content-wrapper .ant-layout-sider-children {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      .ant-drawer-content-wrapper
        .ant-layout-sider-children
        > .ant-pro-sider-logo {
        flex: 0 0 auto;
      }
      .ant-drawer-content-wrapper
        .ant-layout-sider-children
        > div:not(.ant-pro-sider-logo) {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden !important;
      }
      .ant-drawer-content-wrapper
        .ant-layout-sider-children
        > div:not(.ant-pro-sider-logo)
        > .hermes-menu-conversations {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      .ant-drawer-content-wrapper
        .ant-layout-sider-children
        > div:not(.ant-pro-sider-logo)
        > :not(.hermes-menu-conversations) {
        flex: 0 0 auto;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ant-pro-layout .ant-layout > div:has(+ .ant-pro-sider-fixed),
      .ant-pro-layout .ant-layout > .ant-pro-sider-fixed { transition: none !important; }
    }

    /* 侧栏展开/收起时禁止 ProLayout 对 logo 与标题施加旋转动画。 */
    .ant-pro-sider .ant-pro-sider-logo,
    .ant-pro-sider .ant-pro-sider-logo h1,
    .ant-pro-sider .ant-pro-sider-logo img,
    .ant-pro-sider .ant-pro-sider-logo svg {
      transform: none !important;
      transition: none !important;
      animation: none !important;
    }

    /* 自定义侧栏展开/收起按钮：展开时位于菜单栏内部右上角，
       图标替换为定制侧栏图形（assets/sidebar-toggle.png）。 */
    .hermes-sidebar-toggle-button {
      position: absolute;
      inset-block-start: 14px;
      inset-inline-end: 8px;
      z-index: 101;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 40px;
      background: ${token.colorBgContainer};
      box-shadow:
        0 2px 8px -2px rgba(0, 0, 0, 0.05),
        0 1px 4px -1px rgba(25, 15, 15, 0.07),
        0 0 1px 0 rgba(0, 0, 0, 0.08);
      cursor: pointer;

      &:hover {
        box-shadow:
          0 4px 16px -4px rgba(0, 0, 0, 0.05),
          0 2px 8px -2px rgba(25, 15, 15, 0.07),
          0 1px 2px 0 rgba(0, 0, 0, 0.08);
      }

      img {
        display: block;
        width: 20px;
        height: 20px;
      }

      &[data-collapsed='true'] img {
        transform: scaleX(-1);
      }
    }

    .ant-pro-page-container,
    .ant-pro-grid-content,
    .ant-pro-grid-content-children {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      min-width: 0;
    }
  `,

  menuConversations: css`
    margin: ${token.marginXS}px ${token.marginXS}px 0;
    /* padding-top: ${token.paddingXS}px; */
    /* border-top: 1px solid ${token.colorBorderSecondary}; */
    min-width: 0;
  `,

  /* 会话列表滚动区：停靠态在侧栏剩余高度内独立滚动（按钮固定）。
     滚动条默认隐去，仅在滚动期间显示（onScroll 切换 data-scrolling，
     停止滚动 600ms 后自动隐藏）。scrollbar-gutter 预留宽度避免抖动。
     Chromium/Safari 走 ::-webkit-scrollbar（自定义后由 overlay 变为
     可着色滚动条）；标准 scrollbar-color 需隔离到 Firefox，否则会
     覆盖伪元素自定义导致滚动条始终不可见。 */
  conversationList: css`
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-block-end: 8px;
    scrollbar-gutter: stable;

    @supports (-moz-appearance: none) {
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }

    &::-webkit-scrollbar {
      width: 8px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: transparent;
      border-radius: 4px;
    }

    &[data-scrolling='true'] {
      @supports (-moz-appearance: none) {
        scrollbar-color: ${token.colorFill} transparent;
      }

      &::-webkit-scrollbar-thumb {
        background: ${token.colorFill};
      }
    }
  `,

  conversationActions: css`
    padding-bottom: 0;
    /* 按钮容器不可滚动：入口按钮固定展示，避免出现多余滚动条。
       （antd Conversations 根元素自带 overflow 样式，需提高优先级。） */
    overflow: visible !important;

    .ant-conversations-creation {
      width: 100%;
      margin-bottom: 0;
    }
  `,

  paperActionInactive: css`
    &.ant-conversations-creation:not(.ant-conversations-creation-disabled) {
      color: ${token.colorText};
      background: transparent;
      border-color: ${token.colorBorder};

      &:hover {
        color: ${token.colorText};
        background: ${token.colorFillTertiary};
      }
    }
  `,

  /* 会话项三点左侧的「后台流式输出」loading 指示（menu.trigger 包裹）。 */
  conversationStreamingBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    color: ${token.colorPrimary};
  `,

  paperPage: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: #f5f7fa;
    padding: ${token.paddingLG}px;
    scrollbar-gutter: stable;

    @media (max-width: 576px) {
      padding: ${token.paddingSM}px;
    }
  `,

  paperContent: css`
    flex-shrink: 0;
    width: 100%;
    max-width: 960px;
    margin: auto;
  `,

  paperHeading: css`
    display: flex;
    flex-direction: column;
    gap: ${token.marginXS}px;
    margin-bottom: ${token.marginLG}px;
    text-align: center;
  `,

  paperCard: css`
    background: #fff;
  `,

  paperSubmit: css`
    display: flex;
    justify-content: center;
    margin-top: ${token.marginMD}px;

    > button {
      width: 180px;
      max-width: 100%;
    }
  `,

  paperFields: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: ${token.marginLG}px;

    > .ant-form-item {
      min-width: 0;
    }

    @media (max-width: 767px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,

  layout: css`
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  `,

  sidebar: css`
    width: 260px;
    flex-shrink: 0;
    background: ${token.colorBgContainer};
    border-right: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    overflow: hidden;

    @media (max-width: 768px) {
      width: 180px;
    }

    @media (max-width: 480px) {
      width: 132px;
    }
  `,

  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: ${token.colorBgContainer};
  `,

  messages: css`
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;

    @media (prefers-reduced-motion: no-preference) {
      animation: hermes-messages-in 180ms ease-out;
    }

    @keyframes hermes-messages-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    > * {
      width: 100%;
    }

    @media (max-width: 768px) {
      padding: 0;
    }
  `,

  assistantWelcome: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    width: 100%;
    padding: 16px max(var(--hermes-chat-column-padding), calc((100% - var(--hermes-chat-column)) / 2)) 24px;

    @media (prefers-reduced-motion: no-preference) {
      animation: hermes-welcome-message-in 180ms ease-out;
    }

    @keyframes hermes-welcome-message-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,

  messageList: css`
    && .ant-bubble-list-scroll-box {
      height: 100%;
      scrollbar-gutter: stable;
    }

    && .ant-bubble {
      padding: 0;
      width: min(calc(100% - var(--hermes-chat-column-padding) * 2 + var(--hermes-scrollbar-width, 0px)), var(--hermes-chat-column));
      margin-inline: auto;
      transform: translateX(calc(var(--hermes-scrollbar-width, 0px) / 2));
    }

    && .ant-bubble-start:not(.ant-bubble-divider):not(.ant-bubble-system),
    && .ant-bubble-end:not(.ant-bubble-divider):not(.ant-bubble-system) {
      padding-inline: 0;
    }

    && .ant-bubble-list-scroll-content {
      gap: var(--hermes-chat-message-gap);
      width: 100%;
      min-height: 0;
      padding: 16px 0 24px;
      flex: 1 0 auto;
    }

    .ant-bubble-content {
      letter-spacing: normal;
    }
  `,

  composer: css`
    width: 100%;
    max-width: var(--hermes-composer-column);
    max-height: var(--hermes-composer-max-height);
    flex-shrink: 0;

    &&.ant-sender-main {
      display: flex;
      flex-direction: column;
      border: 0;
      border-radius: ${chatTokens.composerRadius}px;
      background: ${token.colorBgContainer};
      box-shadow: ${chatTokens.composerShadow};
    }

    && .ant-sender-content {
      min-height: 0;
      padding: 16px 16px 0;
      flex: 1 1 auto;
      align-items: stretch;
      overflow: hidden;
    }

    && .ant-sender-footer {
      flex: 0 0 auto;
      padding: 12px 16px;
    }

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      border: 1px solid ${isDarkMode ? 'rgb(255 255 255 / 16%)' : 'rgb(0 0 0 / 10%)'};
      border-radius: inherit;
      pointer-events: none;
      box-shadow: 0 2px 4px rgb(0 0 0 / 2%);
      transition: border-color 150ms, box-shadow 150ms;
    }

    &:focus-within::after {
      border-color: rgb(0 102 255 / 30%);
      box-shadow: 0 0 0 2px rgb(0 102 255 / 15%);
    }

    && .ant-sender-input {
      font-size: 16px;
      line-height: 24px;
      padding: 0;
      min-height: 24px;
      max-height: calc(var(--hermes-composer-max-height) - ${chatTokens.composerChromeHeight}px) !important;
      overflow-y: auto !important;
      color: ${token.colorText};
    }

    .ant-sender-input::placeholder {
      color: ${token.colorTextPlaceholder};
    }

    @media (prefers-reduced-motion: reduce) {
      &::after { transition: none; }
    }
  `,

  composerToolbar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 36px;
  `,

  composerToolbarRight: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,

  composerHint: css`
    font-size: 12px;
    line-height: 18px;
    color: ${token.colorTextTertiary};
  `,

  /* 对话区「展开/隐藏导航」按钮的自定义侧栏图标（侧栏隐藏时它在菜单栏外）。 */
  sidebarToggleIcon: css`
    display: block;
    width: 20px;
    height: 20px;

    &[data-collapsed='true'] {
      transform: scaleX(-1);
    }
  `,

  /* 侧栏隐藏时聊天视图顶部的展开入口条（复用 layout 注入的导航按钮）。 */
  navExpandBar: css`
    display: flex;
    align-items: center;
    /* 固定定位在左上角（头部下方）：位置确定、始终可悬浮，
       不受隐藏态占位符宽度波动影响。仅隐藏态渲染，不与展开态侧栏重叠。 */
    position: fixed;
    inset-block-start: 6px;
    inset-inline-start: 12px;
    /* 高于窥视捕获层(103)与面板(104)：窥视打开时指针仍命中按钮本体，
       避免捕获层盖住按钮导致「开→关」循环闪烁。 */
    z-index: 105;
    /* 收起后随侧栏滑出淡入，消除瞬间出现感。 */
    animation: hermes-nav-fade-in 200ms ease 100ms backwards;
    @keyframes hermes-nav-fade-in {
      from {
        opacity: 0;
      }
    }
    /* 桥接按钮与窥视面板之间的空隙：鼠标穿过间隙命中桥接层
       （属于本元素、z 105），不会误命中捕获层导致窥视关闭。 */
    &::after {
      content: '';
      position: absolute;
      inset-block-start: 100%;
      inset-inline: 0;
      height: 10px;
    }
  `,

  userRow: css`
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    width: 100%;
    min-width: 0;

    &:hover [data-user-actions],
    &:focus-within [data-user-actions],
    [data-user-actions][data-menu-open='true'] {
      opacity: 1;
      pointer-events: auto;
    }
  `,

  userActions: css`
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    opacity: 0;
    pointer-events: none;

    .ant-btn {
      flex: 0 0 32px;
      width: 32px;
      height: 32px;
      color: ${token.colorText};
    }

    @media (hover: none), (pointer: coarse) {
      opacity: 1;
      pointer-events: auto;

      .ant-btn {
        flex-basis: 44px;
        width: 44px;
        height: 44px;
      }
    }
  `,

  userBubble: css`
    width: fit-content;
    max-width: min(${chatTokens.userMaxWidth}px, 72%);
    min-width: 0;
    padding: ${chatTokens.userPadding};
    border: 0;
    border-radius: ${chatTokens.userRadius}px;
    box-shadow: none;
    background: ${token.colorFillTertiary};
    color: ${isDarkMode ? 'rgb(255 255 255 / 85%)' : 'rgb(0 0 0 / 85%)'};
    overflow-wrap: anywhere;

    @media (max-width: 576px) {
      max-width: 90%;
    }
  `,

  /* 消息内的图片附件：缩略图适中，多张时横向滑动，点击走 antd 预览。 */
  userAttachmentImages: css`
    display: flex;
    gap: 8px;
    width: 100%;
    min-width: 0;
    margin-top: 8px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: 2px;

    .ant-image {
      flex-shrink: 0;
    }

    .ant-image-img {
      display: block;
      cursor: zoom-in;
    }

    &::-webkit-scrollbar {
      height: 6px;
    }

    &::-webkit-scrollbar-thumb {
      border-radius: 3px;
      background: ${token.colorFill};
    }
  `,

  userText: css`
    font-family: inherit;
    font-size: ${chatTokens.fontSize}px;
    font-style: normal;
    font-weight: 400;
    line-height: ${chatTokens.listLineHeight}px;
    letter-spacing: normal;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,

  returnToBottom: css`
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 50%;
    background: ${token.colorBgContainer};
    color: ${token.colorText};
    box-shadow: ${token.boxShadowSecondary};
    cursor: pointer;

    &:hover {
      color: ${token.colorPrimary};
    }
  `,

  footer: css`
    flex-shrink: 0;
    padding: 16px 16px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  `,

  /* 空态欢迎区：占消息区并垂直居中（输入框始终固定在底部） */
  welcomeArea: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    gap: 32px;

    @media (prefers-reduced-motion: no-preference) {
      animation: hermes-welcome-in 180ms ease-out;
    }

    @keyframes hermes-welcome-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,

  welcomeTitle: css`
    font-size: 32px;
    font-weight: 600;
    color: ${token.colorText};
    text-align: center;

    @media (max-width: 768px) {
      font-size: 24px;
    }
  `,

  cursor: css`
    animation: hermes-blink 0.8s step-end infinite;

    @keyframes hermes-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `,

  assistantContent: css`
    width: 100%;
    min-width: 0;
    align-items: stretch;
  `,

  processTrace: css`
    width: 100%; min-width: 0; container-type: inline-size; container-name: hermes-process;
    &[data-process-state='error'] > .ant-think-status-wrapper { color: ${token.colorError}; }
    &[data-process-state='waiting'] > .ant-think-status-wrapper { color: ${token.colorWarning}; }
    @media (prefers-reduced-motion: reduce) {
      .anticon-spin, .anticon-loading { animation: none !important; }
    }
  `,

  processSummary: css`
    && { width: 100%; min-width: 0; padding-bottom: 8px; border-bottom: 1px solid ${token.colorBorderSecondary}; font-size: 14px; line-height: 22px; }
    .ant-think-status-text { flex: 1; min-width: 0; }
    .ant-think-status-icon, .ant-think-status-down-icon { flex-shrink: 0; }
  `,

  processContent: css`min-width: 0; color: ${token.colorTextSecondary};`,
  processBlocks: css`display: flex; flex-direction: column; gap: 12px; min-width: 0;`,
  traceToggle: css`
    display: block; min-width: 0; max-width: 100%; padding: 0; border: 0; background: transparent;
    color: inherit; font: inherit; line-height: inherit; text-align: start; cursor: pointer;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    &:focus-visible { outline: 2px solid ${token.colorPrimary}; outline-offset: 2px; border-radius: 3px; }
    @container hermes-process (max-width: 480px) { white-space: normal; overflow-wrap: anywhere; text-overflow: clip; }
  `,

  toolChain: css`
    width: 100%;
    min-width: 0;

    && .ant-thought-chain-node { min-width: 0; padding-bottom: 12px; }
    && .ant-thought-chain-node:last-child { padding-bottom: 0; }
    && .ant-thought-chain-node-box { flex: 1; min-width: 0; }
    && .ant-thought-chain-node-title { min-width: 0; color: ${token.colorText}; font-size: 14px; line-height: 22px; font-weight: 500; }
    && .ant-thought-chain-node-collapse-icon { flex-shrink: 0; }
    && .ant-thought-chain-node-description { margin: 0; font-size: 12px; line-height: 20px; }
    && .ant-thought-chain-node-content-box { margin-bottom: 0; }
  `,

  toolChainHeader: css`
    && { display: flex; flex-direction: column; align-items: stretch; gap: 2px; min-width: 0; }
  `,

  toolDescription: css`display: flex; align-items: baseline; gap: 8px; min-width: 0; color: ${token.colorTextSecondary}; > :first-child { flex-shrink: 0; }`,
  toolProgressText: css`min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; @container hermes-process (max-width: 480px) { white-space: normal; overflow-wrap: anywhere; }`,
  toolPercent: css`flex-shrink: 0; font-variant-numeric: tabular-nums;`,
  toolDetails: css`display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 12px; margin-top: 8px; border-radius: 8px; background: ${token.colorFillAlter}; color: ${token.colorTextSecondary}; font-size: 13px; line-height: 22px;`,
  toolName: css`font-family: ${chatTokens.codeFontFamily}; font-size: 12px; line-height: 20px; overflow-wrap: anywhere;`,
  toolLog: css`white-space: pre-wrap; overflow-wrap: anywhere;`,
  reasoningThink: css`
    min-width: 0;
    && .ant-think-status-wrapper { min-width: 0; max-width: 100%; color: ${token.colorTextSecondary}; font-size: 13px; line-height: 22px; }
    .ant-think-status-text { min-width: 0; }
    .ant-think-status-down-icon { flex-shrink: 0; }
  `,

  reasoningText: css`
    margin-block: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 13px;
    line-height: 22px;
    color: ${token.colorTextSecondary};
  `,

  thinkingSpinner: css`
    animation: hermes-thinking-spin 1s linear infinite;
    @media (prefers-reduced-motion: reduce) { animation: none; }

    @keyframes hermes-thinking-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,

  answer: css`
    width: 100%;
    min-width: 0;
    color: ${isDarkMode ? token.colorText : '#000'};
    overflow-wrap: anywhere;

    .x-markdown {
      font-family: inherit;
      font-size: ${chatTokens.fontSize}px;
      font-weight: 400;
      font-style: normal;
      line-height: var(--hermes-chat-line-height);
      letter-spacing: normal;
      color: inherit;
    }

    .x-markdown > * {
      margin-block: 0 var(--hermes-chat-paragraph-gap);
    }

    .x-markdown > :last-child {
      margin-bottom: 0;
    }

    /* 欢迎消息内的示例链接（#hermes-prompt=…）：主题蓝（与助手入口选中色一致）。 */
    .x-markdown a[href^='#hermes-prompt='] {
      color: ${token.colorPrimary};
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }

    .x-markdown :is(h1, h2, h3, h4, h5, h6) {
      margin-top: 0;
      font-weight: 600;
      line-height: 28px;
    }

    .x-markdown h1 { font-size: 20px; }
    .x-markdown h2 { font-size: 18px; }
    .x-markdown :is(h3, h4, h5, h6) { font-size: 16px; }
    .x-markdown strong { font-weight: 700; }

    .x-markdown :is(ul, ol) {
      padding-left: 20px;
      line-height: var(--hermes-chat-list-line-height);
    }

    .x-markdown ul { list-style-type: disc; }
    .x-markdown ol { list-style-type: decimal; }

    .x-markdown li {
      margin-block: 0 ${chatTokens.listItemGap}px;
      line-height: var(--hermes-chat-list-line-height);
    }

    .x-markdown li:last-child { margin-bottom: 0; }
    .x-markdown li > p { margin-block: 0; }
    .x-markdown li > :is(ol, ul) { margin-block: 8px 0; }

    .x-markdown blockquote {
      padding: 0 12px;
      color: ${token.colorTextSecondary};
      border-inline-start: 3px solid ${token.colorBorderSecondary};
      line-height: 24px;
    }

    .x-markdown blockquote > :last-child { margin-bottom: 0; }

    .x-markdown pre {
      margin-top: 0;
      padding: 12px 16px;
      background: ${token.colorFillQuaternary};
      border-radius: ${token.borderRadiusLG}px;
      font-size: 14px;
      line-height: 22px;
    }

    .x-markdown :is(pre, code, kbd, samp) {
      font-family: ${chatTokens.codeFontFamily};
    }

    &&& .x-markdown pre code {
      font-size: 14px;
      line-height: 22px;
    }

    .x-markdown .katex { font-size: 1.21em; }
    .x-markdown .katex-display {
      margin-block: 8px;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .x-markdown .inline-katex {
      display: inline;
    }

    .x-markdown .inline-katex > .katex {
      display: inline;
    }

    .x-markdown .inline-katex > .katex-display {
      display: inline-block;
      margin: 0;
      vertical-align: middle;
    }

    .x-markdown table {
      display: block;
      max-width: 100%;
      overflow-x: auto;
    }

    .x-markdown :is(th, td) {
      padding: 8px 12px;
      border-bottom: 1px solid ${token.colorBorderSecondary};
      line-height: 24px;
    }

    pre {
      max-width: 100%;
      overflow-x: auto;
    }
  `,

  attachments: css`
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    min-width: 0;
  `,

  attachmentCard: css`
    width: min(100%, 360px);
    min-width: 0;

    && .ant-file-card-file {
      width: 100%;
      min-width: 0;
      padding: 12px 16px;
    }

    .ant-file-card-file-content {
      flex: 1;
      min-width: 0;
    }

    .ant-file-card-file-description {
      margin-top: 4px;
      margin-bottom: 0;
    }
  `,

  attachmentDescription: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-width: 0;
    font-size: 12px;
    line-height: 18px;
    color: ${token.colorTextSecondary};

    .ant-btn { flex-shrink: 0; }
  `,

  statusLine: css`
    padding-inline-start: 4px;
    font-size: ${token.fontSizeSM}px;
    overflow-wrap: anywhere;
  `,

  approvalCard: css`
    width: min(100%, 560px);
    border-radius: ${token.borderRadius}px;
  `,

  approvalText: css`
    margin-block: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,

  approvalCommand: css`
    max-width: 100%;
    margin: 0;
    padding: ${token.paddingSM}px;
    overflow-x: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: ${token.colorText};
    background: ${token.colorFillTertiary};
    border-radius: ${token.borderRadiusSM}px;
  `,
}));
