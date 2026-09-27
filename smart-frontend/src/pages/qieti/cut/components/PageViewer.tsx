import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Space } from 'antd';
import type { MutableRefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QietiPage, QietiQuestion, Rect } from '../../data';
import { getQuestionRects } from '../../utils/questionUtils';
import { useStyles } from '../styles';

const HANDLE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

interface PageViewerProps {
  pages: QietiPage[];
  currentPageIndex: number;
  onSwitchPage: (index: number) => void;
  onSelectPage: (index: number) => void;
  pageImageRefs: MutableRefObject<(HTMLImageElement | null)[]>;
  pageSectionRefs: MutableRefObject<(HTMLElement | null)[]>;
  thumbRefs: MutableRefObject<(HTMLElement | null)[]>;
  onImageLoad: () => void;
  activeQuestionId: string | null;
  onOverlayMouseDown: (pageIndex: number, e: React.MouseEvent) => void;
  onDeleteQuestion: (id: string) => void;
  getPageImageSrc: (page: QietiPage) => string;
}

/** 页面堆叠查看器：overlay 划题交互 + 悬浮缩略图导航坞 */
export default function PageViewer({
  pages,
  currentPageIndex,
  onSwitchPage,
  onSelectPage,
  pageImageRefs,
  pageSectionRefs,
  thumbRefs,
  onImageLoad,
  activeQuestionId,
  onOverlayMouseDown,
  onDeleteQuestion,
  getPageImageSrc,
}: PageViewerProps) {
  const { styles, cx } = useStyles();
  const [showThumbs, setShowThumbs] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    thumbRefs.current[currentPageIndex]?.scrollIntoView({
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [currentPageIndex, thumbRefs]);

  const sortedQuestions = useMemo(
    () => pages.map((p) => p.questions.slice().sort((a, b) => a.no - b.no)),
    [pages],
  );

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
        <Space size="small">
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

      <div className={styles.canvasWrap}>
        {pages.map((page, pageIndex) => {
          const imgEl = pageImageRefs.current[pageIndex];
          const displayW = imgEl?.clientWidth || page.width;
          const displayH = imgEl?.clientHeight || page.height;
          const sx = page.width ? displayW / page.width : 1;
          const sy = page.height ? displayH / page.height : 1;

          return (
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
              <div className={styles.pageTitle}>
                第 {pageIndex + 1} 页 · {page.name}
              </div>
              <div className={styles.pageStage}>
                <img
                  ref={(el) => {
                    pageImageRefs.current[pageIndex] = el;
                  }}
                  className={styles.pageImage}
                  src={getPageImageSrc(page)}
                  alt={`试题第 ${pageIndex + 1} 页`}
                  draggable={false}
                  loading="lazy"
                  onLoad={onImageLoad}
                />
                <div
                  className={styles.overlay}
                  onMouseDown={(e) => onOverlayMouseDown(pageIndex, e)}
                >
                  {sortedQuestions[pageIndex].flatMap((q: QietiQuestion) => {
                    const rects: Rect[] = getQuestionRects(q);
                    const isActive = q.id === activeQuestionId;
                    return rects.map((rect: Rect, rectIndex: number) => (
                      <div
                        key={`${q.id}-${rect.x}-${rect.y}`}
                        className={cx(styles.rect, isActive && 'active')}
                        data-id={q.id}
                        data-rect-index={rectIndex}
                        title={`题号 ${q.no} · 第 ${pageIndex + 1} 页 · 区块 ${rectIndex + 1}`}
                        style={{
                          left: `${rect.x * sx}px`,
                          top: `${rect.y * sy}px`,
                          width: `${rect.w * sx}px`,
                          height: `${rect.h * sy}px`,
                        }}
                      >
                        <div
                          className={cx(styles.rectLabel, isActive && 'active')}
                        >
                          <span>
                            {q.no}题
                            {rects.length > 1 ? ` (${rectIndex + 1})` : ''}
                          </span>
                          {rectIndex === 0 ? (
                            <Popconfirm
                              title="确认删除该题目吗？"
                              description="删除后不可恢复"
                              okText="删除"
                              okButtonProps={{ danger: true }}
                              cancelText="取消"
                              onConfirm={(e) => {
                                e?.stopPropagation();
                                onDeleteQuestion(q.id);
                              }}
                              onCancel={(e) => e?.stopPropagation()}
                            >
                              <button
                                type="button"
                                className={styles.rectRemove}
                                aria-label={`删除第 ${q.no} 题`}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                ×
                              </button>
                            </Popconfirm>
                          ) : null}
                        </div>
                        {isActive
                          ? HANDLE_DIRECTIONS.map((dir) => (
                              <div
                                key={dir}
                                className={cx(styles.handle, dir)}
                                data-handle={dir}
                              />
                            ))
                          : null}
                      </div>
                    ));
                  })}
                </div>
              </div>
            </section>
          );
        })}
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
