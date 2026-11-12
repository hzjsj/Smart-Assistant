import { ReadOutlined } from '@ant-design/icons';
import { FileCard } from '@ant-design/x';
import { Alert, Button, Flex } from 'antd';
import React from 'react';
import type { QuestionBankCardData } from '../../question-bank/types';
import { useQuestionBankStyles } from './style';

const BankCard: React.FC<{
  card: QuestionBankCardData;
  onOpen: (card: QuestionBankCardData) => void;
}> = ({ card, onOpen }) => {
  const { styles } = useQuestionBankStyles();
  const description = [
    card.subject,
    card.grade,
    card.question_count ? `${card.question_count} 题` : '题库 JSON',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <FileCard
      name={card.name}
      type="file"
      icon="default"
      className={styles.bankCard}
      onClick={() => onOpen(card)}
      styles={{
        file: { width: '100%', minWidth: 0, padding: '12px 16px' },
        description: { marginTop: 4, lineHeight: 1.5 },
      }}
      description={() => (
        <Flex
          align="center"
          justify="space-between"
          gap={8}
          style={{ width: '100%', minWidth: 0 }}
        >
          <span className={styles.bankCardMeta} title={description}>
            {description}
          </span>
          <Button
            type="text"
            size="small"
            icon={<ReadOutlined aria-hidden />}
            className={styles.bankCardAction}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(card);
            }}
          >
            查看题目
          </Button>
        </Flex>
      )}
    />
  );
};

export const QuestionBankCards: React.FC<{
  cards: QuestionBankCardData[];
  pending?: boolean;
  errors?: string[];
  onOpen: (card: QuestionBankCardData) => void;
}> = ({ cards, pending, errors = [], onOpen }) => {
  const { styles } = useQuestionBankStyles();
  return (
    <div className={styles.cardList}>
      {pending && <Alert type="info" showIcon title="题库卡片生成中…" />}
      {[...new Set(errors)].map((error) => (
        <Alert
          key={error}
          type="warning"
          showIcon
          title="题库卡片暂不可用"
          description={error}
        />
      ))}
      {!pending &&
        cards.map((card) => (
          <BankCard
            key={`${card.id}:${card.url}`}
            card={card}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
};
