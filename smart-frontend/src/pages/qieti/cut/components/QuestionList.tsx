import { Button, Empty, Tag } from 'antd';
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import QuestionContentView from '../../components/QuestionContentView';
import type { QuestionPreview } from '../../data';
import { useStyles } from '../styles';

const ITEM_ESTIMATED_HEIGHT = 280;
const OVERSCAN = 3;

interface QuestionListProps {
  questionPreviewList: QuestionPreview[];
  activeQuestionId: string | null;
  onLocateQuestion: (pageIndex: number, questionId: string) => void;
  onDeleteQuestion: (id: string) => void;
}

const QuestionItem = memo(function QuestionItem({
  preview,
  isActive,
  onLocateQuestion,
  onDeleteQuestion,
}: {
  preview: QuestionPreview;
  isActive: boolean;
  onLocateQuestion: (pageIndex: number, questionId: string) => void;
  onDeleteQuestion: (id: string) => void;
}) {
  const { styles, cx } = useStyles();
  return (
    <div
      className={cx(styles.questionItem, isActive && 'active')}
      onClick={() => onLocateQuestion(preview.pageIndex, preview.id)}
    >
      <div className={styles.qRow}>
        <span className={styles.qId}>
          题号 {preview.no} · 第 {preview.pageIndex + 1} 页
        </span>
        <Button
          size="small"
          danger
          onClick={(e) => {
            e.stopPropagation();
            onDeleteQuestion(preview.id);
          }}
        >
          删除
        </Button>
      </div>
      {preview.type ? (
        <Tag style={{ marginBottom: 4 }}>{preview.type}</Tag>
      ) : null}
      <QuestionContentView
        mergedImage={preview.mergedImage}
        stemText={preview.stemText}
        figures={preview.figures}
        optionTexts={preview.optionTexts}
        subquestionTexts={preview.subquestionTexts}
      />
    </div>
  );
});

/** 右侧题目列表：手写虚拟滚动（按估算高度 + overscan），题目多时不卡 */
export default function QuestionList({
  questionPreviewList,
  activeQuestionId,
  onLocateQuestion,
  onDeleteQuestion,
}: QuestionListProps) {
  const { styles } = useStyles();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const deferredList = useDeferredValue(questionPreviewList);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const updateHeight = () => setViewportHeight(el.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 画布上选中题目时，把对应列表项滚入视野（对齐原型的选中行可见）
  useEffect(() => {
    if (!activeQuestionId) return;
    const el = listRef.current;
    if (!el) return;
    const index = deferredList.findIndex((item) => item.id === activeQuestionId);
    if (index < 0) return;
    const itemTop = index * ITEM_ESTIMATED_HEIGHT;
    const itemBottom = itemTop + ITEM_ESTIMATED_HEIGHT;
    if (
      itemTop < el.scrollTop ||
      itemBottom > el.scrollTop + el.clientHeight
    ) {
      el.scrollTo({
        top: Math.max(0, itemTop - (el.clientHeight - ITEM_ESTIMATED_HEIGHT) / 2),
        behavior: 'smooth',
      });
    }
  }, [activeQuestionId, deferredList]);

  const total = deferredList.length;
  const visibleCount = Math.max(
    1,
    Math.ceil(viewportHeight / ITEM_ESTIMATED_HEIGHT) + OVERSCAN * 2,
  );
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / ITEM_ESTIMATED_HEIGHT) - OVERSCAN,
  );
  const endIndex = Math.min(total, startIndex + visibleCount);
  const topSpacer = startIndex * ITEM_ESTIMATED_HEIGHT;
  const bottomSpacer = Math.max(0, (total - endIndex) * ITEM_ESTIMATED_HEIGHT);
  const visibleItems = useMemo(
    () => deferredList.slice(startIndex, endIndex),
    [deferredList, startIndex, endIndex],
  );

  return (
    <aside className={styles.rightPanel}>
      <div className={styles.panelTitle}>题目列表（{total} 题）</div>
      <div
        className={styles.questionList}
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {!total ? (
          <Empty
            style={{ marginTop: 48 }}
            description="暂无题目，在左侧图片空白处拖拽即可划题"
          />
        ) : null}
        {total ? (
          <div style={{ height: topSpacer }} aria-hidden="true" />
        ) : null}
        {visibleItems.map((preview) => (
          <QuestionItem
            key={preview.id}
            preview={preview}
            isActive={preview.id === activeQuestionId}
            onLocateQuestion={onLocateQuestion}
            onDeleteQuestion={onDeleteQuestion}
          />
        ))}
        {total ? (
          <div style={{ height: bottomSpacer }} aria-hidden="true" />
        ) : null}
      </div>
    </aside>
  );
}
