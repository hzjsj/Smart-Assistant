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
    position: relative;
  `,
  pageImage: css`
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  `,
  overlay: css`
    position: absolute;
    inset: 0;
    cursor: crosshair;
  `,
  rect: css`
    position: absolute;
    border: 1.5px solid ${token.colorPrimaryBorderHover};
    background: rgba(0, 79, 255, 0.08);
    user-select: none;
    cursor: move;
    &.active {
      border-color: ${token.colorPrimary};
      background: rgba(0, 79, 255, 0.12);
      box-shadow:
        0 0 0 1px rgba(0, 79, 255, 0.15),
        0 0 0 4px rgba(0, 79, 255, 0.08);
    }
  `,
  rectLabel: css`
    position: absolute;
    top: -20px;
    right: 0;
    background: rgba(0, 79, 255, 0.2);
    color: ${token.colorTextLightSolid};
    font-size: 12px;
    line-height: 20px;
    padding: 0 6px;
    border-radius: 4px 4px 0 0;
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    &.active {
      background: ${token.colorPrimary};
      color: #fff;
    }
  `,
  rectRemove: css`
    border: 0;
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
    width: 16px;
    height: 16px;
    line-height: 16px;
    padding: 0;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    &:hover {
      background: ${token.colorError};
    }
  `,
  handle: css`
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #fff;
    border: 1.5px solid ${token.colorPrimary};
    &.nw {
      top: -4px;
      left: -4px;
      cursor: nwse-resize;
    }
    &.n {
      top: -4px;
      left: calc(50% - 4px);
      cursor: ns-resize;
    }
    &.ne {
      top: -4px;
      right: -4px;
      cursor: nesw-resize;
    }
    &.e {
      top: calc(50% - 4px);
      right: -4px;
      cursor: ew-resize;
    }
    &.se {
      bottom: -4px;
      right: -4px;
      cursor: nwse-resize;
    }
    &.s {
      bottom: -4px;
      left: calc(50% - 4px);
      cursor: ns-resize;
    }
    &.sw {
      bottom: -4px;
      left: -4px;
      cursor: nesw-resize;
    }
    &.w {
      top: calc(50% - 4px);
      left: -4px;
      cursor: ew-resize;
    }
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
