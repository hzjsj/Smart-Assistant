import {
  EyeInvisibleOutlined,
  EyeOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { Button, Space, Tooltip } from 'antd';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QietiPage, Rect } from '../../data';
import { useStyles } from '../styles';
import KonvaPageStage from './KonvaPageStage';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const ZOOM_WHEEL_STEP = 0.1;

interface PageViewerProps {
  pages: QietiPage[];
  currentPageIndex: number;
  onSwitchPage: (index: number) => void;
  onSelectPage: (index: number) => void;
  pageSectionRefs: MutableRefObject<(HTMLElement | null)[]>;
  thumbRefs: MutableRefObject<(HTMLElement | null)[]>;
  activeQuestionId: string | null;
  onSelectQuestion: (questionId: string, pageIndex: number) => void;
  onDeselectQuestion: () => void;
  onChangeRect: (
    pageIndex: number,
    questionId: string,
    rectIndex: number,
    rect: Rect,
  ) => void;
  onCreateQuestion: (pageIndex: number, rect: Rect) => void;
  getPageImageSrc: (page: QietiPage) => string;
}

/** 页面堆叠查看器：Konva 划题交互 + 悬浮缩略图导航坞 */
export default function PageViewer({
  pages,
  currentPageIndex,
  onSwitchPage,
  onSelectPage,
  pageSectionRefs,
  thumbRefs,
  activeQuestionId,
  onSelectQuestion,
  onDeselectQuestion,
  onChangeRect,
  onCreateQuestion,
  getPageImageSrc,
}: PageViewerProps) {
  const { styles, cx } = useStyles();
  const [showThumbs, setShowThumbs] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [baseWidth, setBaseWidth] = useState(0);
  const zoomRef = useRef(1);
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
        Math.max(ZOOM_MIN, prev + (e.deltaY > 0 ? -ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP)),
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
    <div className={styles.viewerCard}>
      <div className={styles.viewerHead}>
        <span>
          {pages.length ? (
            <>
              当前第 <b>{currentPageIndex + 1}</b> / {pages.length} 页
            </>
          ) : (
            '未加载文件'
          )}
        </span>
        <Space size="small" wrap>
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
        </Space>
      </div>

      <div className={styles.canvasWrap} ref={canvasWrapRef}>
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
                activeQuestionId={activeQuestionId}
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
    </div>
  );
}
