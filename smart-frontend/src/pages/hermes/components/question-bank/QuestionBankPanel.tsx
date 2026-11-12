import { Alert, Button, Checkbox, Empty, message, Spin } from 'antd';
import React, { useMemo, useState } from 'react';
import {
  groupQuestions,
  questionSectionHeading,
  totalScore,
} from '../../question-bank/protocol';
import { saveQuestionPaper } from '../../question-bank/service';
import type {
  PaperResponse,
  QuestionBankEntry,
} from '../../question-bank/types';
import PaperPreview from './PaperPreview';
import { QuestionMarkdown } from './QuestionMarkdown';
import { QuestionStem } from './QuestionStem';
import { useQuestionBankStyles } from './style';

const QuestionBankPanel: React.FC<{
  entry?: QuestionBankEntry;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onChange: (
    patch: Partial<
      Pick<QuestionBankEntry, 'selectedIds' | 'showAnswers' | 'title'>
    >,
  ) => void;
}> = ({ entry, loading, error, onRetry, onChange }) => {
  const { styles } = useQuestionBankStyles();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PaperResponse | null>(null);
  const [messageApi, holder] = message.useMessage();
  const selected = new Set(entry?.selectedIds || []);
  const groups = useMemo(
    () => groupQuestions(entry?.bank.document.questions || []),
    [entry?.bank],
  );
  const selectedQuestions =
    entry?.bank.document.questions.filter((question) =>
      selected.has(question.id),
    ) || [];
  const score = totalScore(selectedQuestions);
  const assemble = async () => {
    if (!entry || !selected.size || saving || !entry.title.trim()) return;
    setSaving(true);
    try {
      setPreview(await saveQuestionPaper(entry));
    } catch (problem) {
      messageApi.error(
        problem instanceof Error ? problem.message : '保存试卷失败',
      );
    } finally {
      setSaving(false);
    }
  };
  let index = 0;
  return (
    <section className={styles.panel} aria-label="题目列表与组卷">
      {holder}
      <header className={styles.header}>
        <div className={styles.panelControls}>
          <div className={styles.panelToggles}>
            <Checkbox
              checked={Boolean(
                entry && selected.size === entry.bank.question_count,
              )}
              indeterminate={Boolean(
                entry &&
                  selected.size > 0 &&
                  selected.size < entry.bank.question_count,
              )}
              disabled={saving || loading || !entry}
              onChange={(event) => {
                if (!entry) return;
                onChange({
                  selectedIds: event.target.checked
                    ? entry.bank.document.questions.map(
                        (question) => question.id,
                      )
                    : [],
                });
              }}
            >
              全选
            </Checkbox>
            <Checkbox
              checked={entry?.showAnswers || false}
              disabled={saving || loading || !entry}
              onChange={(event) =>
                onChange({ showAnswers: event.target.checked })
              }
            >
              显示答案和解析
            </Checkbox>
          </div>
          <div className={styles.panelMeta}>
            {loading ? (
              <>
                <Spin size="small" />
                <span role="status">正在导入并校验题库…</span>
              </>
            ) : entry ? (
              <>
                {entry.bank.document.subject} · {entry.bank.document.grade} · 共{' '}
                {entry.bank.question_count} 题
              </>
            ) : (
              <span>题库尚未加载</span>
            )}
          </div>
        </div>
        {error && (
          <Alert
            showIcon
            type="error"
            title="题库加载失败"
            description={error}
            action={
              <Button size="small" onClick={onRetry}>
                重试
              </Button>
            }
          />
        )}
        {entry?.card.question_count !== undefined &&
          entry.card.question_count !== entry.bank.question_count && (
            <Alert
              type="warning"
              showIcon
              title={`卡片声明 ${entry.card.question_count} 题，实际 ${entry.bank.question_count} 题，以文件校验结果为准`}
            />
          )}
      </header>
      <div className={styles.scroll}>
        {!entry && !loading && (
          <Empty
            description={
              error
                ? '请重试或选择其他题库卡片'
                : '点击对话中的题库卡片查看题目'
            }
          />
        )}
        {entry &&
          groups.map(([type, questions], groupIndex) => (
            <section key={type}>
              <h3 className={styles.groupTitle}>
                {questionSectionHeading(type, questions, groupIndex)}
              </h3>
              {questions.map((question) => {
                index += 1;
                return (
                  <article key={question.id} className={styles.question}>
                    <Checkbox
                      aria-label={`选择题目 ${question.id}`}
                      checked={selected.has(question.id)}
                      disabled={saving}
                      onChange={(event) =>
                        onChange({
                          selectedIds: event.target.checked
                            ? [...entry.selectedIds, question.id]
                            : entry.selectedIds.filter(
                                (id) => id !== question.id,
                              ),
                        })
                      }
                    />
                    <div className={styles.questionBody}>
                      <QuestionStem number={index} content={question.content} />
                      <div className={styles.options}>
                        {question.options.map((option) => (
                          <div key={option.label} className={styles.optionItem}>
                            <span className={styles.optionLabel}>
                              {option.label}
                            </span>
                            <QuestionMarkdown content={option.content} />
                          </div>
                        ))}
                      </div>
                      {question.knowledge_points.length > 0 && (
                        <div className={styles.secondary}>
                          {question.knowledge_points.join(' · ')}
                        </div>
                      )}
                      {entry.showAnswers && (
                        <div className={styles.answer}>
                          <strong>答案与解析</strong>
                          <QuestionMarkdown
                            content={question.answer || '未提供答案'}
                          />
                          <QuestionMarkdown content={question.analysis} />
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
      </div>
      <footer className={styles.footer}>
        <span>
          已选 {selected.size} 题
          {selected.size > 0
            ? score === null
              ? ' · 分值未完整标注'
              : ` · 总分 ${score} 分`
            : ''}
        </span>
        <Button
          type="primary"
          loading={saving}
          disabled={!selected.size || loading || !entry?.title.trim()}
          onClick={() => void assemble()}
        >
          组卷预览
        </Button>
      </footer>
      <PaperPreview paper={preview} onClose={() => setPreview(null)} />
    </section>
  );
};

export default QuestionBankPanel;
