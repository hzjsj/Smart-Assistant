import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import { Button, Drawer, message } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { chatTokens } from '../../chatTokens';
import {
  groupQuestions,
  questionSectionHeading,
} from '../../question-bank/protocol';
import {
  createPaperExport,
  downloadExport,
  storePaperPdf,
} from '../../question-bank/service';
import type { ExportResponse, PaperResponse } from '../../question-bank/types';
import { QuestionMarkdown } from './QuestionMarkdown';
import { QuestionStem } from './QuestionStem';
import { useQuestionBankStyles } from './style';

const PaperPreview: React.FC<{
  paper: PaperResponse | null;
  onClose: () => void;
}> = ({ paper, onClose }) => {
  const { styles } = useQuestionBankStyles();
  const contentRef = useRef<HTMLDivElement>(null);
  const [drawerSize, setDrawerSize] = useState<string | number>('60%');
  const [wide, setWide] = useState(
    () => window.matchMedia('(min-width: 1000px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1000px)');
    const change = () => setWide(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const [exporting, setExporting] = useState('');
  const [printing, setPrinting] = useState(false);
  const [messageApi, holder] = message.useMessage();
  const groups = useMemo(
    () => groupQuestions(paper?.document.questions || []),
    [paper],
  );
  const orderedQuestions = groups.flatMap(([, questions]) => questions);
  let questionIndex = 0;
  const printPreview = async () => {
    const element = contentRef.current;
    if (!paper || !element || printing) return;
    // Open synchronously from the click so the browser permits the print tab.
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      messageApi.warning('请允许浏览器弹出窗口后重试打印预览');
      return;
    }
    printWindow.opener = null;
    setPrinting(true);
    try {
      const printDocument = printWindow.document;
      printDocument.open();
      printDocument.write(
        '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
      );
      printDocument.close();
      printDocument.title = paper.title;
      printDocument.documentElement.lang = 'zh-CN';
      // about:blank must resolve relative font/image URLs against this app.
      const base = printDocument.createElement('base');
      base.href = document.baseURI;
      printDocument.head.appendChild(base);
      const formulaFonts = new Set(
        Array.from(element.querySelectorAll('.katex, .katex *'), (node) =>
          getComputedStyle(node)
            .fontFamily.split(',')[0]
            .replace(/["']/g, '')
            .trim(),
        ),
      );
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRule[];
        try {
          rules = Array.from(sheet.cssRules);
        } catch {
          if (sheet.href) {
            const link = printDocument.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            await new Promise<void>((resolve) => {
              link.onload = () => resolve();
              link.onerror = () => resolve();
              printDocument.head.appendChild(link);
            });
          }
          continue;
        }
        // CSS-in-JS rules may only exist in CSSOM, not in style.textContent.
        const style = printDocument.createElement('style');
        style.textContent = (
          await Promise.all(
            rules.map(async (rule) => {
              let text = rule.cssText;
              if (
                rule instanceof CSSFontFaceRule &&
                formulaFonts.has(
                  rule.style
                    .getPropertyValue('font-family')
                    .replace(/["']/g, '')
                    .trim(),
                )
              ) {
                const src = rule.style
                  .getPropertyValue('src')
                  .match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
                if (src) {
                  // Embed only the formula fonts in use: the isolated print tab
                  // then renders without a second asynchronous font request.
                  const response = await fetch(
                    new URL(src, sheet.href || document.baseURI),
                  );
                  if (!response.ok) throw new Error('公式字体读取失败');
                  const blob = await response.blob();
                  const dataUrl = await new Promise<string>(
                    (resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(String(reader.result));
                      reader.onerror = () => reject(reader.error);
                      reader.readAsDataURL(blob);
                    },
                  );
                  text = text.replace(
                    /src:\s*[^;]+;/,
                    `src: url("${dataUrl}");`,
                  );
                }
              }
              return text.replace(
                /url\(\s*(["']?)([^"')]+)\1\s*\)/g,
                (_match, _quote, url) =>
                  `url("${new URL(url, sheet.href || document.baseURI).href}")`,
              );
            }),
          )
        ).join('\n');
        printDocument.head.appendChild(style);
      }
      const printStyles = printDocument.createElement('style');
      printStyles.textContent = `
        @page { size: A4; margin: 15mm; }
        html, body { margin: 0; padding: 0; height: auto; min-width: 0; background: #fff; font-family: ${chatTokens.fontFamily}; }
        [data-paper-preview] { width: 100%; max-width: none; margin: 0; padding: 0; }
        [data-paper-preview] section { break-inside: avoid; }
        [data-paper-preview] img { max-width: 100%; }
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      `;
      printDocument.head.appendChild(printStyles);
      printDocument.body.replaceChildren(element.cloneNode(true));
      printDocument.body.getBoundingClientRect();
      printWindow.focus();
      await printDocument.fonts.ready;
      await Promise.all(
        Array.from(printDocument.images, (image) =>
          image.decode().catch(() => {}),
        ),
      );
      if (printWindow.closed) return;
      printWindow.addEventListener('afterprint', () => printWindow.close(), {
        once: true,
      });
      printWindow.focus();
      printWindow.print();
    } catch {
      printWindow.close();
      messageApi.error('打印预览打开失败，请重试');
    } finally {
      setPrinting(false);
    }
  };
  const exportFile = async (format: 'docx' | 'pdf' | 'xlsx' | 'json') => {
    if (!paper || exporting) return;
    setExporting(format);
    try {
      let file: ExportResponse;
      if (format === 'pdf') {
        const element = contentRef.current;
        if (!element) throw new Error('试卷预览尚未就绪');
        // Render the same saved snapshot shown in the preview, including KaTeX.
        await Promise.all([
          document.fonts.load('16px KaTeX_Main'),
          document.fonts.load('italic 16px KaTeX_Math'),
        ]);
        const html2pdf = (await import('html2pdf.js')).default;
        const options = {
          margin: 12,
          filename: `${paper.title}.pdf`,
          image: { type: 'jpeg' as const, quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
          },
          jsPDF: {
            unit: 'mm' as const,
            format: 'a4',
            orientation: 'portrait' as const,
          },
          pagebreak: { mode: ['css', 'legacy'] },
        };
        const blob: Blob = await html2pdf()
          .set(options)
          .from(element)
          .outputPdf('blob');
        file = await storePaperPdf(paper.id, blob);
      } else file = await createPaperExport(paper.id, format);
      await downloadExport(file);
      messageApi.success('已开始下载');
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : '文件生成失败，请重试',
      );
    } finally {
      setExporting('');
    }
  };

  return (
    <>
      {holder}
      <Drawer
        open={Boolean(paper)}
        title="试卷预览"
        placement="right"
        onClose={onClose}
        size={wide ? drawerSize : '100%'}
        resizable={wide ? { onResize: setDrawerSize } : false}
        rootClassName={styles.previewDrawer}
        styles={{
          wrapper: { maxWidth: '100vw', minWidth: wide ? 640 : undefined },
        }}
        destroyOnHidden={false}
        extra={
          paper && (
            <div className={styles.previewActions}>
              <Button
                aria-label="打印预览"
                icon={<PrinterOutlined aria-hidden />}
                loading={printing}
                onClick={() => void printPreview()}
              >
                打印预览
              </Button>
              {(
                [
                  ['docx', '下载 Word'],
                  ['pdf', '下载 PDF'],
                  ['xlsx', '下载双向细目表'],
                  ['json', '下载试卷 JSON'],
                ] as const
              ).map(([format, label]) => (
                <Button
                  key={format}
                  type={format === 'pdf' ? 'primary' : 'default'}
                  aria-label={label}
                  icon={<DownloadOutlined aria-hidden />}
                  loading={exporting === format}
                  disabled={Boolean(exporting) && exporting !== format}
                  onClick={() => void exportFile(format)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )
        }
      >
        {paper && (
          <div ref={contentRef} className={styles.preview} data-paper-preview>
            <header className={styles.previewHeader}>
              <h1>{paper.title}</h1>
              <div className={styles.previewSubtitle}>
                {paper.document.subject} · {paper.document.grade} ·{' '}
                {paper.document.exam_type}
              </div>
              <div className={styles.previewInfo}>
                <span>题目数量：{paper.question_count} 题</span>
                <span>
                  {paper.total_score === null
                    ? '部分题目未标注分值'
                    : `总分 ${paper.total_score} 分`}
                </span>
              </div>
            </header>
            {groups.map(([type, questions], groupIndex) => (
              <div key={type}>
                <h2 className={styles.previewGroupTitle}>
                  {questionSectionHeading(type, questions, groupIndex)}
                </h2>
                {questions.map((question) => {
                  questionIndex += 1;
                  return (
                    <section
                      key={question.id}
                      className={styles.previewQuestion}
                    >
                      <QuestionStem
                        number={questionIndex}
                        content={question.content}
                      />
                      <div className={styles.previewOptions}>
                        {question.options.map((option) => (
                          <QuestionMarkdown
                            key={option.label}
                            content={`${option.label}. ${option.content}`}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            ))}
            {paper.include_answers && (
              <section className={styles.previewAnswers}>
                <h2>参考答案与解析</h2>
                {orderedQuestions.map((question, index) => (
                  <div key={question.id} className={styles.previewQuestion}>
                    <strong>第 {index + 1} 题</strong>
                    <div className={styles.previewAnswerBlock}>
                      <QuestionMarkdown
                        content={`答案：${question.answer || '未提供'}`}
                      />
                      <QuestionMarkdown content={question.analysis} />
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
};

export default PaperPreview;
