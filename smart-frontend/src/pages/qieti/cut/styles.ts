import { createStyles } from 'antd-style';

/** 划题交互样式（移植自 smart-question-bank globals.css，颜色改用 antd token） */
export const useStyles = createStyles(({ token, css }) => ({
  workbench: css`
    display: flex;
    flex-direction: column;
    gap: ${token.margin};
    height: calc(100vh - 216px);
    min-height: 480px;
  `,
  workbenchRow: css`
    flex: 1;
    min-height: 0;
    display: flex;
    gap: ${token.margin};
  `,
  leftPanel: css`
    flex: 1;
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
    &.active {
      border-color: ${token.colorPrimaryBorder};
    }
  `,
  pageTitle: css`
    font-size: ${token.fontSizeSM};
    color: ${token.colorTextSecondary};
    margin-bottom: ${token.marginXS};
  `,
  pageStage: css`
    line-height: 0;
  `,
  thumbDock: css`
    position: fixed;
    right: ${token.margin};
    bottom: ${token.margin};
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: ${token.marginXS};
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
    width: 420px;
    flex-shrink: 0;
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
  mathImage: css`
    max-width: 100%;
    border-radius: ${token.borderRadius};
    margin: ${token.marginXS} 0;
  `,
}));
