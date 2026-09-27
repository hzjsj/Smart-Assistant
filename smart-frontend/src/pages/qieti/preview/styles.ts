import { createStyles } from 'antd-style';

/**
 * 原型预览页样式：布局与配色照搬 test/qieti/index.tsx 的内联样式，
 * 仅把内联写法改为 createStyles（数值原样保留：边框 #eee、选中行 #f0f8ff）
 */
export const useStyles = createStyles(({ token, css }) => ({
  stage: css`
    display: flex;
    gap: ${token.margin};
    align-items: flex-start;
  `,
  canvasColumn: css`
    width: 50%;
    flex-shrink: 0;
  `,
  canvasWrap: css`
    border: 1px solid #eee;
    background-repeat: no-repeat;
    background-size: 100% auto;
    background-position: left top;
  `,
  dataPanel: css`
    flex: 1;
    min-width: 0;
    padding: 20px;
    border: 1px solid #eee;
    border-radius: ${token.borderRadiusLG};
    max-height: calc(100vh - 260px);
    overflow-y: auto;
  `,
  dataRow: css`
    margin: 8px 0;
    padding: 8px;
    border-radius: 4px;
    &.selected {
      background: #f0f8ff;
    }
  `,
}));
