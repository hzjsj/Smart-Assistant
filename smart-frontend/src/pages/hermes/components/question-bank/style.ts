import { createStyles } from 'antd-style';
import { WORKSPACE_MOTION_MS } from '../../question-bank/workspaceMotion';

export const useQuestionBankStyles = createStyles(({ css, token }) => ({
  shell: css`
    display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden;
    container-type: inline-size;
    &[data-open='false'] .ant-splitter-bar { display: none; }
  `,
  chatPane: css`display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden;`,
  chatToolbar: css`
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; height: 44px;
    padding: 6px 12px; box-sizing: border-box; border-bottom: 1px solid ${token.colorBorderSecondary}; background: ${token.colorBgContainer}; overflow: hidden;
    transition: height ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1), padding ${WORKSPACE_MOTION_MS}ms ease, opacity 180ms ease;
    [data-workspace-open='false'] & { height: 0; padding-block: 0; border-bottom-width: 0; opacity: 0; }
    @media (prefers-reduced-motion: reduce) { transition: none; }
  `,
  bankReveal: css`
    display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; width: 100%;
    opacity: 1; transform: translateX(0); transition: opacity 160ms ease, transform ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1);
    [data-workspace-phase='closed'] & { display: none; }
    [data-workspace-phase='opening'] &, [data-workspace-phase='closing'] & { flex: 0 0 auto; width: calc(100cqw * var(--hermes-bank-fraction)); min-width: 280px; height: 100%; }
    [data-workspace-phase='opening'] & { animation: hermes-bank-reveal 220ms ease-out both; }
    [data-workspace-phase='closing'] & { opacity: 0; transform: translateX(12px); }
    @keyframes hermes-bank-reveal { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
    @media (prefers-reduced-motion: reduce) { transition: none; animation: none !important; }
  `,
  workbenchToolbar: css`display: flex; align-items: center; gap: 12px; flex-shrink: 0; min-height: 44px; padding: 6px 24px; box-sizing: border-box; border-bottom: 1px solid ${token.colorBorderSecondary}; background: ${token.colorBgContainer}; > .ant-btn { flex-shrink: 0; }`,
  workbenchTitle: css`
    display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; max-width: 100%;
    padding: 0; border: 0; background: transparent; color: ${token.colorTextHeading};
    font: inherit; font-size: 14px; font-weight: 600; line-height: 32px; text-align: left; cursor: text;
    > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    > .anticon { flex-shrink: 0; color: ${token.colorTextSecondary}; }
    &:focus-visible { outline: 2px solid ${token.colorPrimary}; outline-offset: 2px; border-radius: 4px; }
    &:disabled { cursor: default; }
  `,
  workbenchTitleInput: css`flex: 1; min-width: 0; padding-inline: 0; font-size: 14px; font-weight: 600; color: ${token.colorTextHeading};`,
  splitter: css`
    flex: 1; min-width: 0; min-height: 0;
    .ant-splitter-panel { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
    /* Keep percentage layout in CSS: Splitter's measured pixel widths lag the sider by a frame. */
    && > .ant-splitter-panel:first-child { flex-basis: var(--hermes-chat-size) !important; }
    && > .ant-splitter-panel ~ .ant-splitter-panel { flex-basis: var(--hermes-bank-size) !important; }
    &[data-moving='true'] > .ant-splitter-panel { transition: flex-basis ${WORKSPACE_MOTION_MS}ms cubic-bezier(.22, 1, .36, 1); }
    @media (prefers-reduced-motion: reduce) { && > .ant-splitter-panel { transition: none; } }
    &[data-open='false'] .ant-splitter-bar { display: none; }
  `,
  panel: css`display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: ${token.colorBgContainer};`,
  header: css`display: flex; flex-direction: column; gap: 12px; padding: 12px 24px; border-bottom: 1px solid ${token.colorBorderSecondary}; background: ${token.colorFillAlter};`,
  panelControls: css`display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;`,
  panelToggles: css`display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px;`,
  panelMeta: css`display: flex; align-items: center; gap: 8px; margin-inline-start: auto; font-size: 12px; line-height: 20px; color: ${token.colorTextSecondary}; text-align: right;`,
  row: css`display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;`,
  scroll: css`flex: 1; min-height: 0; overflow: auto; padding: 24px; scrollbar-gutter: stable;`,
  footer: css`padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; border-top: 1px solid ${token.colorBorderSecondary};`,
  secondary: css`font-size: 12px; color: ${token.colorTextSecondary}; line-height: 20px;`,
  bankCard: css`
    width: min(100%, 300px);
    .ant-file-card-file-content { min-width: 0; flex: 1; }
    .ant-file-card-file-description { white-space: normal; margin-bottom: 0; }
  `,
  bankCardMeta: css`flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.5; color: ${token.colorTextSecondary};`,
  bankCardAction: css`flex-shrink: 0; font-size: 12px; padding: 2px 8px; height: auto; line-height: 1.5;`,
  cardList: css`display: flex; flex-direction: column; gap: 12px; min-width: 0; width: 100%;`,
  question: css`
    border: 1px solid ${token.colorBorderSecondary}; border-radius: ${token.borderRadius}px;
    padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 12px;
    background: ${token.colorBgContainer}; transition: border-color 0.2s, box-shadow 0.2s;
    &:hover { border-color: ${token.colorPrimaryBorderHover}; box-shadow: ${token.boxShadowTertiary}; }
  `,
  questionBody: css`
    flex: 1; min-width: 0;
    .x-markdown { font-family: inherit; font-size: ${token.fontSize}px; line-height: 1.9; color: ${token.colorText}; overflow-wrap: anywhere; }
    .katex { font-size: 1.05em; }
    .x-markdown img { max-width: 100%; }
    .x-markdown > :last-child { margin-bottom: 0; }
    .katex-display { overflow-x: auto; overflow-y: hidden; }
  `,
  questionStem: css`display: flex; align-items: baseline; gap: 6px; min-width: 0;`,
  questionNumber: css`flex-shrink: 0; font-size: inherit; line-height: inherit;`,
  questionStemContent: css`flex: 1; min-width: 0; .x-markdown > :first-child { margin-top: 0; }`,
  options: css`margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px 24px;`,
  optionItem: css`display: inline-flex; align-items: flex-start; min-width: 0; max-width: 100%; gap: 8px; > .x-markdown { min-width: 0; }`,
  optionLabel: css`display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 22px; height: 22px; margin-top: 2px; border: 1px solid ${token.colorBorder}; border-radius: 50%; color: ${token.colorTextSecondary}; font-size: ${token.fontSizeSM}px;`,
  answer: css`
    margin-top: 12px; padding: 12px 16px; border-left: 3px solid ${token.colorPrimary};
    background: ${token.colorInfoBg}; border-radius: 0 ${token.borderRadiusSM}px ${token.borderRadiusSM}px 0;
    > strong { color: ${token.colorPrimary}; }
  `,
  groupTitle: css`font-size: 16px; font-weight: 600; color: ${token.colorTextHeading}; margin: 4px 0 12px; padding-bottom: 8px; border-bottom: 1px solid ${token.colorBorderSecondary};`,
  previewDrawer: css`
    .ant-drawer-header { flex-wrap: wrap; gap: 12px; }
    .ant-drawer-header-title { flex: 0 0 auto; }
    .ant-drawer-extra { min-width: 0; margin-inline-start: auto; }
    .ant-drawer-body { padding: 24px; background: #fff; }
    @media (max-width: 576px) {
      .ant-drawer-header, .ant-drawer-body { padding: 16px; }
      .ant-drawer-extra { flex: 1 0 100%; margin-inline-start: 0; }
    }
  `,
  previewActions: css`display: flex; flex-wrap: wrap; align-items: center; gap: 8px;`,
  preview: css`
    width: 100%; max-width: 800px; margin-inline: auto; padding: 20px 0; background: #fff; color: #333; font-size: 14px; line-height: 1.8;
    overflow-wrap: anywhere;
    .x-markdown { font-family: inherit; color: #000; font-size: 14px; line-height: 1.8; }
    .x-markdown img { max-width: 100%; }
    .x-markdown > :last-child { margin-bottom: 0; }
    .katex { color: #000; }
    .katex-display { overflow-x: auto; overflow-y: hidden; }
    pre { white-space: pre-wrap; }
  `,
  previewHeader: css`
    text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #333;
    h1 { font-size: 24px; font-weight: 700; line-height: 1.5; margin: 0 0 10px; color: #000; }
  `,
  previewSubtitle: css`font-size: 14px; color: #666; margin-bottom: 5px;`,
  previewInfo: css`display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 15px; font-size: 13px; color: #555;`,
  previewOptions: css`margin: 10px 0 10px 25px; .x-markdown { color: #333; line-height: 1.6; }`,
  previewGroupTitle: css`font-size: 16px; font-weight: 700; line-height: 1.8; color: #000; margin: 25px 0 15px; padding-bottom: 8px; border-bottom: 1px solid #ddd; break-after: avoid;`,
  previewQuestion: css`margin: 20px 0; break-inside: avoid;`,
  previewAnswers: css`
    break-before: page; margin-top: 32px;
    h2 { font-size: 16px; font-weight: 700; color: #000; padding-bottom: 8px; border-bottom: 1px solid #ddd; }
  `,
  previewAnswerBlock: css`
    margin-top: 10px; padding: 10px 15px; background: #f5f5f5; border-left: 3px solid #1890ff;
    border-radius: 0 4px 4px 0; font-size: 13px; line-height: 1.6;
    .x-markdown { font-size: 13px; color: #333; }
  `,
}));
