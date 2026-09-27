import { MIN_SIZE } from '../constants';
import type { CutApiQuestion, QietiPage, QietiQuestion, Rect } from '../data';

export function createId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function normalizedRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Rect {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function resizeRectByHandle(
  origin: Rect,
  handle: string,
  point: { x: number; y: number },
  maxW: number,
  maxH: number,
): Rect {
  let left = origin.x;
  let right = origin.x + origin.w;
  let top = origin.y;
  let bottom = origin.y + origin.h;

  if (handle.includes('n')) top = clamp(point.y, 0, bottom - MIN_SIZE);
  if (handle.includes('s')) bottom = clamp(point.y, top + MIN_SIZE, maxH);
  if (handle.includes('w')) left = clamp(point.x, 0, right - MIN_SIZE);
  if (handle.includes('e')) right = clamp(point.x, left + MIN_SIZE, maxW);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function serializeRect(rect: Rect): Rect {
  return {
    x: Number(rect.x.toFixed(2)),
    y: Number(rect.y.toFixed(2)),
    w: Number(rect.w.toFixed(2)),
    h: Number(rect.h.toFixed(2)),
  };
}

export function toPercentRect(rect: Rect, page: QietiPage): Rect {
  return {
    x: Number(((rect.x / page.width) * 100).toFixed(2)),
    y: Number(((rect.y / page.height) * 100).toFixed(2)),
    w: Number(((rect.w / page.width) * 100).toFixed(2)),
    h: Number(((rect.h / page.height) * 100).toFixed(2)),
  };
}

export function getQuestionRects(
  question: QietiQuestion | null | undefined,
): Rect[] {
  if (Array.isArray(question?.rects) && question.rects.length)
    return question.rects;
  if (question?.rect) return [question.rect];
  return [];
}

export function ensureQuestionRects(question: QietiQuestion): Rect[] {
  const rects = getQuestionRects(question).map((rect) => ({ ...rect }));
  question.rects = rects;
  if (!question.rect && rects[0]) question.rect = { ...rects[0] };
  return rects;
}

export function getQuestionPrimaryRect(
  question: QietiQuestion | null | undefined,
): Rect {
  return (
    getQuestionRects(question)[0] ||
    question?.rect || { x: 0, y: 0, w: MIN_SIZE, h: MIN_SIZE }
  );
}

export function syncQuestionRect(question: QietiQuestion): void {
  const [firstRect] = getQuestionRects(question);
  question.rect = firstRect ? { ...firstRect } : null;
}

export function normalizeQuestionShape(
  question: Partial<QietiQuestion>,
): QietiQuestion {
  const rects = getQuestionRects(question as QietiQuestion).map((rect) => ({
    ...rect,
  }));
  return {
    id: question.id ?? createId(),
    no: question.no ?? 0,
    type: question.type ?? '',
    subImages: question.subImages ?? [],
    mergedImage: question.mergedImage ?? '',
    info: question.info ?? {
      figures: [],
      stemText: '',
      optionTexts: [],
      subquestionTexts: [],
      fullText: '',
    },
    rects,
    rect: rects[0] ? { ...rects[0] } : (question?.rect ?? null),
  };
}

export function reindexQuestions(pages: QietiPage[]): void {
  const all = pages.flatMap((p) => p.questions).sort((a, b) => a.no - b.no);
  all.forEach((q, idx) => {
    q.no = idx + 1;
  });
}

// ─── 切题接口数据归一化 ────────────────────────────────────────────────

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface RawSubquestion {
  stem?: { text?: string };
  option?: { text?: string }[];
  subquestion?: unknown[];
}

function collectSubquestionTexts(subquestions: unknown): string[] {
  if (!Array.isArray(subquestions) || !subquestions.length) return [];
  return subquestions.flatMap((item) => {
    const raw = item as RawSubquestion;
    const stemText = normalizeText(raw?.stem?.text);
    const optionTexts = Array.isArray(raw?.option)
      ? raw.option.map((option) => normalizeText(option?.text)).filter(Boolean)
      : [];
    const nestedTexts = collectSubquestionTexts(raw?.subquestion);
    const combined = [stemText, ...optionTexts].filter(Boolean).join('\n');
    return [combined, ...nestedTexts].filter(Boolean);
  });
}

function posListToRect(posList: unknown): Rect | null {
  if (!Array.isArray(posList) || !posList.length) return null;
  const points: { x: number; y: number }[] = [];
  for (const poly of posList) {
    if (!Array.isArray(poly)) continue;
    for (let i = 0; i < poly.length - 1; i += 2) {
      const x = Number(poly[i]);
      const y = Number(poly[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    }
  }
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/** 生成 TOS 图片裁剪 URL（x-tos-process），用于无独立图片链接的插图 */
export function buildRemoteCropUrl(imageUrl: string, rect: Rect): string {
  const baseUrl = String(imageUrl || '').split('?')[0];
  if (!/^https?:\/\//.test(baseUrl)) return '';
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.floor(rect.w));
  const h = Math.max(1, Math.floor(rect.h));
  const process = `x-tos-process=image/bright,0/contrast,0/crop,w_${w},h_${h},g_nw,x_${x},y_${y}/rotate,0`;
  return `${baseUrl}?${process}`;
}

function collectFigureUrls(figure: unknown, sourceImageUrl: string): string[] {
  if (!figure) return [];
  if (typeof figure === 'string') return figure.trim() ? [figure.trim()] : [];
  if (Array.isArray(figure))
    return figure.flatMap((item) => collectFigureUrls(item, sourceImageUrl));

  if (typeof figure === 'object') {
    const obj = figure as Record<string, unknown>;
    const candidateKeys = ['url', 'image', 'src', 'figure_url'];
    const urls = candidateKeys
      .map((key) => obj[key])
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim() !== '',
      );
    if (urls.length) return urls;

    const rect = posListToRect(obj.pos_list);
    if (rect && /^https?:\/\//.test(sourceImageUrl)) {
      return [buildRemoteCropUrl(sourceImageUrl, rect)];
    }
  }
  return [];
}

export function normalizeQuestionInfo(
  info: CutApiQuestion['info'] | undefined,
  sourceImageUrl = '',
): QietiQuestion['info'] {
  const stemText = normalizeText(info?.stem?.text);
  const optionTexts = Array.isArray(info?.option)
    ? info.option.map((item) => normalizeText(item?.text)).filter(Boolean)
    : [];
  const subquestionTexts = collectSubquestionTexts(info?.subquestion);

  return {
    figures: collectFigureUrls(info?.figure, sourceImageUrl),
    stemText,
    optionTexts,
    subquestionTexts,
    fullText: [stemText, ...optionTexts, ...subquestionTexts]
      .filter(Boolean)
      .join('\n'),
  };
}

/** pos_list 多边形 → 页面坐标系内的矩形（clamp 到页面边界，保证最小尺寸） */
export function rectsFromPosList(posList: unknown, page: QietiPage): Rect[] {
  if (!Array.isArray(posList) || !posList.length || !page) return [];
  return posList
    .map((poly): Rect | null => {
      if (!Array.isArray(poly)) return null;
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < poly.length - 1; i += 2) {
        const x = Number(poly[i]);
        const y = Number(poly[i + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
      }
      if (!points.length) return null;

      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      const right = Math.max(...xs);
      const bottom = Math.max(...ys);
      const x = clamp(left, 0, Math.max(0, page.width - MIN_SIZE));
      const y = clamp(top, 0, Math.max(0, page.height - MIN_SIZE));
      const w = clamp(
        right - left,
        MIN_SIZE,
        Math.max(MIN_SIZE, page.width - x),
      );
      const h = clamp(
        bottom - top,
        MIN_SIZE,
        Math.max(MIN_SIZE, page.height - y),
      );
      return { x, y, w, h };
    })
    .filter((rect): rect is Rect => rect !== null);
}

// ─── 题目 Markdown 组装（列表渲染与导出共用）──────────────────────────

export function normalizeMathDelimiters(text: string): string {
  return text
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expr) => `$${expr}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => `$$${expr}$$`);
}

export function stripOptionPrefix(text: string): string {
  return text.trim().replace(/^\s*\(?[A-Ha-h]\)?[.、．)]\s*/, '');
}
