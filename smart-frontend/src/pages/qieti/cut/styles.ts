import { createStyles } from 'antd-style';

/** 划题交互样式（移植自 smart-question-bank globals.css，颜色改用 antd token） */
export const useStyles = createStyles(({ token, css }) => ({
  workbench: css`
    display: flex;
    flex-direction: column;
    gap: ${token.margin};
    /* 去掉页头后几乎占满视口（顶部导航 56 + 布局上下留白 48） */
    height: calc(100vh - 104px);
    min-height: 480px;
    /* 为右侧 Win10 导航栏腾出空间（随收起/展开平滑过渡） */
    padding-right: var(--qieti-nav-w, 0px);
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
    gap: ${token.margin};
  `,
  viewerCard: css`
    flex: 1;
    min-width: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG};
    background: ${token.colorBgContainer};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
  viewerHead: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${token.marginSM};
    padding: ${token.paddingSM} ${token.padding};
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  canvasWrap: css`
    flex: 1;
    overflow: auto;
    padding: ${token.padding};
    background: ${token.colorBgLayout};
  `,
  pageBlock: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG};
    background: ${token.colorBgContainer};
    padding: ${token.paddingSM};
    margin-bottom: ${token.margin};
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
    right: calc(${token.margin} + var(--qieti-nav-w, 0px));
    bottom: ${token.margin};
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: ${token.marginXS};
    transition: right 0.25s ease;
  `,
  thumbs: css`
    display: flex;
    gap: ${token.marginXS};
    max-width: 40vw;
    overflow-x: auto;
    padding: ${token.paddingXS};
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG};
    box-shadow: ${token.boxShadowTertiary};
  `,
  thumb: css`
    flex-shrink: 0;
    width: 64px;
    height: 88px;
    border: 2px solid transparent;
    border-radius: ${token.borderRadius};
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
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG};
    background: ${token.colorBgContainer};
    overflow: hidden;
  `,
  panelTitle: css`
    padding: ${token.paddingSM} ${token.padding};
    font-weight: 600;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  questionList: css`
    flex: 1;
    overflow-y: auto;
    padding: ${token.paddingSM};
  `,
  questionItem: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG};
    padding: ${token.paddingSM};
    margin-bottom: ${token.marginSM};
    cursor: pointer;
    transition: border-color 0.2s;
    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
    }
    /* 选中态：对齐 test/qieti 原型的选中行高亮 */
    &.active {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  qRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${token.marginXS};
    margin-bottom: ${token.marginXS};
  `,
  qId: css`
    font-size: ${token.fontSizeSM};
    color: ${token.colorTextSecondary};
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
    padding: ${token.paddingXS} 0;
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
    border-radius: ${token.borderRadius};
    margin: ${token.marginXS} 0;
  `,
}));
