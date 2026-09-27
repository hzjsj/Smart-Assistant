import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { MIN_SIZE, QUESTION_TYPES } from '../../constants';
import type { QietiPage, QietiQuestion } from '../../data';
import {
  clamp,
  createId,
  ensureQuestionRects,
  getQuestionRects,
  normalizedRect,
  normalizeQuestionShape,
  reindexQuestions,
  resizeRectByHandle,
  syncQuestionRect,
} from '../../utils/questionUtils';

interface RectPoint {
  x: number;
  y: number;
}

interface Interaction {
  mode: 'draw' | 'move' | 'resize';
  id: string;
  rectIndex: number;
  pageIndex: number;
  handle?: string;
  startX: number;
  startY: number;
  startRect?: { x: number; y: number; w: number; h: number };
}

interface UseRectInteractionOptions {
  pagesRef: MutableRefObject<QietiPage[]>;
  pageImageRefs: MutableRefObject<(HTMLImageElement | null)[]>;
  setPages: Dispatch<SetStateAction<QietiPage[]>>;
  /** 画框/点选题目时回调（设置激活题目与当前页） */
  onActiveChange: (questionId: string, pageIndex: number) => void;
  /** 下一个可用题号 */
  nextQuestionNo: () => number;
}

/**
 * 划题交互：overlay 按下 → 画新框 / 拖动移动 / 手柄缩放。
 * mousemove 用 rAF 节流，全局 mouseup 收尾（过小的框自动丢弃）。
 */
export function useRectInteraction({
  pagesRef,
  pageImageRefs,
  setPages,
  onActiveChange,
  nextQuestionNo,
}: UseRectInteractionOptions) {
  const interactionRef = useRef<Interaction | null>(null);
  const moveFrameRef = useRef(0);
  const lastMoveEventRef = useRef<MouseEvent | null>(null);

  /** 浏览器坐标 → 页面图片像素坐标（光标必须在图片范围内） */
  const toImagePoint = useCallback(
    (pageIndex: number, clientX: number, clientY: number): RectPoint | null => {
      const img = pageImageRefs.current[pageIndex];
      const page = pagesRef.current[pageIndex];
      if (!img || !page) return null;
      const rect = img.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }
      const xRatio = page.width / rect.width;
      const yRatio = page.height / rect.height;
      return {
        x: clamp((clientX - rect.left) * xRatio, 0, page.width),
        y: clamp((clientY - rect.top) * yRatio, 0, page.height),
      };
    },
    [pagesRef, pageImageRefs],
  );

  /** overlay 鼠标按下：手柄→缩放；框体→移动；空白→新建题目画框 */
  const handleOverlayMouseDown = useCallback(
    (pageIndex: number, e: React.MouseEvent) => {
      const page = pagesRef.current[pageIndex];
      if (!page) return;

      const rectEl = (e.target as HTMLElement).closest('[data-rect]');
      const handleEl = (e.target as HTMLElement).closest('[data-handle]');
      const rectIndex = Number(
        (rectEl as HTMLElement | null)?.dataset?.rectIndex || 0,
      );

      if (handleEl && rectEl) {
        const q = page.questions.find(
          (item) => item.id === (rectEl as HTMLElement).dataset.id,
        );
        const handle = (handleEl as HTMLElement).dataset.handle || '';
        const targetRect = q ? getQuestionRects(q)[rectIndex] : null;
        if (!q || !targetRect) return;
        onActiveChange(q.id, pageIndex);
        interactionRef.current = {
          mode: 'resize',
          id: q.id,
          rectIndex,
          pageIndex,
          handle,
          startX: e.clientX,
          startY: e.clientY,
          startRect: { ...targetRect },
        };
        return;
      }

      if (rectEl) {
        const q = page.questions.find(
          (item) => item.id === (rectEl as HTMLElement).dataset.id,
        );
        const targetRect = q ? getQuestionRects(q)[rectIndex] : null;
        if (!q || !targetRect) return;
        onActiveChange(q.id, pageIndex);
        interactionRef.current = {
          mode: 'move',
          id: q.id,
          rectIndex,
          pageIndex,
          startX: e.clientX,
          startY: e.clientY,
          startRect: { ...targetRect },
        };
        return;
      }

      const point = toImagePoint(pageIndex, e.clientX, e.clientY);
      if (!point) return;

      const id = createId();
      const newQuestion = normalizeQuestionShape({
        id,
        no: nextQuestionNo(),
        type: QUESTION_TYPES[0],
        rect: { x: point.x, y: point.y, w: 0, h: 0 },
        rects: [{ x: point.x, y: point.y, w: 0, h: 0 }],
      });

      setPages((prev) => {
        const next = structuredClone(prev);
        next[pageIndex].questions.push(newQuestion);
        return next;
      });

      onActiveChange(id, pageIndex);
      interactionRef.current = {
        mode: 'draw',
        id,
        rectIndex: 0,
        pageIndex,
        startX: point.x,
        startY: point.y,
      };
    },
    [pagesRef, setPages, toImagePoint, onActiveChange, nextQuestionNo],
  );

  useEffect(() => {
    const applyMove = (latestEvent: MouseEvent) => {
      const interaction = interactionRef.current;
      if (!latestEvent || !interaction) return;
      const pageIndex = interaction.pageIndex;

      setPages((prev) => {
        const sourcePage = prev[pageIndex];
        if (!sourcePage) return prev;
        const next = [...prev];
        const targetPage = structuredClone(sourcePage);
        next[pageIndex] = targetPage;

        const q = targetPage.questions.find(
          (item) => item.id === interaction.id,
        ) as QietiQuestion | undefined;
        if (!q) return prev;
        const rects = ensureQuestionRects(q);
        const targetRect = rects[interaction.rectIndex];
        if (!targetRect) return prev;

        const page = targetPage;

        if (interaction.mode === 'draw') {
          const point = toImagePoint(
            pageIndex,
            latestEvent.clientX,
            latestEvent.clientY,
          );
          if (!point) return prev;
          rects[interaction.rectIndex] = normalizedRect(
            interaction.startX,
            interaction.startY,
            point.x,
            point.y,
          );
        }

        if (interaction.mode === 'move') {
          const point = toImagePoint(
            pageIndex,
            latestEvent.clientX,
            latestEvent.clientY,
          );
          const start = toImagePoint(
            pageIndex,
            interaction.startX,
            interaction.startY,
          );
          if (!point || !start || !interaction.startRect) return prev;
          const dx = point.x - start.x;
          const dy = point.y - start.y;
          targetRect.x = clamp(
            interaction.startRect.x + dx,
            0,
            page.width - targetRect.w,
          );
          targetRect.y = clamp(
            interaction.startRect.y + dy,
            0,
            page.height - targetRect.h,
          );
        }

        if (interaction.mode === 'resize' && interaction.handle) {
          const point = toImagePoint(
            pageIndex,
            latestEvent.clientX,
            latestEvent.clientY,
          );
          if (!point || !interaction.startRect) return prev;
          rects[interaction.rectIndex] = resizeRectByHandle(
            interaction.startRect,
            interaction.handle,
            point,
            page.width,
            page.height,
          );
        }

        syncQuestionRect(q);
        return next;
      });
    };

    const onMove = (e: MouseEvent) => {
      lastMoveEventRef.current = e;
      if (moveFrameRef.current) return;
      moveFrameRef.current = window.requestAnimationFrame(() => {
        moveFrameRef.current = 0;
        if (lastMoveEventRef.current) applyMove(lastMoveEventRef.current);
      });
    };

    const onUp = () => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const pageIndex = interaction.pageIndex;

      setPages((prev) => {
        const next = structuredClone(prev);
        const page = next[pageIndex];
        if (!page) return prev;
        const q = page.questions.find((item) => item.id === interaction.id);
        if (!q) return prev;
        const rects = ensureQuestionRects(q);
        const targetRect = rects[interaction.rectIndex];
        if (!targetRect) return prev;

        // 过小的框视为误触：移除该矩形；题目无矩形则整体删除
        if (targetRect.w < MIN_SIZE || targetRect.h < MIN_SIZE) {
          rects.splice(interaction.rectIndex, 1);
          if (!rects.length) {
            page.questions = page.questions.filter((item) => item.id !== q.id);
            reindexQuestions(next);
            return next;
          }
        }

        syncQuestionRect(q);
        return next;
      });

      interactionRef.current = null;
      if (moveFrameRef.current) {
        window.cancelAnimationFrame(moveFrameRef.current);
        moveFrameRef.current = 0;
      }
      lastMoveEventRef.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [setPages, toImagePoint]);

  return { handleOverlayMouseDown };
}
