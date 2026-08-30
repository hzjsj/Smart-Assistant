import {
  DownloadOutlined,
  FileWordOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import type { DrawerProps } from 'antd';
import { Button, Drawer, message, Space } from 'antd';
import React, { useRef, useState } from 'react';
import { BlockMath, InlineMath } from 'react-katex';
import { ossMdTextToDocxApiOssConvertMdTextToDocxPost } from '@/services/fast-api-manage/osSwenjianshangchuan';
import { getSectionTitle } from './constants';
import type { QuestionItem } from './data';

// ─── Math Rendering Helper ───────────────────────────────────────────────────
const MathText: React.FC<{ text: string }> = ({ text }) => {
  const parts: React.ReactNode[] = [];
  const blockRegex = /\$\$(.+?)\$\$/g;
  const inlineRegex = /\$(.+?)\$/g;
  let key = 0;

  const blockSplit = text.split(blockRegex);
  for (let i = 0; i < blockSplit.length; i++) {
    if (i % 2 === 0) {
      const inlineSplit = blockSplit[i].split(inlineRegex);
      for (let j = 0; j < inlineSplit.length; j++) {
        if (j % 2 === 0) {
          if (inlineSplit[j])
            parts.push(<span key={key++}>{inlineSplit[j]}</span>);
        } else {
          try {
            parts.push(<InlineMath key={key++} math={inlineSplit[j]} />);
          } catch {
            parts.push(<span key={key++}>({inlineSplit[j]})</span>);
          }
        }
      }
    } else {
      try {
        parts.push(<BlockMath key={key++} math={blockSplit[i]} />);
      } catch {
        parts.push(
          <div key={key++} style={{ textAlign: 'center', margin: '8px 0' }}>
            ({blockSplit[i]})
          </div>,
        );
      }
    }
  }

  return <>{parts}</>;
};

// ─── Styles for PDF ──────────────────────────────────────────────────────────
const pdfStyles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    color: '#333',
    padding: '20px 0',
    backgroundColor: '#fff',
  },
  header: {
    textAlign: 'center',
    marginBottom: '30px',
    paddingBottom: '20px',
    borderBottom: '2px solid #333',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#000',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '5px',
  },
  infoGrid: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '15px',
    fontSize: '13px',
    color: '#555',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#000',
    marginTop: '25px',
    marginBottom: '15px',
    paddingBottom: '8px',
    borderBottom: '1px solid #ddd',
  },
  questionItem: {
    marginBottom: '20px',
    pageBreakInside: 'avoid' as const,
  },
  questionText: {
    fontSize: '14px',
    lineHeight: '1.8',
    marginBottom: '10px',
    color: '#000',
  },
  questionNumber: {
    fontWeight: 'bold',
    marginRight: '8px',
    color: '#000',
  },
  optionsContainer: {
    marginLeft: '25px',
    marginBottom: '10px',
  },
  optionItem: {
    fontSize: '14px',
    lineHeight: '1.6',
    marginBottom: '5px',
    color: '#333',
  },
  optionLabel: {
    fontWeight: 'bold',
    marginRight: '8px',
  },
  answerBlock: {
    marginTop: '10px',
    padding: '10px 15px',
    backgroundColor: '#f5f5f5',
    borderLeft: '3px solid #1890ff',
    borderRadius: '0 4px 4px 0',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  answerLabel: {
    fontWeight: 'bold',
    color: '#1890ff',
    marginRight: '6px',
  },
  fillBlank: {
    borderBottom: '1px solid #333',
    minWidth: '80px',
    display: 'inline-block',
    margin: '0 5px',
  },
};

interface PdfPreviewProps {
  visible: boolean;
  onClose: () => void;
  questions: QuestionItem[];
  selectedIds: Set<string>;
  showAnswer: boolean;
  subject?: string;
  grade?: string;
  examType?: string;
}

const PdfPreview: React.FC<PdfPreviewProps> = ({
  visible,
  onClose,
  questions,
  selectedIds,
  showAnswer,
  subject = '数学',
  grade = '初中一年级',
  examType = '期末考试',
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [drawerSize, setDrawerSize] = useState<DrawerProps['size']>('60%');

  // 获取选中的题目
  const selectedQuestions = questions.filter((q) => selectedIds.has(q.id));

  // 按题型分组
  const groupedQuestions: Record<string, QuestionItem[]> = {};
  for (const q of selectedQuestions) {
    if (!groupedQuestions[q.type]) groupedQuestions[q.type] = [];
    groupedQuestions[q.type].push(q);
  }

  // 处理题目内容，将 _____ 替换为空白下划线
  const renderQuestionContent = (content: string) => {
    const parts = content.split('_____');
    if (parts.length === 1) return <MathText text={content} />;

    return (
      <>
        {parts.map((part, index) => (
          <React.Fragment key={`blank-${part.substring(0, 20)}-${part.length}`}>
            <MathText text={part} />
            {index < parts.length - 1 && (
              <span style={pdfStyles.fillBlank}>&nbsp;</span>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  // 生成 PDF
  const handleDownloadPdf = async () => {
    if (!contentRef.current) return;

    const html2pdf = (await import('html2pdf.js')).default;

    const element = contentRef.current;
    const opt: any = {
      margin: [15, 15, 15, 15],
      filename: `${subject}_${grade}_${examType}_试卷.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    try {
      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error('PDF 生成失败:', error);
      alert('PDF 生成失败，请重试');
    }
  };

  // 打印预览
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !contentRef.current) return;

    const htmlContent = contentRef.current.innerHTML;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${subject}_${grade}_${examType}_试卷</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #333;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
            background: #fff;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #333;
          }
          .title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
            color: #000;
          }
          .subtitle {
            font-size: 14px;
            color: #666;
            margin-bottom: 5px;
          }
          .info-grid {
            display: flex;
            justify-content: space-between;
            margin-top: 15px;
            font-size: 13px;
            color: #555;
          }
          .section-title {
            font-size: 16px;
            font-weight: bold;
            color: #000;
            margin-top: 25px;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 1px solid #ddd;
          }
          .question-item {
            margin-bottom: 20px;
            page-break-inside: avoid;
          }
          .question-text {
            font-size: 14px;
            line-height: 1.8;
            margin-bottom: 10px;
            color: #000;
          }
          .question-number {
            font-weight: bold;
            margin-right: 8px;
            color: #000;
          }
          .options-container {
            margin-left: 25px;
            margin-bottom: 10px;
          }
          .option-item {
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 5px;
            color: #333;
          }
          .option-label {
            font-weight: bold;
            margin-right: 8px;
          }
          .answer-block {
            margin-top: 10px;
            padding: 10px 15px;
            background-color: #f5f5f5;
            border-left: 3px solid #1890ff;
            border-radius: 0 4px 4px 0;
            font-size: 13px;
            line-height: 1.6;
          }
          .answer-label {
            font-weight: bold;
            color: #1890ff;
            margin-right: 6px;
          }
          .fill-blank {
            border-bottom: 1px solid #333;
            min-width: 80px;
            display: inline-block;
            margin: 0 5px;
          }
          @media print {
            body { padding: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        ${htmlContent}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 500);
          };
        </script>
      </body>
      </html>
    `);

    printWindow.document.close();
  };

  // 生成 Markdown 格式的题目内容
  const generateMarkdown = (): string => {
    let md = `# ${subject}${examType}试卷\n\n`;
    md += `**年级：** ${grade}\n\n`;
    md += `**总分：** ${totalScore} 分 | **时间：** 120 分钟 | **题目数量：** ${selectedQuestions.length} 题\n\n`;
    md += `---\n\n`;

    // 获取所有题型
    const types = Object.keys(groupedQuestions);
    let questionIndex = 0;
    types.forEach((type, index) => {
      if (!groupedQuestions[type]?.length) return;

      md += `## ${getSectionTitle(type, index)}\n\n`;
      md += `（共 ${groupedQuestions[type].length} 题，每题 1 分）\n\n`;

      for (const q of groupedQuestions[type]) {
        questionIndex++;
        md += `**${questionIndex}.** ${q.content}\n\n`;

        // 选择题选项
        if (q.options && q.options.length > 0) {
          for (const opt of q.options) {
            md += `${opt.label}. ${opt.content}\n`;
          }
          md += '\n';
        }

        // 答案和解析
        if (showAnswer && q.answer) {
          md += `> **答案：** ${q.answer}\n`;
          if (q.analysis) {
            md += `>\n> **解析：** ${q.analysis}\n`;
          }
          md += '\n';
        }

        md += `---\n\n`;
      }
    });

    return md;
  };

  // 下载 Word 文档
  const handleDownloadWord = async () => {
    try {
      message.loading('正在生成 Word 文档...', 0);
      const markdown = generateMarkdown();
      const filename = `${subject}_${grade}_${examType}_试卷`;

      const result = await ossMdTextToDocxApiOssConvertMdTextToDocxPost({
        md_content: markdown,
        filename: filename,
      });

      message.destroy();

      if (result.url) {
        const response = await fetch(result.url);
        if (!response.ok) throw new Error('下载失败');
        const fileBlob = await response.blob();
        const blob = new Blob([fileBlob], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${filename}.docx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        message.success('Word 文档下载成功');
      } else {
        throw new Error('未获取到文档 URL');
      }
    } catch (error) {
      message.destroy();
      console.error('Word 生成失败:', error);
      message.error('Word 文档生成失败，请重试');
    }
  };

  // 计算总分（假设每题 1 分）
  const totalScore = selectedQuestions.length;

  return (
    <Drawer
      title="试卷预览"
      placement="right"
      size={drawerSize}
      onClose={onClose}
      open={visible}
      resizable={{
        onResize: (newSize) => {
          setDrawerSize(newSize);
        },
      }}
      extra={
        <Space>
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
            打印预览
          </Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownloadPdf}
          >
            下载 PDF
          </Button>
          <Button icon={<FileWordOutlined />} onClick={handleDownloadWord}>
            下载 Word
          </Button>
        </Space>
      }
    >
      <div ref={contentRef} style={pdfStyles.container}>
        {/* 试卷头部 */}
        <div style={pdfStyles.header}>
          <div style={pdfStyles.title}>
            {subject}
            {examType}试卷
          </div>
          <div style={pdfStyles.subtitle}>{grade}</div>
          <div style={pdfStyles.infoGrid}>
            <span>总分：{totalScore} 分</span>
            <span>时间：120 分钟</span>
            <span>题目数量：{selectedQuestions.length} 题</span>
          </div>
        </div>

        {/* 注意事项 */}
        {showAnswer && (
          <div
            style={{ marginBottom: '20px', fontSize: '12px', color: '#666' }}
          >
            <strong>注意事项：</strong>
            <ol style={{ margin: '5px 0', paddingLeft: '20px' }}>
              <li>
                本试卷共 {selectedQuestions.length} 题，满分 {totalScore} 分。
              </li>
              <li>请在答题卡上作答，在试卷上作答无效。</li>
              <li>考试结束后，请将试卷和答题卡一并交回。</li>
            </ol>
          </div>
        )}

        {/* 题目内容 */}
        {Object.keys(groupedQuestions)
          .filter((t) => groupedQuestions[t]?.length)
          .map((type, index) => {
            let questionIndex = 0;
            return (
              <div key={type}>
                <div style={pdfStyles.sectionTitle}>
                  {getSectionTitle(type, index)}
                  <span
                    style={{
                      fontSize: '12px',
                      color: '#666',
                      marginLeft: '12px',
                      fontWeight: 'normal',
                    }}
                  >
                    (共 {groupedQuestions[type].length} 题，每题 1 分)
                  </span>
                </div>
                {groupedQuestions[type].map((q) => {
                  questionIndex++;
                  return (
                    <div key={q.id} style={pdfStyles.questionItem}>
                      <div style={pdfStyles.questionText}>
                        <span style={pdfStyles.questionNumber}>
                          {questionIndex}.
                        </span>
                        {renderQuestionContent(q.content)}
                      </div>

                      {/* 选择题选项 */}
                      {q.options && q.options.length > 0 && (
                        <div style={pdfStyles.optionsContainer}>
                          {q.options.map((opt) => (
                            <div key={opt.label} style={pdfStyles.optionItem}>
                              <span style={pdfStyles.optionLabel}>
                                {opt.label}.
                              </span>
                              <MathText text={opt.content} />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 答案和解析 */}
                      {showAnswer && q.answer && (
                        <div style={pdfStyles.answerBlock}>
                          <span style={pdfStyles.answerLabel}>答案：</span>
                          <MathText text={q.answer} />
                          {q.analysis && (
                            <>
                              <br />
                              <span style={pdfStyles.answerLabel}>解析：</span>
                              <MathText text={q.analysis} />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
      </div>
    </Drawer>
  );
};

export default PdfPreview;
