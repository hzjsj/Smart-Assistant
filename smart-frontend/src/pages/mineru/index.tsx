import {
  FilterOutlined,
  FundOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import {
  Button,
  ConfigProvider,
  Divider,
  Dropdown,
  Flex,
  Input,
  Popover,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useState } from 'react';
import Sidebar, { SidebarNavMenu } from './Sidebar';
import type { StatusFilter } from './TaskTable';
import TaskTable from './TaskTable';
import UploadView from './UploadView';
import './task.css';

/** MinerU 品牌主题（原型 main.tsx 迁入，页面级生效不影响其他页面） */
const mineruTheme = {
  token: {
    colorPrimary: '#0D53DE',
    colorLink: '#0D53DE',
    colorText: '#121316',
    colorTextSecondary: 'rgba(0,0,0,0.35)',
    colorBgTextHover: '#F4F5F9',
    borderRadius: 6,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  components: {
    Table: { headerBg: '#F4F5F9', headerColor: '#121316' },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: '#ffffff',
      itemSelectedColor: '#121316',
      itemHoverBg: 'rgb(235, 236, 240)',
      itemActiveBg: '#ffffff',
      itemBorderRadius: 12,
      itemHeight: 40,
      itemMarginInline: 0,
      itemMarginBlock: 4,
      iconSize: 18,
      activeBarBorderWidth: 0,
    },
  },
};

function TaskManagement() {
  const [folded, setFolded] = useState(false);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  // 默认落在"智能解析"（新解析）页：首次打开与刷新后都是它
  const [activeNavKey, setActiveNavKey] = useState('new');
  const [width, setWidth] = useState(() =>
    Math.min(260, Math.round(window.innerWidth * 0.4)),
  );
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filterItems = [
    { key: 'all', label: '全部任务' },
    { key: 'success', label: '解析成功' },
    { key: 'failed', label: '解析失败' },
  ];

  // 侧栏宽度同步到根节点 CSS 变量（浮层是 body 下的 portal，需要全局可见）
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }, [width]);

  // 视口缩放时把侧栏宽度钳制在新上限内
  useEffect(() => {
    const onResize = () => {
      const max = Math.max(200, Math.round(window.innerWidth * 0.4));
      setWidth((w) => Math.min(w, max));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <Flex className="mu-page mu-slide-in-top">
      {/* 折叠后的左侧唤出热区：悬浮渐显双图标按钮，悬浮按钮弹出浮层菜单 */}
      {folded && (
        <div className="mu-hotzone">
          <Popover
            open={flyoutOpen}
            onOpenChange={setFlyoutOpen}
            trigger="hover"
            mouseEnterDelay={0.15}
            placement="bottomLeft"
            styles={{ content: { padding: 0 } }}
            arrow={false}
            motion={{ motionName: 'mu-flyout-motion' }}
            classNames={{ root: 'mu-flyout-popover' }}
            content={
              <div className="mu-flyout">
                {/* 标题：与展开态侧栏 Logo 区一致 */}
                <Flex align="center" gap={8} className="mu-flyout-header">
                  <span className="mu-logo-badge">
                    <FundOutlined />
                  </span>
                  <Typography.Text className="mu-logo-name">
                    文档解析
                  </Typography.Text>
                </Flex>
                <SidebarNavMenu
                  activeKey={activeNavKey}
                  onSelectKey={setActiveNavKey}
                />
                <Divider className="mu-separator" />
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              className="mu-expand-btn"
              onClick={() => {
                setFlyoutOpen(false);
                setFolded(false);
              }}
            >
              <MenuFoldOutlined className="mu-icon-layer mu-icon-fold" />
              <MenuUnfoldOutlined className="mu-icon-layer mu-icon-expand" />
            </Button>
          </Popover>
        </div>
      )}

      <Sidebar
        folded={folded}
        activeKey={activeNavKey}
        onSelectKey={setActiveNavKey}
        onWidthChange={setWidth}
        onToggleFold={() => setFolded((f) => !f)}
      />

      <main className="mu-main">
        {/* 新解析（智能解析）视图无顶部导航栏：内容区自带大标题，与官网首页一致 */}
        {activeNavKey !== 'new' && (
          <header className="mu-header mu-slide-in">
            {/* 折叠/展开双图标按钮：折叠态下隐藏自身占位以让位给固定热区按钮，消除重叠且标题不跳动 */}
            <Button
              type="text"
              size="small"
              className={`mu-expand-btn${folded ? ' mu-expand-btn-placeholder' : ''}`}
              onClick={() => setFolded((f) => !f)}
            >
              <MenuFoldOutlined className="mu-icon-layer mu-icon-fold" />
              <MenuUnfoldOutlined className="mu-icon-layer mu-icon-expand" />
            </Button>
            <Typography.Title level={4} className="mu-header-title">
              {activeNavKey === 'favorites' ? '我的收藏' : '任务管理'}
            </Typography.Title>

            <Space size={10} className="mu-header-actions">
              <Dropdown
                menu={{
                  items: filterItems,
                  selectable: true,
                  selectedKeys: [statusFilter],
                  onClick: ({ key }) => setStatusFilter(key as StatusFilter),
                }}
                trigger={['click']}
                popupRender={(node) => (
                  <div className="mu-filter-dropdown">{node}</div>
                )}
              >
                <Tooltip title="按状态筛选">
                  <Button
                    type="text"
                    size="small"
                    className="mu-collapse-trigger"
                    icon={<FilterOutlined />}
                  />
                </Tooltip>
              </Dropdown>
              <Input
                allowClear
                placeholder="请输入任务名称"
                className="mu-header-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Space>
          </header>
        )}

        {activeNavKey === 'new' ? (
          <UploadView onViewTasks={() => setActiveNavKey('tasks')} />
        ) : (
          <TaskTable
            search={search}
            statusFilter={statusFilter}
            favoriteOnly={activeNavKey === 'favorites'}
          />
        )}
      </main>
    </Flex>
  );
}

export default function MineruPage() {
  return (
    <ConfigProvider locale={zhCN} theme={mineruTheme}>
      <TaskManagement />
    </ConfigProvider>
  );
}
