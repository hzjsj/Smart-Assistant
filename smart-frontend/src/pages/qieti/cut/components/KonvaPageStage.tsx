import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Group,
  Image as KonvaImage,
  Rect as KonvaRect,
  Layer,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import { MIN_SIZE } from '../../constants';
import type { QietiPage, QietiQuestion, Rect } from '../../data';
import {
  clamp,
  getQuestionRects,
  normalizedRect,
} from '../../utils/questionUtils';

/** 题号标签样式（对齐 test/qieti 原型 LABEL_STYLE，尺寸为 css px，经反缩放保持视觉恒定） */
const LABEL_HEIGHT = 20;
const LABEL_BASE_WIDTH = 40;
const LABEL_MULTI_SUFFIX_WIDTH = 16;
const LABEL_PADDING = 6;
const LABEL_FONT_SIZE = 12;
const LABEL_FONT_FAMILY = 'Arial';
const LABEL_FONT_WEIGHT = '500';

/** 框体/标签配色（同原型；hover 为增强项，填充深浅介于透明与激活之间） */
const RECT_STROKE = '#004fff7f';
const RECT_FILL_HOVER = 'rgba(0, 79, 255, 0.04)';
const RECT_FILL_ACTIVE = 'rgba(0, 79, 255, 0.1)';
const LABEL_BG = 'rgba(0, 79, 255, 0.2)';
const LABEL_BG_ACTIVE = '#004fff';
const LABEL_TEXT = 'rgba(0, 79, 255, 0.5)';
const LABEL_TEXT_ACTIVE = '#fff';

/** Transformer 的 8 个缩放锚点名 */
const RESIZE_ANCHORS = new Set([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]);

/** 锚点 → 活动边（h: 左/右边随键移动，v: 上/下边；未列出的方向对该锚点无效） */
const ANCHOR_EDGES: Record<string, { h?: 'l' | 'r'; v?: 't' | 'b' }> = {
  'top-left': { h: 'l', v: 't' },
  'top-center': { v: 't' },
  'top-right': { h: 'r', v: 't' },
  'middle-left': { h: 'l' },
  'middle-right': { h: 'r' },
  'bottom-left': { h: 'l', v: 'b' },
  'bottom-center': { v: 'b' },
  'bottom-right': { h: 'r', v: 'b' },
};

interface KonvaPageStageProps {
  page: QietiPage;
  pageIndex: number;
  /** 画布容器的可用宽度（适应宽度基准，1 倍缩放下的 Stage 宽度） */
  baseWidth: number;
  /** 用户缩放倍数（1 = 适应宽度），切题框随其实时等比更新 */
  zoom: number;
  activeQuestionId: string | null;
  imageSrc: string;
  onSelectQuestion: (questionId: string, pageIndex: number) => void;
  onDeselectQuestion: () => void;
  onChangeRect: (
    pageIndex: number,
    questionId: string,
    rectIndex: number,
    rect: Rect,
  ) => void;
  onCreateQuestion: (pageIndex: number, rect: Rect) => void;
}

interface DraftRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 单个题目区块形状：可拖拽 Group（矩形 + 题号标签）+ 激活时 Transformer */
function QuestionRectShape({
  question,
  rect,
  rectIndex,
  rectsCount,
  pageIndex,
  page,
  scale,
  isActive,
  isHovered,
  dimmed,
  onSelectQuestion,
  onHoverQuestion,
  onHoverAnchor,
  onChangeRect,
}: {
  question: QietiQuestion;
  rect: Rect;
  rectIndex: number;
  rectsCount: number;
  pageIndex: number;
  page: QietiPage;
  scale: number;
  isActive: boolean;
  isHovered: boolean;
  dimmed: boolean;
  onSelectQuestion: (questionId: string, pageIndex: number) => void;
  onHoverQuestion: (questionId: string | null) => void;
  onHoverAnchor: (anchor: string | null) => void;
  onChangeRect: (
    pageIndex: number,
    questionId: string,
    rectIndex: number,
    rect: Rect,
  ) => void;
}) {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  // Transformer 挂在内层矩形而非 Group：Group 包围盒含凸出的题号标签，
  // 按包围盒缩放会导致标签被一起缩放、且顶边漂移（labelH × (scaleY-1)）
  useEffect(() => {
    if (isActive && trRef.current && rectRef.current) {
      trRef.current.attachTo(rectRef.current);
    } else if (trRef.current) {
      trRef.current.detach();
    }
  }, [isActive]);

  // Transformer 以绝对（屏幕）坐标缓存节点矩形；缩放改变 Stage scale 后其缓存
  // 不会自动重算，锚点会停留在旧位置，需主动 forceUpdate
  useEffect(() => {
    if (isActive && trRef.current) {
      trRef.current.forceUpdate();
    }
  }, [isActive, scale]);

  const setCursor = (e: Konva.KonvaEventObject<MouseEvent>, cursor: string) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = cursor;
  };

  const handleSelect = () => onSelectQuestion(question.id, pageIndex);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChangeRect(pageIndex, question.id, rectIndex, {
      x: e.target.x(),
      y: e.target.y(),
      w: rect.w,
      h: rect.h,
    });
  };

  // 原型模式：transformEnd 读取 scale 折算宽高后归位，再钳制到页面边界
  // 矩形是 Group 的子节点，位置为组内局部坐标，需加上组偏移换算成页面坐标
  const handleTransformEnd = () => {
    const node = rectRef.current;
    const group = groupRef.current;
    if (!node || !group) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const w = Math.max(MIN_SIZE, node.width() * scaleX);
    const h = Math.max(MIN_SIZE, node.height() * scaleY);
    const x = clamp(group.x() + node.x(), 0, page.width - w);
    const y = clamp(group.y() + node.y(), 0, page.height - h);
    node.position({ x: 0, y: 0 });
    group.position({ x, y });
    onChangeRect(pageIndex, question.id, rectIndex, { x, y, w, h });
  };

  // 标签宽度与选中态无关（对齐原型：选中仅变配色，不加宽）
  const labelWidth =
    LABEL_BASE_WIDTH + (rectsCount > 1 ? LABEL_MULTI_SUFFIX_WIDTH : 0);
  const labelText = `${question.no}题${rectsCount > 1 ? ` (${rectIndex + 1})` : ''}`;
  // canvas 会裁剪出界绘制：标签默认悬于框上方，贴近页面顶部时回落到 y=0 防裁剪
  const labelLocalY =
    rect.y - LABEL_HEIGHT / scale < 0 ? -rect.y : -LABEL_HEIGHT / scale;

  return (
    <>
      <Group
        ref={groupRef}
        x={rect.x}
        y={rect.y}
        draggable
        opacity={dimmed ? 0.4 : 1}
        dragBoundFunc={(pos) => ({
          x: clamp(pos.x, 0, (page.width - rect.w) * scale),
          y: clamp(pos.y, 0, (page.height - rect.h) * scale),
        })}
        onClick={handleSelect}
        onTap={handleSelect}
        onDragStart={handleSelect}
        onDragEnd={handleDragEnd}
        onMouseEnter={(e) => {
          setCursor(e, 'move');
          onHoverQuestion(question.id);
        }}
        onMouseLeave={(e) => {
          setCursor(e, 'crosshair');
          onHoverQuestion(null);
        }}
      >
        <KonvaRect
          ref={rectRef}
          onTransformEnd={handleTransformEnd}
          width={rect.w}
          height={rect.h}
          fill={
            isActive
              ? RECT_FILL_ACTIVE
              : isHovered
                ? RECT_FILL_HOVER
                : 'transparent'
          }
          stroke={RECT_STROKE}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
        {/* 题号标签：反缩放 Group，内部一律 css px */}
        <Group
          x={rect.w - labelWidth / scale}
          y={labelLocalY}
          scaleX={1 / scale}
          scaleY={1 / scale}
        >
          <KonvaRect
            width={labelWidth}
            height={LABEL_HEIGHT}
            cornerRadius={[0, 0, 4, 4]}
            fill={isActive ? LABEL_BG_ACTIVE : LABEL_BG}
          />
          {/* 文字定位照搬原型：x/y = LABEL_STYLE.padding，且不设 width/height
              （原型里的 align/verticalAlign 因此并不生效，实际是 6px 左对齐） */}
          <Text
            x={LABEL_PADDING}
            y={LABEL_PADDING}
            text={labelText}
            fontSize={LABEL_FONT_SIZE}
            fontFamily={LABEL_FONT_FAMILY}
            fontStyle={LABEL_FONT_WEIGHT}
            fill={isActive ? LABEL_TEXT_ACTIVE : LABEL_TEXT}
            listening={false}
          />
        </Group>
      </Group>
      {isActive ? (
        <Transformer
          ref={trRef}
          flipEnabled={false}
          keepRatio={false}
          rotateEnabled={false}
          // Konva 10 的 Transformer 在绝对（屏幕）坐标系绘制，锚点不吃 Stage 缩放
          // （见其 getAbsoluteTransform 重写），直接给 css px 即可视觉恒定；
          // 除以 scale 反而是二次补偿，源图越大（scale 越小）锚点越大
          anchorSize={10}
          anchorStrokeWidth={1}
          borderStrokeWidth={1}
          // 悬浮锚点上报：Konva 锚点 name 形如 "bottom-right _anchor"，取首段
          onMouseOver={(e) => {
            const anchor = e.target.name().split(' ')[0];
            onHoverAnchor(RESIZE_ANCHORS.has(anchor) ? anchor : null);
          }}
          onMouseOut={() => onHoverAnchor(null)}
          boundBoxFunc={(oldBox, newBox) =>
            Math.abs(newBox.width) < MIN_SIZE * scale ||
            Math.abs(newBox.height) < MIN_SIZE * scale
              ? oldBox
              : newBox
          }
        />
      ) : null}
    </>
  );
}

/** 每页一个 Konva Stage：背景图 + 题目矩形（选中/拖拽/缩放/画新框） */
export default function KonvaPageStage({
  page,
  pageIndex,
  activeQuestionId,
  imageSrc,
  onSelectQuestion,
  onDeselectQuestion,
  onChangeRect,
  onCreateQuestion,
  baseWidth,
  zoom = 1,
}: KonvaPageStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const draftRef = useRef<DraftRect | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [draft, setDraft] = useState<DraftRect | null>(null);
  // 悬停高亮按题联动：同题所有框一起高亮，与选中联动一致
  const [hoverQuestionId, setHoverQuestionId] = useState<string | null>(null);

  // 缩放比 = 适应宽度基准比 × 用户缩放倍数；框/标签/草稿均随其实时等比更新
  const stageWidth = baseWidth * zoom;
  const scale = page.width > 0 && stageWidth > 0 ? stageWidth / page.width : 0;

  const sortedQuestions = useMemo(
    () => page.questions.slice().sort((a, b) => a.no - b.no),
    [page.questions],
  );

  // 背景图加载（dataURL / 远程 URL 均可）
  useEffect(() => {
    setImage(null);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  const getClampedPointer = useCallback((): {
    x: number;
    y: number;
  } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return null;
    return {
      x: clamp(pos.x, 0, page.width),
      y: clamp(pos.y, 0, page.height),
    };
  }, [page.width, page.height]);

  const handleStageMouseDown = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    if (e.target !== e.target.getStage()) return;
    const point = getClampedPointer();
    if (!point) return;
    onDeselectQuestion();
    const next = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    draftRef.current = next;
    setDraft(next);
  };

  const handleStageMouseMove = () => {
    if (!draftRef.current) return;
    const point = getClampedPointer();
    if (!point) return;
    const next = { ...draftRef.current, x2: point.x, y2: point.y };
    draftRef.current = next;
    setDraft(next);
  };

  const finalizeDraft = useCallback(() => {
    const current = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!current) return;
    const rect = normalizedRect(current.x1, current.y1, current.x2, current.y2);
    if (rect.w >= MIN_SIZE && rect.h >= MIN_SIZE) {
      onCreateQuestion(pageIndex, rect);
    }
  }, [onCreateQuestion, pageIndex]);

  // 指针在画布外松开时兜底收尾（沿用原全局 mouseup 模式）
  useEffect(() => {
    if (!draft) return;
    const onDocMouseUp = () => finalizeDraft();
    document.addEventListener('mouseup', onDocMouseUp);
    return () => document.removeEventListener('mouseup', onDocMouseUp);
  }, [draft, finalizeDraft]);

  // ─── 键盘方向键：悬浮锚点时缩放，未悬浮时移动选中题目框 ─────────────
  const anchorHoverRef = useRef<{
    questionId: string;
    rectIndex: number;
    anchor: string;
  } | null>(null);

  const handleHoverAnchor = useCallback(
    (questionId: string, rectIndex: number, anchor: string | null) => {
      anchorHoverRef.current = anchor
        ? { questionId, rectIndex, anchor }
        : null;
    },
    [],
  );

  /** 悬浮锚点 + 方向键：对角固定，沿锚点活动边缩放（页面像素坐标，clamp + MIN_SIZE） */
  const resizeByKeyboard = useCallback(
    (questionId: string, rectIndex: number, anchor: string, dx: number, dy: number) => {
      const q = page.questions.find((item) => item.id === questionId);
      const rect = q ? getQuestionRects(q)[rectIndex] : undefined;
      if (!rect) return;
      const edges = ANCHOR_EDGES[anchor];
      if (!edges) return;
      let { x, y, w, h } = rect;
      if (edges.h === 'l') {
        const nx = clamp(x + dx, 0, x + w - MIN_SIZE);
        w += x - nx;
        x = nx;
      }
      if (edges.h === 'r') {
        w = clamp(w + dx, MIN_SIZE, Math.max(MIN_SIZE, page.width - x));
      }
      if (edges.v === 't') {
        const ny = clamp(y + dy, 0, y + h - MIN_SIZE);
        h += y - ny;
        y = ny;
      }
      if (edges.v === 'b') {
        h = clamp(h + dy, MIN_SIZE, Math.max(MIN_SIZE, page.height - y));
      }
      onChangeRect(pageIndex, questionId, rectIndex, { x, y, w, h });
    },
    [page, pageIndex, onChangeRect],
  );

  /** 仅选中 + 方向键：整体平移选中题目的所有框（以整体包围盒 clamp，保持相对位置） */
  const moveByKeyboard = useCallback(
    (questionId: string, dx: number, dy: number) => {
      const q = page.questions.find((item) => item.id === questionId);
      if (!q) return;
      const rects = getQuestionRects(q);
      if (!rects.length) return;
      const minX = Math.min(...rects.map((r) => r.x));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.w));
      const maxY = Math.max(...rects.map((r) => r.y + r.h));
      const mx = clamp(dx, -minX, Math.max(0, page.width - maxX));
      const my = clamp(dy, -minY, Math.max(0, page.height - maxY));
      if (mx === 0 && my === 0) return;
      rects.forEach((rect, rectIndex) => {
        onChangeRect(pageIndex, questionId, rectIndex, {
          x: rect.x + mx,
          y: rect.y + my,
          w: rect.w,
          h: rect.h,
        });
      });
    },
    [page, pageIndex, onChangeRect],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeQuestionId) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = deltas[e.key];
      if (!delta) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = delta[0] * step;
      const dy = delta[1] * step;
      const hover = anchorHoverRef.current;
      if (hover && hover.questionId === activeQuestionId) {
        resizeByKeyboard(hover.questionId, hover.rectIndex, hover.anchor, dx, dy);
      } else {
        moveByKeyboard(activeQuestionId, dx, dy);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeQuestionId, resizeByKeyboard, moveByKeyboard]);

  return (
    <div style={stageWidth > 0 ? { width: stageWidth } : undefined}>
      {stageWidth > 0 ? (
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={page.height * scale}
          scaleX={scale}
          scaleY={scale}
          style={{ cursor: 'crosshair' }}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={finalizeDraft}
          onTouchStart={handleStageMouseDown}
          onTouchMove={handleStageMouseMove}
          onTouchEnd={finalizeDraft}
        >
          <Layer listening={false}>
            {image ? (
              <KonvaImage
                image={image}
                width={page.width}
                height={page.height}
                perfectDrawEnabled={false}
              />
            ) : null}
          </Layer>
          <Layer>
            {sortedQuestions.flatMap((q) => {
              const rects = getQuestionRects(q);
              return rects.map((rect, rectIndex) => (
                <QuestionRectShape
                  // biome-ignore lint/suspicious/noArrayIndexKey: 矩形无稳定 id，按坐标做 key 会在拖拽时重挂载并丢失 Transformer
                  key={`${q.id}-${rectIndex}`}
                  question={q}
                  rect={rect}
                  rectIndex={rectIndex}
                  rectsCount={rects.length}
                  pageIndex={pageIndex}
                  page={page}
                  scale={scale}
                  isActive={q.id === activeQuestionId}
                  isHovered={q.id === hoverQuestionId}
                  dimmed={!!draft}
                  onSelectQuestion={onSelectQuestion}
                  onHoverQuestion={setHoverQuestionId}
                  onHoverAnchor={(anchor) =>
                    handleHoverAnchor(q.id, rectIndex, anchor)
                  }
                  onChangeRect={onChangeRect}
                />
              ));
            })}
            {draft
              ? (() => {
                  const r = normalizedRect(
                    draft.x1,
                    draft.y1,
                    draft.x2,
                    draft.y2,
                  );
                  const tooSmall = r.w < MIN_SIZE || r.h < MIN_SIZE;
                  const sizeText = `${Math.round(r.w)} × ${Math.round(r.h)}`;
                  const badgeW = sizeText.length * 7 + 12;
                  // 徽标悬于框左上角上方，贴顶时落入框内；框比徽标窄时左移防出界
                  const badgeY =
                    r.y * scale < LABEL_HEIGHT + 4 ? 2 : -LABEL_HEIGHT;
                  const badgeX = Math.min(0, r.w * scale - badgeW);
                  return (
                    <>
                      <KonvaRect
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        fill="rgba(0, 79, 255, 0.12)"
                        stroke="#004fff"
                        strokeWidth={1.5}
                        strokeScaleEnabled={false}
                        listening={false}
                      />
                      {/* 实时尺寸徽标（反缩放恒定字号）：低于最小尺寸时变红，松开将不生成 */}
                      <Group
                        x={r.x + badgeX / scale}
                        y={r.y + badgeY / scale}
                        scaleX={1 / scale}
                        scaleY={1 / scale}
                        listening={false}
                      >
                        <KonvaRect
                          width={badgeW}
                          height={LABEL_HEIGHT}
                          cornerRadius={4}
                          fill={tooSmall ? '#ff4d4f' : '#004fff'}
                        />
                        <Text
                          width={badgeW}
                          height={LABEL_HEIGHT}
                          text={sizeText}
                          fontSize={11}
                          fontFamily={LABEL_FONT_FAMILY}
                          fontStyle="bold"
                          align="center"
                          verticalAlign="middle"
                          fill="#fff"
                          listening={false}
                        />
                      </Group>
                    </>
                  );
                })()
              : null}
          </Layer>
        </Stage>
      ) : null}
    </div>
  );
}
