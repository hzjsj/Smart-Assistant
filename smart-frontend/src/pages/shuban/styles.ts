import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ token, css }) => ({
  app: css`
    display: flex;
    width: 100%;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
    color: ${token.colorText};
    background: ${token.colorBgLayout};
  `,
  sider: css`
    position: relative;
    z-index: 20;
    display: flex !important;
    flex: none !important;
    flex-direction: column;
    height: 100%;
    overflow: visible !important;
    background: ${token.colorBgContainer} !important;
    border-right: 1px solid ${token.colorBorderSecondary};
    transition: width 180ms ease;
    .ant-layout-sider-children {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: visible;
    }
  `,
  brand: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 56px;
    padding: 0 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  brandCollapsed: css`
    justify-content: center;
    padding: 0;
  `,
  brandName: css`
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 9px;
    overflow: hidden;
    color: ${token.colorText};
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
  `,
  brandIcon: css`
    flex: none;
    color: ${token.colorPrimary};
    font-size: 20px;
  `,
  nav: css`
    flex: none;
    padding: 10px 8px 0;
    .ant-menu {
      border-inline-end: 0 !important;
    }
    .ant-menu-inline-collapsed {
      width: 44px;
    }
    .ant-menu-inline-collapsed > .ant-menu-item,
    .ant-menu-inline-collapsed > .ant-menu-submenu > .ant-menu-submenu-title {
      width: 44px;
      margin-inline: 0;
      padding-inline: calc(50% - 8px) !important;
    }
  `,
  recent: css`
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    margin-top: 10px;
    padding: 12px 8px 8px;
    border-top: 1px solid ${token.colorBorderSecondary};
  `,
  recentTitle: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 8px;
    color: ${token.colorTextSecondary};
    font-size: 12px;
  `,
  recentList: css`
    min-height: 0;
    overflow: auto;
  `,
  recentItem: css`
    display: flex;
    width: 100%;
    min-height: 44px;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    color: ${token.colorText};
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: ${token.borderRadius};
    cursor: pointer;
    &:hover,
    &[aria-current='page'] {
      background: ${token.colorFillTertiary};
    }
  `,
  recentMeta: css`
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
  `,
  recentName: css`
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  recentSize: css`
    color: ${token.colorTextTertiary};
    font-size: 11px;
  `,
  main: css`
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  `,
  header: css`
    display: flex;
    min-height: 56px;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 24px;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    @media (max-width: 768px) {
      flex-wrap: wrap;
      gap: 4px 8px;
      padding: 4px 8px;
    }
  `,
  headerTitle: css`
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    @media (max-width: 768px) {
      min-height: 36px;
      flex-basis: 100%;
      gap: 7px;
      font-size: 13px;
    }
  `,
  currentFileSummary: css`
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    margin-left: 2px;
    padding-left: 10px;
    border-left: 1px solid ${token.colorBorderSecondary};
    @media (max-width: 768px) {
      flex: 1;
      margin-left: 0;
      padding-left: 0;
      border-left: 0;
    }
  `,
  documentFileSummary: css`
    margin-left: 0;
    padding-left: 0;
    border-left: 0;
  `,
  warningButton: css`
    height: 24px;
    padding: 0 7px;
    color: ${token.colorWarningText};
    background: ${token.colorWarningBg};
    border-radius: ${token.borderRadiusSM}px;
    font-size: 12px;
  `,
  warningContent: css`
    display: grid;
    width: min(360px, calc(100vw - 48px));
    max-height: 320px;
    gap: 8px;
    overflow-y: auto;
  `,
  currentFileName: css`
    max-width: min(32vw, 440px);
    @media (max-width: 768px) {
      max-width: calc(100vw - 230px);
    }
  `,
  headerActions: css`
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    @media (max-width: 768px) {
      width: 100%;
      justify-content: flex-end;
      gap: 4px;
    }
  `,
  content: css`
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    overflow: auto;
  `,
  page: css`
    width: min(100%, 1180px);
    flex: none;
    margin: 0 auto;
    padding: 32px 28px 48px;
  `,
  filePage: css`
    width: 100%;
    flex: none;
    padding: 24px 32px 40px;
    @media (max-width: 768px) {
      padding: 20px 12px 32px;
    }
  `,
  filePageHeading: css`
    margin-bottom: 18px;
    h1 {
      font-size: 20px;
    }
  `,
  pageHeading: css`
    margin-bottom: 24px;
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      font-weight: 600;
    }
    p {
      margin: 0;
      color: ${token.colorTextSecondary};
    }
  `,
  upload: css`
    margin: 0 auto 26px;
    .ant-upload.ant-upload-drag {
      min-height: 270px;
      padding: 36px 20px;
      background: ${token.colorBgContainer};
      border-color: ${token.colorBorder};
      border-radius: ${token.borderRadiusLG};
    }
    .ant-upload-drag-icon {
      margin-bottom: 14px;
      color: ${token.colorPrimary};
      font-size: 32px;
    }
  `,
  uploadActions: css`
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 18px;
  `,
  progressWrap: css`
    width: min(420px, 100%);
    margin: 18px auto 0;
  `,
  sectionHeader: css`
    display: flex;
    min-height: 42px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  `,
  fileSearch: css`
    margin-bottom: 16px;
    padding: 18px 24px;
    background: ${token.colorBgContainer};
    border-radius: ${token.borderRadiusLG};
    @media (max-width: 768px) {
      padding: 16px 12px;
    }
  `,
  fileSearchForm: css`
    display: flex;
    width: 100%;
    align-items: flex-end;
    gap: 16px;
    .ant-form-item {
      min-width: 0;
      margin-bottom: 0;
    }
  `,
  fileSearchFields: css`
    display: grid;
    min-width: 0;
    flex: 1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    .ant-form-item {
      width: 100%;
    }
    .ant-form-item-control,
    .ant-form-item-control-input,
    .ant-form-item-control-input-content {
      min-width: 0;
    }
    @media (max-width: 768px) {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  `,
  fileSearchActions: css`
    flex: none;
    margin-left: auto;
    @media (max-width: 768px) {
      width: 100%;
      justify-content: flex-end;
    }
  `,
  fileResults: css`
    padding: 16px 24px 8px;
    background: ${token.colorBgContainer};
    border-radius: ${token.borderRadiusLG};
    @media (max-width: 768px) {
      padding: 14px 12px 8px;
    }
  `,
  fileResultsToolbar: css`
    display: flex;
    min-height: 40px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    @media (max-width: 520px) {
      flex-wrap: wrap;
    }
  `,
  fileResultsTitle: css`
    display: flex;
    align-items: baseline;
    gap: 12px;
  `,
  fileTable: css`
    .ant-table-wrapper {
      border-top: 1px solid ${token.colorBorderSecondary};
    }
  `,
  fileNameButton: css`
    display: inline-flex;
    max-width: min(680px, 100%);
    align-items: center;
    gap: 8px;
    padding-inline: 0;
  `,
  fileNameText: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  document: css`
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  `,
  panes: css`
    min-height: 0;
    flex: 1;
    overflow: hidden;
    .ant-splitter {
      height: 100%;
    }
    .ant-splitter-panel {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
  `,
  pane: css`
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    background: ${token.colorBgContainer};
  `,
  paneBody: css`
    min-height: 0;
    flex: 1;
    overflow: auto;
  `,
  previewFrame: css`
    display: block;
    width: 100%;
    height: 100%;
    min-height: 320px;
    border: 0;
    background: ${token.colorBgLayout};
  `,
  resultTabs: css`
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
    .ant-tabs-nav {
      flex: none;
      margin: 0;
      padding: 0 12px;
    }
    .ant-tabs-content-holder,
    .ant-tabs-content,
    .ant-tabs-tabpane {
      min-height: 0;
      height: 100%;
    }
    .ant-tabs-content-holder {
      overflow: auto;
    }
  `,
  resultPad: css`
    padding: 16px;
  `,
  reportNotes: css`
    display: grid;
    gap: 8px;
    margin-top: 22px;
    padding-top: 14px;
    border-top: 1px solid ${token.colorBorderSecondary};
  `,
  reportStats: css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
    @media (max-width: 640px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  loading: css`
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 240px;
    place-items: center;
  `,
  textResult: css`
    margin: 0;
    padding: 16px;
    overflow: auto;
    color: ${token.colorText};
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 1.75;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
  mobileMode: css`
    padding: 8px 12px;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
}));
