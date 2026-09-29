import {
  CloseOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LinkOutlined,
  ScissorOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Divider,
  InputNumber,
  Progress,
  Space,
  Tooltip,
} from 'antd';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QietiPage, QietiQuestion, Rect } from '../../data';
import { useStyles } from '../styles';
import KonvaPageStage from './KonvaPageStage';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
/** Ctrl+滚轮步进：每次精确调整 1% */
const ZOOM_WHEEL_STEP = 0.01;

/** 浮动操作条的状态摘要（由页面级组件派生） */
export interface MergeBarInfo {
  /** 多选数量 */
  count: number;
  /** 选中题目分布的页数 */
  pageCount: number;
  /** 主选中（末位）是否为合并题：决定 ✂ 解除合并按钮显隐 */
  primaryMerged: boolean;
}

interface PageViewerProps {
  pages: QietiPage[];
  currentPageIndex: number;
  onSwitchPage: (index: number) => void;
  onSelectPage: (index: number) => void;
  pageSectionRefs: MutableRefObject<(HTMLElement | null)[]>;
  thumbRefs: MutableRefObject<(HTMLElement | null)[]>;
  selectedQuestionIds: string[];
  /** 每页应渲染的题目（框在该页的题，跨页题出现在多页） */
  questionsByPageId: Map<string, QietiQuestion[]>;
  /** 页面尺寸查询表：跨页框按所在页宽高 clamp */
  pagesMetaById: Map<string, { id: string; width: number; height: number }>;
  mergeBar: MergeBarInfo;
  onSelectQuestion: (
    questionId: string,
    pageIndex: number,
    additive: boolean,
  ) => void;
  onDeselectQuestion: () => void;
  onChangeRect: (
    pageIndex: number,
    questionId: string,
    rectIndex: number,
    rect: Rect,
  ) => void;
  onCreateQuestion: (pageIndex: number, rect: Rect) => void;
  onMerge: () => void;
  onUnmerge: () => void;
  getPageImageSrc: (page: QietiPage) => string;
}

/** 页面堆叠查看器：Konva 划题交互 + 悬浮缩略图导航坞 + 合并浮动操作条 */
export default function PageViewer({
  pages,
  currentPageIndex,
  onSwitchPage,
  onSelectPage,
  pageSectionRefs,
  thumbRefs,
  selectedQuestionIds,
  questionsByPageId,
  pagesMetaById,
  mergeBar,
  onSelectQuestion,
  onDeselectQuestion,
  onChangeRect,
  onCreateQuestion,
  onMerge,
  onUnmerge,
  getPageImageSrc,
}: PageViewerProps) {
  const { styles, cx } = useStyles();
  const [showThumbs, setShowThumbs] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [baseWidth, setBaseWidth] = useState(0);
  const zoomRef = useRef(1);
  /** 页码输入框的值（回车/失焦时提交跳转） */
  const [pageInput, setPageInput] = useState(1);
  /** 输入框的实时预览页（clamp 后），供进度条即时反馈 */
  const previewPage = Math.min(
    Math.max(Math.round(Number(pageInput) || 1), 1),
    Math.max(1, pages.length),
  );

  /** 回车/失焦提交：clamp 后跳转对应页（渲染 + 滚动定位） */
  const commitPageJump = useCallback(() => {
    const target = Math.min(
      Math.max(Math.round(Number(pageInput) || 1), 1),
      Math.max(1, pages.length),
    );
    setPageInput(target);
    if (target !== currentPageIndex + 1) onSwitchPage(target - 1);
  }, [pageInput, pages.length, currentPageIndex, onSwitchPage]);

  // 外部翻页（按钮/缩略图/列表定位）时同步输入框显示
  useEffect(() => {
    setPageInput(currentPageIndex + 1);
  }, [currentPageIndex]);
  const zoomAnchorRef = useRef<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    prev: number;
  } | null>(null);

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  // Ctrl+滚轮缩放：以光标为锚点，缩放后校正滚动位置，使光标下的内容保持不动
  const handleZoomWheel = useCallback(
    (e: WheelEvent) => {
      const prev = zoomRef.current;
      const next = Math.min(
        ZOOM_MAX,
        Math.max(
          ZOOM_MIN,
          prev + (e.deltaY > 0 ? -ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP),
        ),
      );
      if (next === prev) return;
      // 锚点只在无待处理校正时捕获（基准 = 已提交布局）；
      // 连续滚轮在提交前到达时仅累加目标缩放，避免锚点与布局错位
      if (!zoomAnchorRef.current) {
        const wrap = canvasWrapRef.current;
        if (wrap) {
          const rect = wrap.getBoundingClientRect();
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          zoomAnchorRef.current = {
            sx: wrap.scrollLeft + cx,
            sy: wrap.scrollTop + cy,
            cx,
            cy,
            prev,
          };
        }
      }
      applyZoom(next);
    },
    [applyZoom],
  );

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    // passive: false 才能 preventDefault，拦截浏览器自身的 Ctrl+滚轮页面缩放
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      handleZoomWheel(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [handleZoomWheel]);

  // 缩放提交后按锚点校正滚动（页面间固定间距导致纵向为近似校正）
  useEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    zoomAnchorRef.current = null;
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const ratio = zoom / anchor.prev;
    wrap.scrollLeft = Math.max(0, anchor.sx * ratio - anchor.cx);
    wrap.scrollTop = Math.max(0, anchor.sy * ratio - anchor.cy);
  }, [zoom]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 量取画布可用宽度：滚动容器宽度不随缩放变化，作为缩放基准（1 = 适应宽度）
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      let chrome = 0;
      const section = pageSectionRefs.current[0];
      if (section) {
        const ss = getComputedStyle(section);
        chrome =
          parseFloat(ss.paddingLeft) +
          parseFloat(ss.paddingRight) +
          parseFloat(ss.borderLeftWidth) +
          parseFloat(ss.borderRightWidth);
      }
      setBaseWidth(
        Math.max(
          0,
          el.clientWidth -
            parseFloat(cs.paddingLeft) -
            parseFloat(cs.paddingRight) -
            chrome,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pages.length, pageSectionRefs]);

  useEffect(() => {
    thumbRefs.current[currentPageIndex]?.scrollIntoView({
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [currentPageIndex, thumbRefs]);

  return (
    <Card
      size="small"
      className={styles.viewerCard}
      styles={{
        body: {
          padding: 0,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      title={
        pages.length ? (
          <Space size={6}>
            <span className={styles.headText}>第</span>
            <InputNumber
              size="small"
              min={1}
              max={pages.length}
              controls={false}
              value={pageInput}
              onChange={(v) => setPageInput(Number(v) || 1)}
              onPressEnter={() => commitPageJump()}
              onBlur={() => commitPageJump()}
              className={styles.pageInput}
            />
            <span className={styles.headText}>/ {pages.length} 页</span>
            <Divider type="vertical" style={{ height: 16 }} />
            <Button
              size="small"
              onClick={() => onSwitchPage(currentPageIndex - 1)}
              disabled={currentPageIndex <= 0}
            >
              上一页
            </Button>
            <Button
              size="small"
              onClick={() => onSwitchPage(currentPageIndex + 1)}
              disabled={currentPageIndex >= pages.length - 1}
            >
              下一页
            </Button>
            <Progress
              percent={(previewPage / pages.length) * 100}
              showInfo={false}
              size={[72, 4]}
              status="normal"
            />
          </Space>
        ) : (
          <span className={styles.headText}>未加载文件</span>
        )
      }
      extra={
        <Space size={4}>
          <Button
            size="small"
            icon={<ZoomOutOutlined />}
            disabled={zoom <= ZOOM_MIN || !pages.length}
            onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}
          />
          <Tooltip title="点击重置为适应宽度（100%）">
            <Button
              size="small"
              style={{ minWidth: 56 }}
              disabled={!pages.length}
              onClick={() => applyZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </Button>
          </Tooltip>
          <Button
            size="small"
            icon={<ZoomInOutlined />}
            disabled={zoom >= ZOOM_MAX || !pages.length}
            onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}
          />
        </Space>
      }
    >
      <div className={styles.canvasWrap} ref={canvasWrapRef}>
        {/* 合并浮动操作条：sticky 吸顶悬浮，不占布局空间；选中 ≥2 题时出现 */}
        <div className={styles.mergeBarSticky}>
          {mergeBar.count >= 2 ? (
            <div className={styles.mergeActionBar}>
              <span className={styles.mergeBarText}>
                已选
                <span className={styles.mergeBarCount}>{mergeBar.count}</span>题
                {mergeBar.pageCount > 1 ? ` · 跨 ${mergeBar.pageCount} 页` : ''}
              </span>
              <span className={styles.mergeBarDivider} />
              <Button type="primary" icon={<LinkOutlined />} onClick={onMerge}>
                合并
              </Button>
              {mergeBar.primaryMerged ? (
                <Button icon={<ScissorOutlined />} onClick={onUnmerge}>
                  拆分
                </Button>
              ) : null}
              <Tooltip title="取消选择" placement="bottom">
                <Button
                  type="text"
                  shape="circle"
                  icon={<CloseOutlined />}
                  onClick={onDeselectQuestion}
                />
              </Tooltip>
            </div>
          ) : null}
        </div>
        {pages.map((page, pageIndex) => (
          <section
            key={page.id}
            ref={(el) => {
              pageSectionRefs.current[pageIndex] = el;
            }}
            className={cx(
              styles.pageBlock,
              pageIndex === currentPageIndex && 'active',
            )}
            onClick={() => onSelectPage(pageIndex)}
          >
            <div className={styles.pageStage}>
              <KonvaPageStage
                page={page}
                pageIndex={pageIndex}
                baseWidth={baseWidth}
                zoom={zoom}
                selectedQuestionIds={selectedQuestionIds}
                pageQuestions={questionsByPageId.get(page.id) ?? []}
                pagesMetaById={pagesMetaById}
                imageSrc={getPageImageSrc(page)}
                onSelectQuestion={onSelectQuestion}
                onDeselectQuestion={onDeselectQuestion}
                onChangeRect={onChangeRect}
                onCreateQuestion={onCreateQuestion}
              />
            </div>
          </section>
        ))}
      </div>

      {mounted && pages.length
        ? createPortal(
            <div className={styles.thumbDock}>
              <Button
                size="small"
                icon={showThumbs ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => setShowThumbs((v) => !v)}
              >
                {showThumbs ? '隐藏缩略图' : '显示缩略图'}
              </Button>
              {showThumbs ? (
                <div className={styles.thumbs}>
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      ref={(el) => {
                        thumbRefs.current[i] = el;
                      }}
                      className={cx(
                        styles.thumb,
                        i === currentPageIndex && 'active',
                      )}
                      onClick={() => onSwitchPage(i)}
                    >
                      <img
                        src={getPageImageSrc(p)}
                        alt={`第 ${i + 1} 页缩略图`}
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </Card>
  );
}
