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
  onLocateQuestion: (pageIndex: number, questionId: string) => void;
  onDeleteQuestion: (id: string) => void;
}

const QuestionItem = memo(function QuestionItem({
  preview,
  onLocateQuestion,
  onDeleteQuestion,
}: {
  preview: QuestionPreview;
  onLocateQuestion: (pageIndex: number, questionId: string) => void;
  onDeleteQuestion: (id: string) => void;
}) {
  const { styles } = useStyles();
  return (
    <div
      className={styles.questionItem}
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
