import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Group,
  Image as KonvaImage,
  Layer,
  Rect as KonvaRect,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import { MIN_SIZE } from '../../constants';
import type { QietiPage, QietiQuestion, Rect } from '../../data';
import { clamp, getQuestionRects, normalizedRect } from '../../utils/questionUtils';

/** 题号标签样式（对齐 test/qieti 原型 LABEL_STYLE，尺寸为 css px，经反缩放保持视觉恒定） */
const LABEL_HEIGHT = 20;
const LABEL_BASE_WIDTH = 40;
const LABEL_MULTI_SUFFIX_WIDTH = 16;
const LABEL_DELETE_WIDTH = 16;
const LABEL_FONT_SIZE = 12;
const LABEL_FONT_FAMILY = 'Arial';
const LABEL_FONT_WEIGHT = '500';

/** 框体/标签配色（同原型） */
const RECT_STROKE = '#004fff7f';
const RECT_FILL_ACTIVE = 'rgba(0, 79, 255, 0.1)';
const LABEL_BG = 'rgba(0, 79, 255, 0.2)';
const LABEL_BG_ACTIVE = '#004fff';
const LABEL_TEXT = 'rgba(0, 79, 255, 0.5)';
const LABEL_TEXT_ACTIVE = '#fff';

interface KonvaPageStageProps {
  page: QietiPage;
  pageIndex: number;
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
  onRequestDeleteQuestion: (questionId: string, no: number) => void;
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
  onSelectQuestion,
  onChangeRect,
  onRequestDeleteQuestion,
}: {
  question: QietiQuestion;
  rect: Rect;
  rectIndex: number;
  rectsCount: number;
  pageIndex: number;
  page: QietiPage;
  scale: number;
  isActive: boolean;
  onSelectQuestion: (questionId: string, pageIndex: number) => void;
  onChangeRect: (
    pageIndex: number,
    questionId: string,
    rectIndex: number,
    rect: Rect,
  ) => void;
  onRequestDeleteQuestion: (questionId: string, no: number) => void;
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

  const setCursor = (
    e: Konva.KonvaEventObject<MouseEvent>,
    cursor: string,
  ) => {
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

  const hasDelete = rectIndex === 0;
  const labelWidth =
    LABEL_BASE_WIDTH +
    (rectsCount > 1 ? LABEL_MULTI_SUFFIX_WIDTH : 0) +
    (hasDelete ? LABEL_DELETE_WIDTH : 0);
  const labelText = `${question.no}题${rectsCount > 1 ? ` (${rectIndex + 1})` : ''}`;
  // canvas 会裁剪出界绘制：标签默认悬于框上方，贴顶时回落到框内顶部
  const labelLocalY =
    rect.y - LABEL_HEIGHT / scale < 0 ? -rect.y : -LABEL_HEIGHT / scale;

  return (
    <>
      <Group
        ref={groupRef}
        x={rect.x}
        y={rect.y}
        draggable
        dragBoundFunc={(pos) => ({
          x: clamp(pos.x, 0, (page.width - rect.w) * scale),
          y: clamp(pos.y, 0, (page.height - rect.h) * scale),
        })}
        onClick={handleSelect}
        onTap={handleSelect}
        onDragStart={handleSelect}
        onDragEnd={handleDragEnd}
        onMouseEnter={(e) => setCursor(e, 'move')}
        onMouseLeave={(e) => setCursor(e, 'crosshair')}
      >
        <KonvaRect
          ref={rectRef}
          onTransformEnd={handleTransformEnd}
          width={rect.w}
          height={rect.h}
          fill={isActive ? RECT_FILL_ACTIVE : 'transparent'}
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
          <Text
            width={labelWidth - (hasDelete ? LABEL_DELETE_WIDTH : 0)}
            height={LABEL_HEIGHT}
            text={labelText}
            fontSize={LABEL_FONT_SIZE}
            fontFamily={LABEL_FONT_FAMILY}
            fontStyle={LABEL_FONT_WEIGHT}
            align="center"
            verticalAlign="middle"
            fill={isActive ? LABEL_TEXT_ACTIVE : LABEL_TEXT}
            listening={false}
          />
          {hasDelete ? (
            <Group
              x={labelWidth - LABEL_DELETE_WIDTH}
              y={(LABEL_HEIGHT - LABEL_DELETE_WIDTH) / 2}
              onClick={(e) => {
                e.cancelBubble = true;
                onRequestDeleteQuestion(question.id, question.no);
              }}
              onMouseEnter={(e) => setCursor(e, 'pointer')}
              onMouseLeave={(e) => setCursor(e, 'move')}
            >
              <KonvaRect
                width={LABEL_DELETE_WIDTH}
                height={LABEL_DELETE_WIDTH}
                cornerRadius={3}
                fill="rgba(255, 255, 255, 0.25)"
              />
              <Text
                width={LABEL_DELETE_WIDTH}
                height={LABEL_DELETE_WIDTH}
                text="×"
                fontSize={12}
                align="center"
                verticalAlign="middle"
                fill={isActive ? LABEL_TEXT_ACTIVE : LABEL_TEXT}
                listening={false}
              />
            </Group>
          ) : null}
        </Group>
      </Group>
      {isActive ? (
        <Transformer
          ref={trRef}
          flipEnabled={false}
          keepRatio={false}
          rotateEnabled={false}
          anchorSize={8 / scale}
          anchorStrokeWidth={1.5 / scale}
          borderStrokeWidth={1 / scale}
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
  onRequestDeleteQuestion,
}: KonvaPageStageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const draftRef = useRef<DraftRect | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [draft, setDraft] = useState<DraftRect | null>(null);

  const scale =
    page.width > 0 && stageWidth > 0 ? stageWidth / page.width : 1;

  const sortedQuestions = useMemo(
    () => page.questions.slice().sort((a, b) => a.no - b.no),
    [page.questions],
  );

  // 容器宽度响应（ResizeObserver），驱动 Stage 整体缩放
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setStageWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    const rect = normalizedRect(
      current.x1,
      current.y1,
      current.x2,
      current.y2,
    );
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

  return (
    <div
      ref={wrapRef}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
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
                  onSelectQuestion={onSelectQuestion}
                  onChangeRect={onChangeRect}
                  onRequestDeleteQuestion={onRequestDeleteQuestion}
                />
              ));
            })}
            {draft ? (
              <KonvaRect
                {...normalizedRect(draft.x1, draft.y1, draft.x2, draft.y2)}
                fill="rgba(0, 79, 255, 0.12)"
                stroke="#004fff"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                dash={[4 / scale, 4 / scale]}
                listening={false}
              />
            ) : null}
          </Layer>
        </Stage>
      ) : null}
    </div>
  );
}
