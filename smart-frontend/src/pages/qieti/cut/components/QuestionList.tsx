import { PictureOutlined, ScissorOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Empty,
  Image,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
} from 'antd';
import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import QuestionContentView from '../../components/QuestionContentView';
import type { QuestionPreview } from '../../data';
import { useStyles } from '../styles';

const ITEM_ESTIMATED_HEIGHT = 280;
const OVERSCAN = 3;

/** 题型配色：不同题型不同 Tag 颜色，列表扫视更快 */
const TYPE_COLORS: Record<string, string> = {
  单选题: 'blue',
  多选题: 'purple',
  填空题: 'green',
  判断题: 'orange',
  简答题: 'cyan',
};

interface QuestionListProps {
  questionPreviewList: QuestionPreview[];
  /** 多选集合（Ctrl+点击合并用）；主选中 = 末位 */
  selectedQuestionIds: string[];
  onLocateQuestion: (pageIndex: number, questionId: string) => void;
  /** Ctrl+点击列表项：加入/移出多选集合 */
  onToggleSelect: (questionId: string, pageIndex: number) => void;
  onDeleteQuestion: (id: string) => void;
  /** 解除合并（拆分） */
  onUnmergeQuestion: (id: string) => void;
  /** 用户手动滚动列表时清除选中（避免自动定位把列表拽回选中题） */
  onDeselectQuestion: () => void;
}

const QuestionItem = memo(function QuestionItem({
  preview,
  isSelected,
  isPrimary,
  onLocateQuestion,
  onToggleSelect,
  onUnmergeQuestion,
  onDeleteQuestion,
  onMeasure,
}: {
  preview: QuestionPreview;
  isSelected: boolean;
  isPrimary: boolean;
  onLocateQuestion: (pageIndex: number, questionId: string) => void;
  onToggleSelect: (questionId: string, pageIndex: number) => void;
  onUnmergeQuestion: (id: string) => void;
  onDeleteQuestion: (id: string) => void;
  onMeasure: (id: string, height: number) => void;
}) {
  const { styles, cx } = useStyles();
  const itemRef = useRef<HTMLDivElement>(null);
  /** 题干图片展开状态（默认收起，图片按钮切换） */
  const [showImage, setShowImage] = useState(false);

  // 实测行高（含下外边距）：图片/公式加载会改变高度，ResizeObserver 持续上报
  useEffect(() => {
    const el = itemRef.current;
    if (!el) return;
    let lastHeight = 0;
    const observer = new ResizeObserver(() => {
      const marginBottom =
        Number.parseFloat(getComputedStyle(el).marginBottom) || 0;
      const height = el.offsetHeight + marginBottom;
      if (height && height !== lastHeight) {
        lastHeight = height;
        onMeasure(preview.id, height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview.id, onMeasure]);

  // 跨页题页码显示："第 1·2 页"；单页与现状一致
  const pageLabel =
    preview.pageIndices.length > 1
      ? `第 ${preview.pageIndices.map((i) => i + 1).join('·')} 页`
      : `第 ${preview.pageIndex + 1} 页`;

  return (
    <div
      ref={itemRef}
      className={cx(
        styles.questionItem,
        isSelected && 'selected',
        isPrimary && 'active',
      )}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          onToggleSelect(preview.id, preview.pageIndex);
          return;
        }
        onLocateQuestion(preview.pageIndex, preview.id);
      }}
    >
      <div className={styles.qRow}>
        <span className={styles.qId}>
          题号 {preview.no} · {pageLabel}
        </span>
        <Space size={4}>
          {preview.rectCount > 1 ? (
            <Tooltip title="一题多框（合并题）" placement="top">
              <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                已合并·{preview.rectCount}框
              </Tag>
            </Tooltip>
          ) : null}
          {preview.type ? (
            <Tag
              color={TYPE_COLORS[preview.type] ?? 'default'}
              style={{ marginInlineEnd: 0 }}
            >
              {preview.type}
            </Tag>
          ) : null}
          {preview.mergedImage ? (
            <Tooltip
              title={showImage ? '收起题干图片' : '查看题干图片'}
              placement="top"
            >
              <Button
                size="small"
                type={showImage ? 'primary' : 'default'}
                className={showImage ? undefined : styles.imageBtn}
                icon={<PictureOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowImage((v) => !v);
                }}
              >
                图片
              </Button>
            </Tooltip>
          ) : null}
          {preview.rectCount > 1 ? (
            <Popconfirm
              title={`拆分为 ${preview.rectCount} 道独立题目？`}
              description="首框保留内容，其余框拆出为空内容新题"
              okText="拆分"
              cancelText="取消"
              onConfirm={() => onUnmergeQuestion(preview.id)}
            >
              <Button
                size="small"
                icon={<ScissorOutlined />}
                onClick={(e) => e.stopPropagation()}
              >
                拆分
              </Button>
            </Popconfirm>
          ) : null}
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
        </Space>
      </div>
      {showImage && preview.mergedImage ? (
        <div className={styles.stemImage}>
          <Image
            className={styles.mathImage}
            src={preview.mergedImage}
            alt="题干图片"
            width="100%"
          />
        </div>
      ) : null}
      <QuestionContentView
        stemText={preview.stemText}
        figures={preview.figures}
        optionTexts={preview.optionTexts}
        subquestionTexts={preview.subquestionTexts}
        hideStemLabel
      />
    </div>
  );
});

/** 前缀和 offsets 中找最后一个 ≤ y 的下标（offsets[i] 为第 i 项顶部位置） */
function findIndexByOffset(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid] <= y) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** 右侧题目列表：虚拟滚动（实测高度 + 未测项估算），题目多时不卡、选中定位准 */
export default function QuestionList({
  questionPreviewList,
  selectedQuestionIds,
  onLocateQuestion,
  onToggleSelect,
  onDeleteQuestion,
  onUnmergeQuestion,
  onDeselectQuestion,
}: QuestionListProps) {
  const { styles } = useStyles();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [heightMap, setHeightMap] = useState<Map<string, number>>(
    () => new Map(),
  );
  const deferredList = useDeferredValue(questionPreviewList);
  /** 主选中 = 多选集合末位（列表定位/滚动跟随的基准） */
  const activeQuestionId = selectedQuestionIds.at(-1) ?? null;
  /** 程序性自动滚动的时间窗口（到点前视为自动滚动，期间的 scroll 事件不取消选中） */
  const autoScrollUntilRef = useRef(0);
  /** 供 scroll 回调读取最新选中值，避免依赖闭包过期 */
  const selectedRef = useRef(selectedQuestionIds);
  useEffect(() => {
    selectedRef.current = selectedQuestionIds;
  }, [selectedQuestionIds]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const updateHeight = () => setViewportHeight(el.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleMeasure = useMemo(() => {
    let pending = new Map<string, number>();
    // 批量合并同一帧内的多次上报，避免逐项触发重渲染
    let scheduled = false;
    const flush = () => {
      const batch = pending;
      pending = new Map();
      scheduled = false;
      setHeightMap((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, height] of batch) {
          if (prev.get(id) !== height) {
            next.set(id, height);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    return (id: string, height: number) => {
      pending.set(id, height);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    };
  }, []);

  // 前缀和布局：已测项用实测高度，未测项回退估算值
  const layout = useMemo(() => {
    const offsets: number[] = [0];
    for (const item of deferredList) {
      offsets.push(
        offsets[offsets.length - 1] +
          (heightMap.get(item.id) ?? ITEM_ESTIMATED_HEIGHT),
      );
    }
    return offsets;
  }, [deferredList, heightMap]);
  const totalHeight = layout[layout.length - 1];

  // 画布上选中题目时，把对应列表项滚入视野（实测高度定位，渲染后测量更新会自动校正）
  useEffect(() => {
    if (!activeQuestionId) return;
    const el = listRef.current;
    if (!el) return;
    const index = deferredList.findIndex(
      (item) => item.id === activeQuestionId,
    );
    if (index < 0) return;
    const itemTop = layout[index];
    const itemHeight = layout[index + 1] - layout[index];
    if (
      itemTop < el.scrollTop ||
      itemTop + itemHeight > el.scrollTop + el.clientHeight
    ) {
      // 标记自动滚动窗口（滚动动画+测量回写约 0.7s），期间不视为用户滚动
      autoScrollUntilRef.current = Date.now() + 700;
      el.scrollTo({
        top: Math.max(0, itemTop - (el.clientHeight - itemHeight) / 2),
        behavior: 'smooth',
      });
    }
  }, [activeQuestionId, deferredList, layout]);

  // 条目数变化（合并/拆分/删除）时内容高度骤变，浏览器钳制 scrollTop 触发
  // scroll 事件——用 layout effect 在 DOM 提交前开窗，短窗口内不视为用户滚动，
  // 避免合并/拆分后刚设置的选中被立即清除
  useLayoutEffect(() => {
    autoScrollUntilRef.current = Date.now() + 250;
  }, [deferredList.length]);

  const total = deferredList.length;
  const startIndex = Math.max(
    0,
    findIndexByOffset(layout, scrollTop) - OVERSCAN,
  );
  const endIndex = Math.min(
    total,
    findIndexByOffset(layout, scrollTop + viewportHeight) + 1 + OVERSCAN,
  );
  const topSpacer = layout[startIndex];
  const bottomSpacer = Math.max(0, totalHeight - layout[endIndex]);
  const visibleItems = useMemo(
    () => deferredList.slice(startIndex, endIndex),
    [deferredList, startIndex, endIndex],
  );

  return (
    <Card
      size="small"
      className={styles.rightPanel}
      styles={{
        body: {
          // 最外层四边留白（不参与滚动，间距恒定不穿透），保持轻盈
          padding: 8,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      title={
        <Space size={8}>
          <span>题目列表</span>
          <Tag color="processing" style={{ marginInlineEnd: 0 }}>
            {total} 题
          </Tag>
        </Space>
      }
    >
      <div
        className={styles.questionList}
        ref={listRef}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          // 用户手动滚动：取消选中（自动滚动窗口内的滚动除外）
          if (
            Date.now() >= autoScrollUntilRef.current &&
            selectedRef.current.length
          ) {
            onDeselectQuestion();
          }
        }}
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
            isSelected={selectedQuestionIds.includes(preview.id)}
            isPrimary={preview.id === activeQuestionId}
            onLocateQuestion={onLocateQuestion}
            onToggleSelect={onToggleSelect}
            onUnmergeQuestion={onUnmergeQuestion}
            onDeleteQuestion={onDeleteQuestion}
            onMeasure={handleMeasure}
          />
        ))}
        {total ? (
          <div style={{ height: bottomSpacer }} aria-hidden="true" />
        ) : null}
      </div>
    </Card>
  );
}
