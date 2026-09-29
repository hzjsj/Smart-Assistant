import { createStyles } from 'antd-style';

/** 划题交互样式（移植自 smart-question-bank globals.css，颜色改用 antd token） */
export const useStyles = createStyles(({ token, css }) => ({
  workbench: css`
    display: flex;
    flex-direction: column;
    gap: ${token.margin}px;
    /* 抵消 ProLayout 内容区内边距（上32/左右40/下32），本页自控 12px 呼吸边距，
       画布空间最大化；仅作用于本页，不影响其他页面 */
    margin: -32px -40px -32px;
    padding: 12px 4px;
    /* 56 顶部导航 + 12 下留白（盒内另有 12px padding 与四周一致） */
    height: calc(100vh - 56px);
    min-height: 480px;
    /* 为右侧 Win10 导航栏腾出空间（随收起/展开平滑过渡） */
    padding-right: calc(4px + var(--qieti-nav-w, 0px));
    transition: padding-right 0.25s ease;
  `,
  splitter: css`
    flex: 1;
    min-height: 0;
  `,
  leftPanel: css`
    height: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: ${token.margin}px;
  `,
  viewerCard: css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
  headText: css`
    color: ${token.colorText};
  `,
  stemImage: css`
    margin-top: ${token.marginXS}px;
  `,
  pageInput: css`
    width: 44px;
    text-align: center;
  `,
  canvasWrap: css`
    flex: 1;
    overflow: auto;
    /* 与右侧题目列表最外层 8px 左右对称 */
    padding: ${token.paddingXS}px;
    background: ${token.colorBgLayout};
  `,
  /* 合并浮动操作条：sticky 吸顶悬浮（height 0 不占布局空间），内容居中 */
  mergeBarSticky: css`
    position: sticky;
    top: 16px;
    z-index: 30;
    display: flex;
    justify-content: center;
    height: 0;
    pointer-events: none;
  `,
  mergeActionBar: css`
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 260px;
    min-height: 64px;
    padding: 14px 18px 14px 26px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 999px;
    box-shadow:
      0 6px 24px rgba(0, 21, 41, 0.14),
      0 1px 3px rgba(0, 21, 41, 0.08);
  `,
  mergeBarText: css`
    font-size: ${token.fontSize}px;
    color: ${token.colorTextSecondary};
    white-space: nowrap;
  `,
  mergeBarCount: css`
    margin: 0 4px;
    font-size: 18px;
    font-weight: 700;
    color: ${token.colorPrimary};
  `,
  mergeBarDivider: css`
    width: 1px;
    height: 20px;
    background: ${token.colorBorderSecondary};
  `,
  /* 合并/解除合并确认：内联遮罩 + 居中卡片（无传送门无动画，行为可靠） */
  confirmOverlay: css`
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
  `,
  confirmCard: css`
    width: 430px;
    max-width: calc(100vw - 48px);
    background: ${token.colorBgContainer};
    border-radius: ${token.borderRadiusLG}px;
    box-shadow: ${token.boxShadowSecondary};
    padding: ${token.paddingLG}px;
  `,
  confirmTitle: css`
    font-size: ${token.fontSizeLG}px;
    font-weight: 600;
    margin-bottom: ${token.margin}px;
  `,
  confirmBody: css`
    color: ${token.colorText};
    line-height: 1.7;
  `,
  confirmWarning: css`
    margin-top: ${token.margin}px;
    color: ${token.colorWarning};
  `,
  confirmActions: css`
    display: flex;
    justify-content: flex-end;
    gap: ${token.marginXS}px;
    margin-top: ${token.marginLG}px;
  `,
  pageBlock: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
    padding: ${token.paddingSM}px;
    margin-bottom: ${token.margin}px;
    /* 缩放放大时卡片随内容延展，横向滚动由 canvasWrap 承担 */
    min-width: fit-content;
    &.active {
      border-color: ${token.colorPrimaryBorder};
    }
  `,
  pageStage: css`
    line-height: 0;
  `,
  thumbDock: css`
    position: fixed;
    right: calc(${token.margin}px + var(--qieti-nav-w, 0px));
    bottom: ${token.margin}px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: ${token.marginXS}px;
    transition: right 0.25s ease;
  `,
  thumbs: css`
    display: flex;
    gap: ${token.marginXS}px;
    max-width: 40vw;
    overflow-x: auto;
    padding: ${token.paddingXS}px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    box-shadow: ${token.boxShadowTertiary};
  `,
  thumb: css`
    flex-shrink: 0;
    width: 64px;
    height: 88px;
    border: 2px solid transparent;
    border-radius: ${token.borderRadius}px;
    overflow: hidden;
    cursor: pointer;
    background: ${token.colorBgLayout};
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    &.active {
      border-color: ${token.colorPrimary};
    }
  `,
  rightPanel: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
  questionList: css`
    flex: 1;
    overflow-y: auto;
  `,
  questionItem: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    padding: ${token.paddingSM}px;
    /* 相邻题目间距：紧凑一些 */
    margin-bottom: ${token.marginXS}px;
    cursor: pointer;
    transition: border-color 0.2s;
    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
    }
    /* 多选态：左侧蓝竖条 + 蓝描边（Ctrl+点选合并用） */
    &.selected {
      border-color: ${token.colorPrimary};
      box-shadow: inset 3px 0 0 ${token.colorPrimary};
      background: rgba(0, 79, 255, 0.03);
    }
    /* 选中态（主选中）：对齐 test/qieti 原型的选中行高亮 */
    &.active {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  qRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${token.marginXS}px;
    margin-bottom: ${token.marginXS}px;
  `,
  qId: css`
    font-size: ${token.fontSizeSM}px;
    color: ${token.colorTextSecondary};
  `,
  /* 图片按钮（收起态）：主题色浅蓝背景 + 主题色文字 */
  imageBtn: css`
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
    border-color: ${token.colorPrimaryBorder};
    &:hover,
    &:focus {
      color: ${token.colorPrimaryHover};
      background: ${token.colorPrimaryBgHover};
      border-color: ${token.colorPrimaryBorderHover};
    }
  `,
  /* Win10 风格右侧导航栏：贴边窄条、图标按钮、可滑出收起 */
  sideNav: css`
    position: fixed;
    top: 56px;
    right: 0;
    bottom: 0;
    width: 56px;
    z-index: 1100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: ${token.paddingXS}px 0;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    transition: transform 0.25s ease;
  `,
  sideNavHidden: css`
    transform: translateX(105%);
  `,
  sideNavBtn: css`
    width: 40px;
    height: 40px;
    font-size: 18px;
  `,
  sideNavBtnActive: css`
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
    &:hover {
      background: ${token.colorPrimaryBgHover};
    }
  `,
  sideNavDivider: css`
    width: 32px;
    height: 1px;
    background: ${token.colorBorderSecondary};
    margin: 4px 0;
  `,
  sideNavSpacer: css`
    flex: 1;
  `,
  sideNavTab: css`
    position: fixed;
    top: 64px;
    right: 0;
    z-index: 1100;
  `,
  mathImage: css`
    max-width: 100%;
    border-radius: ${token.borderRadius}px;
    margin: ${token.marginXS}px 0;
  `,
}));
