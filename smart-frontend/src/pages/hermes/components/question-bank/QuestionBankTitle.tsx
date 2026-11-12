import { EditOutlined } from '@ant-design/icons';
import { Input } from 'antd';
import React, { useState } from 'react';
import { useQuestionBankStyles } from './style';

const QuestionBankTitle: React.FC<{
  title: string;
  onSave?: (title: string) => void;
}> = ({ title, onSave }) => {
  const { styles } = useQuestionBankStyles();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [invalid, setInvalid] = useState(false);

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label="题库标题"
        aria-invalid={invalid}
        data-workspace-title
        className={styles.workbenchTitleInput}
        variant="borderless"
        value={draft}
        maxLength={300}
        status={invalid ? 'error' : undefined}
        placeholder="请输入题库标题"
        onFocus={(event) => event.target.select()}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onPressEnter={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          const value = draft.trim();
          if (!value) {
            setInvalid(true);
            return;
          }
          onSave?.(value);
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }

  return (
    <button
      type="button"
      className={styles.workbenchTitle}
      aria-label="编辑题库标题"
      title={title}
      data-workspace-title
      disabled={!onSave}
      onClick={() => {
        setDraft(title);
        setInvalid(false);
        setEditing(true);
      }}
    >
      <span>{title}</span>
      {onSave && <EditOutlined aria-hidden />}
    </button>
  );
};

export default QuestionBankTitle;
