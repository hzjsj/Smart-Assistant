import {
  DoubleLeftOutlined,
  DoubleRightOutlined,
  FileTextOutlined,
  ProfileOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import { history } from '@umijs/max';
import { Button, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { type ReactNode, useEffect, useState } from 'react';

/** /qieti/ 模块内的三个子页面（悬浮导航栏的页面切换组） */
export type QietiPageKey = 'cut' | 'questions' | 'records';

const NAV_ITEMS: {
  key: QietiPageKey;
  title: string;
  path: string;
  icon: ReactNode;
}[] = [
  {
    key: 'cut',
    title: '切题工作台',
    path: '/qieti/cut',
    icon: <ScissorOutlined />,
  },
  {
    key: 'questions',
    title: '题目列表',
    path: '/qieti/questions',
    icon: <FileTextOutlined />,
  },
  {
    key: 'records',
    title: '上传记录',
    path: '/qieti/records',
    icon: <ProfileOutlined />,
  },
];

/**
 * Win10 风格右侧悬浮导航栏（可收起）：贴边窄条、图标 + 悬停提示。
 * 页面切换组在 /qieti/ 下所有页面共用；children 渲染各组页面的专属操作
 * （如工作台的识别/导出/保存/清空）。开合经 CSS 变量 --qieti-nav-w 广播，
 * 供工作台布局与合并浮条腾出右缘空间。
 */
export const useSideNavStyles = createStyles(({ token, css }) => ({
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
}));

interface SideNavProps {
  /** 当前页面（高亮对应切换入口） */
  active: QietiPageKey;
  /** 本页专属操作按钮，渲染在页面切换组下方、分隔线之后 */
  children?: ReactNode;
}

export default function SideNav({ active, children }: SideNavProps) {
  const [open, setOpen] = useState(true);
  const { styles, cx } = useSideNavStyles();

  useEffect(() => {
    document.body.style.setProperty('--qieti-nav-w', open ? '56px' : '0px');
    return () => {
      document.body.style.removeProperty('--qieti-nav-w');
    };
  }, [open]);

  return (
    <>
      <aside className={cx(styles.sideNav, !open && styles.sideNavHidden)}>
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.key} title={item.title} placement="left">
            <Button
              className={cx(
                styles.sideNavBtn,
                active === item.key && styles.sideNavBtnActive,
              )}
              type="text"
              icon={item.icon}
              onClick={() => history.push(item.path)}
            />
          </Tooltip>
        ))}
        <div className={styles.sideNavDivider} />
        {children}
        <div className={styles.sideNavSpacer} />
        <Tooltip title={open ? '收起导航栏' : '展开导航栏'} placement="left">
          <Button
            className={styles.sideNavBtn}
            type="text"
            icon={open ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
            onClick={() => setOpen((v) => !v)}
          />
        </Tooltip>
      </aside>
      {!open ? (
        <Tooltip title="展开导航栏" placement="left">
          <Button
            className={styles.sideNavTab}
            type="primary"
            icon={<DoubleLeftOutlined />}
            onClick={() => setOpen(true)}
          />
        </Tooltip>
      ) : null}
    </>
  );
}
