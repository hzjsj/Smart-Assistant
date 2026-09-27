import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Space } from 'antd';
import type { MutableRefObject } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QietiPage, Rect } from '../../data';
import { useStyles } from '../styles';
import KonvaPageStage from './KonvaPageStage';

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

  useEffect(() => {
    setMounted(true);
  }, []);

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
            <div className={styles.pageTitle}>
              第 {pageIndex + 1} 页 · {page.name}
            </div>
            <div className={styles.pageStage}>
              <KonvaPageStage
                page={page}
                pageIndex={pageIndex}
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
