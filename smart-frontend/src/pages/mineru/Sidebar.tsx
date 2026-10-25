import {
  FileTextOutlined,
  FundOutlined,
  GithubFilled,
  HolderOutlined,
  MenuFoldOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  StarOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import {
  Avatar,
  Button,
  Divider,
  Flex,
  Menu,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import './task.css';

interface SidebarProps {
  folded: boolean;
  activeKey?: string;
  onSelectKey?: (key: string) => void;
  onWidthChange: (w: number) => void;
  onToggleFold: () => void;
}

const MIN_WIDTH = 200;
const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.4));

const navMenuItems: MenuProps['items'] = [
  {
    key: 'new',
    icon: <PlusOutlined className="mu-tab-icon" />,
    label: <span className="mu-text-grad">新解析</span>,
    className: 'mu-menu-item-grad',
  },
  {
    key: 'tasks',
    icon: <FileTextOutlined className="mu-tab-icon" />,
    label: '任务管理',
  },
  {
    key: 'favorites',
    icon: <StarOutlined className="mu-tab-icon" />,
    label: '我的收藏',
  },
];

interface SidebarNavMenuProps {
  activeKey?: string;
  onSelectKey?: (key: string) => void;
}

/** 抽离复用的 Ant Design Menu 导航组件（同时供展开态侧栏与折叠态 Popover 浮层使用） */
export function SidebarNavMenu({
  activeKey = 'tasks',
  onSelectKey,
}: SidebarNavMenuProps) {
  return (
    <Menu
      mode="inline"
      selectedKeys={[activeKey]}
      items={navMenuItems}
      className="mu-nav-menu"
      onClick={({ key }) => onSelectKey?.(key)}
    />
  );
}

export default function Sidebar({
  folded,
  activeKey = 'tasks',
  onSelectKey,
  onWidthChange,
  onToggleFold,
}: SidebarProps) {
  const draggingRef = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    document.documentElement.classList.add('mu-dragging');
    draggingRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !sidebarRef.current) return;
      window.getSelection()?.removeAllRanges();
      const rect = sidebarRef.current.getBoundingClientRect();
      const next = Math.min(
        maxWidth(),
        Math.max(MIN_WIDTH, e.clientX - rect.left),
      );
      onWidthChange(Math.round(next));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      document.documentElement.classList.remove('mu-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onWidthChange]);

  return (
    <aside
      ref={sidebarRef}
      className={`mu-sidebar${folded ? ' mu-sidebar-folded' : ''}${dragging ? ' mu-is-dragging' : ''}`}
    >
      <div className="mu-sidebar-inner">
        {/* Logo（antd 图标 + 品牌名）+ 悬浮渐显的折叠 Button */}
        <Flex justify="space-between" align="center" className="mu-logo">
          <Flex align="center" gap={8}>
            <span className="mu-logo-badge">
              <FundOutlined />
            </span>
            <Typography.Text className="mu-logo-name">文档解析</Typography.Text>
          </Flex>
          <Tooltip title="收起侧栏">
            <Button
              type="text"
              size="small"
              className="mu-fold-trigger"
              icon={<MenuFoldOutlined />}
              onClick={onToggleFold}
            />
          </Tooltip>
        </Flex>

        {/* 基于 Ant Design Menu 的三态导航菜单 */}
        <SidebarNavMenu activeKey={activeKey} onSelectKey={onSelectKey} />

        <Divider className="mu-separator" />

        <div className="mu-spacer" />

        {/* 底部用户卡片 */}
        <Flex
          justify="space-between"
          align="center"
          className="mu-sidebar-footer"
        >
          <Avatar size={28} className="mu-user-avatar">
            U
          </Avatar>
          <Space size={4}>
            <Tooltip title="搜索">
              <Button
                type="text"
                size="small"
                className="mu-footer-btn"
                icon={<SearchOutlined />}
              />
            </Tooltip>
            <Tooltip title="GitHub">
              <Button
                type="text"
                size="small"
                className="mu-footer-btn"
                icon={<GithubFilled />}
              />
            </Tooltip>
            <Tooltip title="设置">
              <Button
                type="text"
                size="small"
                className="mu-footer-btn"
                icon={<SettingOutlined />}
              />
            </Tooltip>
          </Space>
        </Flex>
      </div>

      {/* 拖拽调宽把手 */}
      {!folded && (
        <div className="mu-sidebar-drag" onMouseDown={startDrag}>
          <HolderOutlined className="mu-sidebar-drag-icon" />
        </div>
      )}
    </aside>
  );
}
