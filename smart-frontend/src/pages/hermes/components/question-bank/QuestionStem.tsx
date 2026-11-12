import React from 'react';
import { QuestionMarkdown } from './QuestionMarkdown';
import { useQuestionBankStyles } from './style';

export const QuestionStem: React.FC<{ number: number; content: string }> = ({
  number,
  content,
}) => {
  const { styles } = useQuestionBankStyles();
  return (
    <div className={styles.questionStem} data-question-stem>
      <strong className={styles.questionNumber}>{number}.</strong>
      <div className={styles.questionStemContent}>
        <QuestionMarkdown content={content} />
      </div>
    </div>
  );
};
