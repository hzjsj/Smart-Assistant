import {
  ApartmentOutlined,
  ClearOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownloadOutlined,
  FileTextOutlined,
  ProfileOutlined,
  SaveOutlined,
  ScanOutlined,
} from '@ant-design/icons';
import { history } from '@umijs/max';
import { App, Button, Popconfirm, Splitter, Tooltip } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CACHE_KEY,
  DETECT_REQUESTS_PER_SECOND,
  IMAGE_MAX_SIZE,
  PDF_MAX_SIZE,
  QUESTION_TYPES,
} from '../constants';
import type { QietiPage, QietiQuestion, QuestionRect, Rect } from '../data';
import { cutQuestions, saveSnapshot, uploadImage } from '../service';
import { createRequestScheduler, downloadTextFile } from '../utils/exportUtils';
import {
  dataUrlToFile,
  extractUploadedImageUrl,
  fileToDataUrl,
  getImageSize,
} from '../utils/fileUtils';
import {
  createId,
  ensureQuestionRects,
  getQuestionPrimaryRect,
  getQuestionRects,
  isMergedQuestion,
  mapApiQuestionType,
  mergeCutApiEntries,
  mergeQuestions,
  normalizeQuestionInfo,
  normalizeQuestionShape,
  rectsFromPosList,
  reindexQuestions,
  serializeRect,
  syncQuestionRect,
  toPercentRect,
  unmergeQuestion,
} from '../utils/questionUtils';
import PageViewer, { type MergeBarInfo } from './components/PageViewer';
import QuestionList from './components/QuestionList';
import UploadCard from './components/UploadCard';
import { useStyles } from './styles';

let pdfjsLibRef: unknown = null;

async function loadPdfJs() {
  if (pdfjsLibRef) return pdfjsLibRef as Record<string, unknown>;
  const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as Record<
    string,
    unknown
  >;
  const GlobalWorkerOptions = lib.GlobalWorkerOptions as { workerSrc: string };
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  pdfjsLibRef = lib;
  return lib;
}

export default function QietiCutPage() {
  const { message, modal } = App.useApp();
  const { styles, cx } = useStyles();

  const pageSectionRefs = useRef<(HTMLElement | null)[]>([]);
  const thumbRefs = useRef<(HTMLElement | null)[]>([]);
  const pagesRef = useRef<QietiPage[]>([]);
  const detectRunIdRef = useRef(0);
  const autoDetectRef = useRef<
    ((seedPages?: QietiPage[]) => Promise<void>) | null
  >(null);
  const initializedFromUrlRef = useRef(false);
  const cacheErrorShownRef = useRef(false);

  const [pages, setPages] = useState<QietiPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  /** 多选集合（Ctrl+点击合并用）；主选中 = 集合末位，兼容原单选语义 */
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const activeQuestionId = selectedQuestionIds.at(-1) ?? null;
  const [detecting, setDetecting] = useState(false);
  const [exportingMd, setExportingMd] = useState(false);
  /** 一题多框：接口碎片默认归并为一题；关闭后每个碎片独立成题 */
  const [mergeFragments, setMergeFragments] = useState(true);
  /** 供 runAutoDetect 闭包读取的当前值（ref 避免依赖过期闭包） */
  const mergeFragmentsRef = useRef(true);
  /** 右侧 Win10 风格导航栏显示/收起 */
  const [navOpen, setNavOpen] = useState(true);

  // 导航栏开合通过 CSS 变量广播给所有层级（含 Portal 渲染的缩略图坞）腾出右缘空间
  useEffect(() => {
    document.body.style.setProperty('--qieti-nav-w', navOpen ? '56px' : '0px');
    return () => {
      document.body.style.removeProperty('--qieti-nav-w');
    };
  }, [navOpen]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // 操作提示统一走全局 Message（toast），不再占用页面内联空间
  const setHint = useCallback(
    (text: string, isError = false) => {
      if (isError) message.error(text);
      else message.success(text);
    },
    [message],
  );

  const isRenderableImageSrc = (value: unknown): value is string =>
    typeof value === 'string' &&
    (/^https?:\/\//.test(value) || /^data:image\//.test(value));

  const getPageImageSrc = useCallback((page: QietiPage): string => {
    if (isRenderableImageSrc(page?.imageUrl)) return page.imageUrl;
    if (isRenderableImageSrc(page?.uploadedImageUrl))
      return page.uploadedImageUrl;
    return '';
  }, []);

  const allQuestions = useMemo(
    () =>
      pages
        .flatMap((p, pageIndex) =>
          p.questions.map((q) => ({ ...q, pageIndex })),
        )
        .sort((a, b) => a.no - b.no),
    [pages],
  );

  const pageIndexById = useMemo(
    () => new Map(pages.map((page, index) => [page.id, index] as const)),
    [pages],
  );

  const questionPreviewList = useMemo(
    () =>
      allQuestions.map((q) => {
        const rects = getQuestionRects(q);
        const pageIds = new Set(
          rects.map((rect) => rect.pageId ?? pages[q.pageIndex]?.id ?? ''),
        );
        const pageIndices = [...pageIds]
          .map((pid) => pageIndexById.get(pid))
          .filter((v): v is number => v !== undefined)
          .sort((a, b) => a - b);
        return {
          id: q.id,
          no: q.no,
          pageIndex: q.pageIndex,
          pageIndices: pageIndices.length ? pageIndices : [q.pageIndex],
          type: q.type,
          rectCount: rects.length,
          mergedImage: q.mergedImage || '',
          figures: q.info?.figures || [],
          stemText: q.info?.stemText || '',
          optionTexts: q.info?.optionTexts || [],
          subquestionTexts: q.info?.subquestionTexts || [],
          fullText: q.info?.fullText || '',
        };
      }),
    [allQuestions, pages, pageIndexById],
  );

  /** 每页应渲染的题目（框在该页的题；跨页题会同时出现在多页），供画布按页渲染 */
  const questionsByPageId = useMemo(() => {
    const map = new Map<string, QietiQuestion[]>();
    for (const page of pages) map.set(page.id, []);
    for (const page of pages) {
      for (const question of page.questions) {
        for (const rect of getQuestionRects(question)) {
          const list = map.get(rect.pageId ?? page.id);
          if (list && !list.some((item) => item.id === question.id)) {
            list.push(question);
          }
        }
      }
    }
    return map;
  }, [pages]);

  /** 页面尺寸查询表：跨页题的框按所在页宽高 clamp */
  const pagesMetaById = useMemo(
    () =>
      new Map(
        pages.map((page) => [
          page.id,
          { id: page.id, width: page.width, height: page.height },
        ]),
      ),
    [pages],
  );

  /** 浮动操作条摘要：多选数量/分布页数/主选中是否合并题 */
  const mergeBar = useMemo<MergeBarInfo>(() => {
    const selected = allQuestions.filter((q) =>
      selectedQuestionIds.includes(q.id),
    );
    return {
      count: selected.length,
      pageCount: new Set(selected.map((q) => q.pageIndex)).size,
      primaryMerged: isMergedQuestion(
        selected.find((q) => q.id === (selectedQuestionIds.at(-1) ?? null)),
      ),
    };
  }, [allQuestions, selectedQuestionIds]);

  const nextQuestionNo = useCallback(
    () =>
      pagesRef.current
        .flatMap((p) => p.questions)
        .reduce((max, q) => Math.max(max, q.no), 0) + 1,
    [],
  );

  // ─── 本地缓存：恢复与写入 ────────────────────────────────────────────
  // 恢复完成前置位：完成前禁止空写入覆盖已有缓存（防止挂载即写空丢数据）
  const restoredRef = useRef(false);
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(CACHE_KEY);
    } catch {
      setHint('浏览器限制导致无法读取本地缓存', true);
      restoredRef.current = true;
      return;
    }
    if (!raw) {
      restoredRef.current = true;
      return;
    }

    try {
      const cache = JSON.parse(raw) as {
        pages?: QietiPage[];
        currentPageIndex?: number;
        mergeFragments?: boolean;
      };
      if (Array.isArray(cache.pages)) {
        const normalizedPages = cache.pages.map((page) => ({
          ...page,
          questions: Array.isArray(page.questions)
            ? page.questions.map((q) => normalizeQuestionShape(q, page.id))
            : [],
        }));
        setPages(normalizedPages);
        setCurrentPageIndex(Number(cache.currentPageIndex) || 0);
        if (typeof cache.mergeFragments === 'boolean') {
          setMergeFragments(cache.mergeFragments);
          mergeFragmentsRef.current = cache.mergeFragments;
        }
        setHint(`已恢复本地缓存：${normalizedPages.length} 页`);
      }
      restoredRef.current = true;
    } catch {
      localStorage.removeItem(CACHE_KEY);
      restoredRef.current = true;
    }
  }, [setHint]);

  useEffect(() => {
    // 恢复完成前（含挂载首轮）禁止写入：pages 尚为空时不覆盖已有缓存。
    // 显式清空走 clearAll（自行 removeItem），不经此写入。
    if (!restoredRef.current) return;
    if (!pages.length) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ pages, currentPageIndex, mergeFragments }),
      );
      cacheErrorShownRef.current = false;
    } catch (error) {
      const isQuotaExceeded =
        error instanceof DOMException &&
        (error.name === 'QuotaExceededError' ||
          error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      if (!cacheErrorShownRef.current) {
        setHint(
          isQuotaExceeded
            ? '本地缓存空间不足，当前修改仅在本次会话有效'
            : '浏览器限制导致无法写入本地缓存',
          true,
        );
        cacheErrorShownRef.current = true;
      }
    }
  }, [pages, currentPageIndex, mergeFragments, setHint]);

  // ─── 云端快照防抖同步（失败不影响本地编辑）───────────────────────────
  useEffect(() => {
    if (!pages.length) return;
    const timer = window.setTimeout(() => {
      saveSnapshot(pages, currentPageIndex).catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
  }, [pages, currentPageIndex]);

  // ─── 上传记录跳转：URL 参数 imageUrl+fileName 自动加载并识别 ─────────
  useEffect(() => {
    if (initializedFromUrlRef.current) return;
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const imageUrlParam = url.searchParams.get('imageUrl');
    const fileNameParam = url.searchParams.get('fileName');
    if (!imageUrlParam) return;

    initializedFromUrlRef.current = true;
    const decodedImageUrl = decodeURIComponent(imageUrlParam);

    if (!isRenderableImageSrc(decodedImageUrl)) {
      setHint('链接中的图片地址无效', true);
      return;
    }

    (async () => {
      try {
        const size = await getImageSize(decodedImageUrl);
        const pageName = fileNameParam
          ? decodeURIComponent(fileNameParam)
          : '上传记录跳转';
        const nextPages: QietiPage[] = [
          {
            id: createId(),
            name: pageName,
            imageUrl: decodedImageUrl,
            uploadedImageUrl: /^https?:\/\//.test(decodedImageUrl)
              ? decodedImageUrl
              : null,
            width: size.width,
            height: size.height,
            questions: [],
          },
        ];
        setPages(nextPages);
        setCurrentPageIndex(0);
        setSelectedQuestionIds([]);
        setHint(`已加载上传记录图片：${pageName}`);
        await autoDetectRef.current?.(nextPages);
      } catch (error) {
        setHint(
          error instanceof Error ? error.message : '上传记录图片加载失败',
          true,
        );
      } finally {
        url.searchParams.delete('imageUrl');
        url.searchParams.delete('fileName');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    })();
  }, [setHint]);

  // ─── 上传解析：PDF（pdfjs 逐页渲染）/ 图片 ─────────────────────────
  const handleFiles = async (files: File[]) => {
    const pdfFiles = files.filter((f) => f.type === 'application/pdf');
    const imageFiles = files.filter((f) => /^image\/(png|jpeg)$/.test(f.type));

    if (pdfFiles.length > 1) {
      setHint('一次只允许上传 1 个 PDF', true);
      return;
    }
    if (!pdfFiles.length && !imageFiles.length) {
      setHint('仅支持 PDF / PNG / JPG', true);
      return;
    }

    try {
      if (pdfFiles.length) {
        const file = pdfFiles[0];
        if (file.size > PDF_MAX_SIZE) throw new Error('PDF 文件不能超过 50MB');
        await importPdf(file);
      } else {
        for (const file of imageFiles) {
          if (file.size > IMAGE_MAX_SIZE)
            throw new Error(`图片 ${file.name} 超过 10MB`);
        }
        await importImages(imageFiles);
      }
    } catch (err) {
      setHint(err instanceof Error ? err.message : '文件解析失败', true);
    }
  };

  const importPdf = async (file: File) => {
    const lib = (await loadPdfJs()) as {
      getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<any> };
    };
    const data = await file.arrayBuffer();
    const pdfDoc = await lib.getDocument({ data }).promise;
    const newPages: QietiPage[] = [];

    for (let i = 1; i <= pdfDoc.numPages; i += 1) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) continue;
      await page.render({ canvasContext: context, viewport }).promise;

      newPages.push({
        id: createId(),
        name: `${file.name} - 第${i}页`,
        imageUrl: canvas.toDataURL('image/png'),
        uploadedImageUrl: null,
        width: canvas.width,
        height: canvas.height,
        questions: [],
      });
    }

    setPages(newPages);
    setCurrentPageIndex(0);
    setSelectedQuestionIds([]);
    setHint(`成功加载 ${newPages.length} 页`);
    await runAutoDetect(newPages);
  };

  const importImages = async (files: File[]) => {
    const newPages: QietiPage[] = [];
    for (const file of files) {
      const imageUrl = await fileToDataUrl(file);
      const size = await getImageSize(imageUrl);
      newPages.push({
        id: createId(),
        name: file.name,
        imageUrl,
        uploadedImageUrl: null,
        width: size.width,
        height: size.height,
        questions: [],
      });
    }

    setPages(newPages);
    setCurrentPageIndex(0);
    setSelectedQuestionIds([]);
    setHint(`成功加载 ${newPages.length} 页`);
    await runAutoDetect(newPages);
  };

  // ─── 自动识别：上传 TOS → EduTutor 切题 → 矩形+结构化信息 ───────────
  const ensureRemoteImageUrl = async (
    page: QietiPage,
    pageIndex: number,
  ): Promise<string> => {
    if (
      typeof page?.uploadedImageUrl === 'string' &&
      /^https?:\/\//.test(page.uploadedImageUrl)
    ) {
      return page.uploadedImageUrl;
    }
    if (
      typeof page?.imageUrl === 'string' &&
      /^https?:\/\//.test(page.imageUrl)
    ) {
      return page.imageUrl;
    }

    const file = await dataUrlToFile(
      page.imageUrl,
      `${page.name || 'page'}_${pageIndex + 1}.jpg`,
    );
    const uploadData = await uploadImage(file);
    const remoteUrl = extractUploadedImageUrl(uploadData);
    if (!remoteUrl) {
      throw new Error(`第 ${pageIndex + 1} 页上传失败`);
    }
    return remoteUrl;
  };

  const runAutoDetect = useCallback(
    async (seedPages?: QietiPage[]) => {
      const source = seedPages || pagesRef.current;
      if (!source.length || detecting) return;

      const runId = detectRunIdRef.current + 1;
      detectRunIdRef.current = runId;
      setDetecting(true);

      const setDetectHint = (text: string, isError = false) => {
        if (detectRunIdRef.current !== runId) return;
        setHint(text, isError);
      };

      try {
        const next = structuredClone(source) as QietiPage[];
        const scheduleRequest = createRequestScheduler(
          DETECT_REQUESTS_PER_SECOND,
        );
        let completedPages = 0;
        let successPages = 0;

        setDetectHint(`自动识别中：已完成 0/${next.length} 页`);

        const pageResults = await Promise.allSettled(
          next.map(async (page, i) => {
            try {
              const uploadedUrl = await scheduleRequest(() =>
                ensureRemoteImageUrl(page, i),
              );
              const cutData = await scheduleRequest(async () =>
                cutQuestions(uploadedUrl),
              );

              // 接口常把一题拆成「题干 + 各选项 + 答案」多条碎片，默认按题干归并成题；
              // 工具栏关闭「一题多框合并」时，每个碎片各自成题
              const rawEntries = cutData?.questions_data?.questions || [];
              const mergedQuestions = mergeFragmentsRef.current
                ? mergeCutApiEntries(rawEntries)
                : rawEntries;

              const questions = mergedQuestions
                .map((question) => {
                  const rects = rectsFromPosList(question?.pos_list, page);
                  if (!rects.length) return null;
                  return normalizeQuestionShape({
                    id: createId(),
                    no: 0,
                    type: mapApiQuestionType(question?.info?.type),
                    rect: rects[0],
                    rects,
                    subImages: Array.isArray(question?.sub_images)
                      ? question.sub_images.filter(
                          (item) => typeof item === 'string' && item.trim(),
                        )
                      : [],
                    mergedImage:
                      typeof question?.merged_image === 'string'
                        ? question.merged_image
                        : '',
                    info: normalizeQuestionInfo(question?.info, uploadedUrl),
                  });
                })
                .filter((q): q is NonNullable<typeof q> => q !== null);

              return { uploadedUrl, questions };
            } finally {
              completedPages += 1;
              setDetectHint(
                `自动识别中：已完成 ${completedPages}/${next.length} 页`,
              );
            }
          }),
        );

        const failedMessages: string[] = [];
        pageResults.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            successPages += 1;
            next[i].uploadedImageUrl = result.value.uploadedUrl;
            next[i].questions = result.value.questions;
          } else {
            failedMessages.push(
              result.reason instanceof Error
                ? result.reason.message
                : `第 ${i + 1} 页处理失败`,
            );
          }
        });

        reindexQuestions(next);
        const detectedCount = next.reduce(
          (sum, page) => sum + page.questions.length,
          0,
        );
        if (detectRunIdRef.current !== runId) return;

        setPages(next);
        setSelectedQuestionIds([]);

        if (failedMessages.length) {
          const summary = failedMessages.slice(0, 2).join('；');
          const suffix =
            failedMessages.length > 2
              ? ` 等 ${failedMessages.length} 页失败`
              : '';
          setDetectHint(
            `自动识别完成：成功 ${successPages}/${next.length} 页，共识别 ${detectedCount} 题。${summary}${suffix}`,
            true,
          );
        } else {
          setDetectHint(`自动识别完成：共识别 ${detectedCount} 题`);
        }
      } catch (error) {
        setDetectHint(
          error instanceof Error ? error.message : '自动识别失败',
          true,
        );
      } finally {
        if (detectRunIdRef.current === runId) {
          setDetecting(false);
        }
      }
    },
    [detecting, setHint],
  );

  autoDetectRef.current = runAutoDetect;

  // ─── 导出：全部题目 Markdown / 题库 JSON ────────────────────────────
  const downloadAllQuestionsMarkdown = async () => {
    if (!questionPreviewList.length || exportingMd) return;

    setExportingMd(true);
    try {
      const markdownBlocks = questionPreviewList.map((preview) => {
        const sections: string[] = [];
        if (preview.mergedImage)
          sections.push('【题干图片】', `![](${preview.mergedImage})`);
        if (preview.stemText)
          sections.push('【题干内容】', ` ${preview.stemText}`);
        for (const figure of preview.figures) sections.push(`![](${figure})`);
        for (const text of preview.optionTexts) sections.push(text);
        for (const text of preview.subquestionTexts) sections.push(text);
        return sections.join('\n\n');
      });

      downloadTextFile(
        markdownBlocks.join('\n\n'),
        `全部题目_${new Date().toISOString().slice(0, 10)}.md`,
        'text/markdown',
      );
      setHint(
        `全部题目 Markdown 下载完成：共 ${questionPreviewList.length} 题`,
      );
    } catch (error) {
      setHint(
        error instanceof Error ? error.message : '全部题目 Markdown 下载失败',
        true,
      );
    } finally {
      setExportingMd(false);
    }
  };

  const saveToBank = () => {
    const payload = {
      savedAt: new Date().toISOString(),
      totalPages: pages.length,
      totalQuestions: allQuestions.length,
      pages: pages.map((p, pageIndex) => ({
        pageIndex,
        name: p.name,
        width: p.width,
        height: p.height,
        questions: p.questions
          .slice()
          .sort((a, b) => a.no - b.no)
          .map((q) => {
            const rects = getQuestionRects(q);
            // 框可能寄存在其他页：百分比相对框所在页计算
            const rectHost = (rect: QuestionRect) =>
              pages.find((item) => item.id === (rect.pageId ?? p.id)) ?? p;
            return {
              no: q.no,
              type: q.type,
              rectPx: serializeRect(getQuestionPrimaryRect(q)),
              rectPercent: toPercentRect(getQuestionPrimaryRect(q), p),
              rectsPx: rects.map((rect) => ({
                ...serializeRect(rect),
                pageId: rect.pageId ?? p.id,
              })),
              rectsPercent: rects.map((rect) => ({
                ...toPercentRect(rect, rectHost(rect)),
                pageId: rect.pageId ?? p.id,
              })),
              ...(q.sources ? { sources: q.sources } : {}),
            };
          }),
      })),
    };

    downloadTextFile(
      JSON.stringify(payload, null, 2),
      `题库_${Date.now()}.json`,
      'application/json',
    );
    setHint(`已保存，共 ${payload.totalQuestions} 题`);
  };

  // ─── 题目操作 ───────────────────────────────────────────────────────
  const deleteQuestion = (id: string) => {
    setPages((prev) => {
      const next = structuredClone(prev);
      next.forEach((page) => {
        page.questions = page.questions.filter((q) => q.id !== id);
      });
      reindexQuestions(next);
      return next;
    });
    setSelectedQuestionIds((prev) => prev.filter((item) => item !== id));
    message.success('题目已删除');
  };

  const switchPage = (index: number) => {
    if (index < 0 || index >= pages.length) return;
    setCurrentPageIndex(index);
    setSelectedQuestionIds([]);
    pageSectionRefs.current[index]?.scrollIntoView({
      block: 'start',
      behavior: 'smooth',
    });
  };

  const locateQuestion = (pageIndex: number, questionId: string) => {
    setCurrentPageIndex(pageIndex);
    setSelectedQuestionIds([questionId]);
    pageSectionRefs.current[pageIndex]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  };

  const clearAll = () => {
    setPages([]);
    setCurrentPageIndex(0);
    setSelectedQuestionIds([]);
    localStorage.removeItem(CACHE_KEY);
    setHint('已清空');
  };

  /** 切换「一题多框合并」：已有页面时需确认（重新识别会覆盖手动调整） */
  const handleMergeToggle = (checked: boolean) => {
    if (!pages.length) {
      setMergeFragments(checked);
      mergeFragmentsRef.current = checked;
      return;
    }
    modal.confirm({
      title: checked ? '开启一题多框合并' : '取消一题多框合并',
      content:
        '切换后将重新自动识别，当前手动调整（画框/拖动/删除）会被覆盖，继续吗？',
      okText: '继续',
      cancelText: '取消',
      onOk: () => {
        setMergeFragments(checked);
        mergeFragmentsRef.current = checked;
        runAutoDetect();
      },
    });
  };

  // ─── 手动合并 / 解除合并 ────────────────────────────────────────────
  // 确认走内联面板（React 状态驱动）：当前环境 App.useApp 的 modal.confirm
  // 在 onOk/cancel 后对话框滞留不关闭（handleMergeToggle 同样受影响），只能绕开
  const [pendingConfirm, setPendingConfirm] = useState<
    | {
        kind: 'merge';
        ids: string[];
        primaryId: string;
        rows: { id: string; no: number; pageIndex: number; primary: boolean }[];
        pageCount: number;
      }
    | { kind: 'unmerge'; id: string; rectCount: number }
    | null
  >(null);

  const handleMerge = () => {
    const targets = allQuestions.filter((q) =>
      selectedQuestionIds.includes(q.id),
    );
    if (targets.length < 2) return;
    const sorted = [...targets].sort((a, b) => a.no - b.no);
    const primary = sorted[0];
    setPendingConfirm({
      kind: 'merge',
      ids: sorted.map((q) => q.id),
      primaryId: primary.id,
      rows: sorted.map((q) => ({
        id: q.id,
        no: q.no,
        pageIndex: q.pageIndex,
        primary: q.id === primary.id,
      })),
      pageCount: new Set(sorted.map((q) => q.pageIndex)).size,
    });
  };

  const handleUnmerge = (id: string) => {
    const target = allQuestions.find((q) => q.id === id);
    if (!isMergedQuestion(target)) return;
    setPendingConfirm({
      kind: 'unmerge',
      id,
      rectCount: getQuestionRects(target).length,
    });
  };

  const handleConfirmOk = () => {
    if (!pendingConfirm) return;
    if (pendingConfirm.kind === 'merge') {
      const { ids, primaryId } = pendingConfirm;
      setPages((prev) => {
        const next = mergeQuestions(prev, ids);
        if (next === prev) return prev;
        reindexQuestions(next);
        return next;
      });
      setSelectedQuestionIds([primaryId]);
      message.success('已合并为 1 题');
    } else {
      const { id } = pendingConfirm;
      setPages((prev) => {
        const next = unmergeQuestion(prev, id);
        if (next === prev) return prev;
        reindexQuestions(next);
        return next;
      });
      setSelectedQuestionIds([id]);
      message.success('已解除合并');
    }
    setPendingConfirm(null);
  };

  // ─── 划题交互（Konva 画布回调：选中/多选/拖拽/缩放/画新框）───────────
  const selectQuestion = (
    questionId: string,
    pageIndex: number,
    additive = false,
  ) => {
    setCurrentPageIndex(pageIndex);
    setSelectedQuestionIds((prev) => {
      if (!additive) return [questionId];
      return prev.includes(questionId)
        ? prev.filter((item) => item !== questionId)
        : [...prev, questionId];
    });
  };

  const deselectQuestion = () => setSelectedQuestionIds([]);

  const updateQuestionRect = (
    pageIndex: number,
    questionId: string,
    rectIndex: number,
    rect: Rect,
  ) => {
    setPages((prev) => {
      const next = structuredClone(prev);
      const page = next[pageIndex];
      const q = page?.questions.find((item) => item.id === questionId);
      if (!q) return prev;
      const rects = ensureQuestionRects(q);
      if (!rects[rectIndex]) return prev;
      rects[rectIndex] = { ...rect };
      syncQuestionRect(q);
      return next;
    });
  };

  const createQuestionFromRect = (pageIndex: number, rect: Rect) => {
    const id = createId();
    setPages((prev) => {
      const next = structuredClone(prev);
      if (!next[pageIndex]) return prev;
      next[pageIndex].questions.push(
        normalizeQuestionShape({
          id,
          no: nextQuestionNo(),
          type: QUESTION_TYPES[0],
          rect: { ...rect },
          rects: [{ ...rect }],
        }),
      );
      return next;
    });
    setSelectedQuestionIds([id]);
    setCurrentPageIndex(pageIndex);
  };

  return (
    <>
      <div className={styles.workbench}>
        <Splitter className={styles.splitter}>
          <Splitter.Panel min="30%" max="80%">
            <div className={styles.leftPanel}>
              {!pages.length ? (
                <UploadCard onHandleFiles={handleFiles} />
              ) : (
                <PageViewer
                  pages={pages}
                  currentPageIndex={currentPageIndex}
                  onSwitchPage={switchPage}
                  onSelectPage={setCurrentPageIndex}
                  pageSectionRefs={pageSectionRefs}
                  thumbRefs={thumbRefs}
                  selectedQuestionIds={selectedQuestionIds}
                  questionsByPageId={questionsByPageId}
                  pagesMetaById={pagesMetaById}
                  mergeBar={mergeBar}
                  onSelectQuestion={selectQuestion}
                  onDeselectQuestion={deselectQuestion}
                  onChangeRect={updateQuestionRect}
                  onCreateQuestion={createQuestionFromRect}
                  onMerge={handleMerge}
                  onUnmerge={() => {
                    if (activeQuestionId) handleUnmerge(activeQuestionId);
                  }}
                  getPageImageSrc={getPageImageSrc}
                />
              )}
            </div>
          </Splitter.Panel>
          <Splitter.Panel min={280} max="60%" defaultSize={420}>
            <QuestionList
              questionPreviewList={questionPreviewList}
              selectedQuestionIds={selectedQuestionIds}
              onLocateQuestion={locateQuestion}
              onToggleSelect={(id, pageIndex) =>
                selectQuestion(id, pageIndex, true)
              }
              onDeleteQuestion={deleteQuestion}
              onUnmergeQuestion={handleUnmerge}
              onDeselectQuestion={deselectQuestion}
            />
          </Splitter.Panel>
        </Splitter>
      </div>
      {/* 右侧 Win10 风格导航栏（可收起），图标 + 悬停提示 */}
      <aside className={cx(styles.sideNav, !navOpen && styles.sideNavHidden)}>
        <Tooltip title="题目列表" placement="left">
          <Button
            className={styles.sideNavBtn}
            type="text"
            icon={<FileTextOutlined />}
            onClick={() => history.push('/qieti/questions')}
          />
        </Tooltip>
        <Tooltip title="上传记录" placement="left">
          <Button
            className={styles.sideNavBtn}
            type="text"
            icon={<ProfileOutlined />}
            onClick={() => history.push('/qieti/records')}
          />
        </Tooltip>
        <Tooltip
          title={`一题多框合并：${mergeFragments ? '开' : '关'}`}
          placement="left"
        >
          <Button
            className={cx(
              styles.sideNavBtn,
              mergeFragments && styles.sideNavBtnActive,
            )}
            type="text"
            icon={<ApartmentOutlined />}
            onClick={() => handleMergeToggle(!mergeFragments)}
          />
        </Tooltip>
        <div className={styles.sideNavDivider} />
        <Tooltip title="自动识别题目" placement="left">
          <Button
            className={styles.sideNavBtn}
            type="text"
            icon={<ScanOutlined />}
            onClick={() => runAutoDetect()}
            loading={detecting}
            disabled={!pages.length || exportingMd}
          />
        </Tooltip>
        <Tooltip title="下载全部题目" placement="left">
          <Button
            className={styles.sideNavBtn}
            type="text"
            icon={<DownloadOutlined />}
            onClick={downloadAllQuestionsMarkdown}
            loading={exportingMd}
            disabled={!pages.length || detecting}
          />
        </Tooltip>
        <Tooltip title="保存题库" placement="left">
          <Button
            className={styles.sideNavBtn}
            type="text"
            icon={<SaveOutlined />}
            onClick={saveToBank}
            disabled={!pages.length}
          />
        </Tooltip>
        <Tooltip title="清空" placement="left">
          <Popconfirm
            title="确认清空全部页面与题目？"
            okText="清空"
            cancelText="取消"
            onConfirm={clearAll}
          >
            <Button
              className={styles.sideNavBtn}
              type="text"
              danger
              icon={<ClearOutlined />}
              disabled={!pages.length}
            />
          </Popconfirm>
        </Tooltip>
        <div className={styles.sideNavSpacer} />
        <Tooltip title={navOpen ? '收起导航栏' : '展开导航栏'} placement="left">
          <Button
            className={styles.sideNavBtn}
            type="text"
            icon={navOpen ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
            onClick={() => setNavOpen((v) => !v)}
          />
        </Tooltip>
      </aside>
      {!navOpen ? (
        <Tooltip title="展开导航栏" placement="left">
          <Button
            className={styles.sideNavTab}
            type="primary"
            icon={<DoubleLeftOutlined />}
            onClick={() => setNavOpen(true)}
          />
        </Tooltip>
      ) : null}
      {/* 合并/解除合并确认：内联面板（不用 antd Modal —— 当前环境弹层关闭动画
          事件不触发，确认框会滞留挡屏；内联渲染无传送门/动画，行为可靠） */}
      {pendingConfirm ? (
        <div
          className={styles.confirmOverlay}
          onClick={() => setPendingConfirm(null)}
        >
          <div
            className={styles.confirmCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.confirmTitle}>
              {pendingConfirm.kind === 'merge'
                ? `合并 ${pendingConfirm.rows.length} 题为 1 题${
                    pendingConfirm.pageCount > 1
                      ? `（跨 ${pendingConfirm.pageCount} 页）`
                      : ''
                  }`
                : `解除合并：拆分为 ${pendingConfirm.rectCount} 道独立题目`}
            </div>
            {pendingConfirm.kind === 'merge' ? (
              <div className={styles.confirmBody}>
                {pendingConfirm.rows.map((row) => (
                  <div key={row.id}>
                    {row.primary ? '┌' : '├'} 题{row.no}（第 {row.pageIndex + 1}{' '}
                    页）
                    {row.primary ? ' ← 保留题号与内容' : '：框并入，内容拼接'}
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.confirmBody}>
                将完整还原各子题的题干、选项与图片（框落回各自所在页）。
              </div>
            )}
            <div className={styles.confirmWarning}>
              ⚠ {pendingConfirm.kind === 'merge' ? '合并' : '拆分'}
              后不可自动撤销
            </div>
            <div className={styles.confirmActions}>
              <Button onClick={() => setPendingConfirm(null)}>取消</Button>
              <Button type="primary" onClick={handleConfirmOk}>
                {pendingConfirm.kind === 'merge' ? '确认合并' : '确认拆分'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
