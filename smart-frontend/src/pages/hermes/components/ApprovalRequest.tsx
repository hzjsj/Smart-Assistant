import { Button, Card, message, Space, Typography } from 'antd';
import React, { useState } from 'react';
import type { ApprovalActivity, ApprovalChoice } from '../data';
import { postApproval } from '../service';
import { useStyles } from '../style';

const choices: Array<{ value: ApprovalChoice; label: string }> = [
  { value: 'once', label: '允许一次' },
  { value: 'session', label: '会话允许' },
  { value: 'always', label: '始终允许' },
  { value: 'deny', label: '拒绝' },
];

const ApprovalRequest: React.FC<{
  activity: ApprovalActivity;
  onUpdate: (activity: ApprovalActivity) => void;
}> = ({ activity, onUpdate }) => {
  const { styles } = useStyles();
  const [messageApi, contextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (choice: ApprovalChoice) => {
    setSubmitting(true);
    onUpdate({ ...activity, status: 'submitting', choice });
    try {
      await postApproval(activity.runId, {
        choice,
        request_id: activity.requestId,
        resolve_all: false,
      });
      onUpdate({ ...activity, status: 'resolved', choice });
    } catch (error) {
      const text = error instanceof Error ? error.message : '审批提交失败';
      onUpdate({ ...activity, status: 'error', choice });
      messageApi.error(text);
    } finally {
      setSubmitting(false);
    }
  };

  const visibleChoices = choices.filter(
    ({ value }) =>
      (activity.choices.length === 0 &&
        (value === 'once' || value === 'deny')) ||
      activity.choices.includes(value),
  );

  return (
    <>
      {contextHolder}
      <Card size="small" className={styles.approvalCard}>
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          <Typography.Text strong>需要审批</Typography.Text>
          {activity.description && (
            <Typography.Paragraph className={styles.approvalText}>
              {activity.description}
            </Typography.Paragraph>
          )}
          {activity.command && (
            <pre className={styles.approvalCommand}>{activity.command}</pre>
          )}
          {activity.status === 'resolved' ? (
            <Typography.Text type="secondary">
              {activity.choice === 'deny' ? '已拒绝' : '已提交审批'}
            </Typography.Text>
          ) : (
            <Space wrap>
              {visibleChoices.map(({ value, label }) => (
                <Button
                  key={value}
                  size="small"
                  danger={value === 'deny'}
                  type={value === 'once' ? 'primary' : 'default'}
                  loading={submitting && activity.choice === value}
                  disabled={submitting || activity.status === 'submitting'}
                  onClick={() => void submit(value)}
                >
                  {label}
                </Button>
              ))}
              {activity.status === 'error' && (
                <Typography.Text type="danger">
                  提交失败，可重试
                </Typography.Text>
              )}
            </Space>
          )}
        </Space>
      </Card>
    </>
  );
};

export default ApprovalRequest;
