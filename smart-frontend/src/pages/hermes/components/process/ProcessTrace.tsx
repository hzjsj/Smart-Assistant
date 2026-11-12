import { BulbOutlined, SyncOutlined, ToolOutlined } from '@ant-design/icons';
import { Think, ThoughtChain, type ThoughtChainItemType } from '@ant-design/x';
import { Progress, Typography } from 'antd';
import React, { useMemo } from 'react';
import type {
  HermesActivity,
  HermesMessage,
  ReasoningActivity,
  StatusActivity,
  ToolActivity,
} from '../../data';
import { useStyles } from '../../style';
import { useProcessDisclosure } from './useProcessDisclosure';

type TraceBlock =
  | { type: 'tools'; key: string; tools: ToolActivity[] }
  | { type: 'reasoning'; activity: ReasoningActivity }
  | { type: 'status'; activity: StatusActivity };

function projectTrace(activities: HermesActivity[]) {
  const toolIds = new Set(
    activities
      .filter((activity) => activity.type === 'tool')
      .map((tool) => tool.key),
  );
  const linked = new Map<string, ReasoningActivity[]>();
  const blocks: TraceBlock[] = [];
  for (const activity of activities) {
    if (
      activity.type === 'reasoning' &&
      activity.toolKey &&
      toolIds.has(activity.toolKey)
    ) {
      linked.set(activity.toolKey, [
        ...(linked.get(activity.toolKey) || []),
        activity,
      ]);
      continue;
    }
    if (activity.type === 'tool') {
      const last = blocks.at(-1);
      if (last?.type === 'tools') last.tools.push(activity);
      else blocks.push({ type: 'tools', key: activity.key, tools: [activity] });
    } else if (activity.type === 'reasoning')
      blocks.push({ type: 'reasoning', activity });
    else if (
      activity.type === 'status' &&
      !['error', 'warning'].includes(activity.kind)
    )
      blocks.push({ type: 'status', activity });
  }
  return { blocks, linked };
}

const statusLabels: Record<ToolActivity['status'], string> = {
  running: '运行中',
  completed: '已完成',
  error: '执行失败',
  abort: '已停止',
};

const ProcessTrace: React.FC<{
  message: HermesMessage;
  requestStatus?: string;
}> = ({ message, requestStatus }) => {
  const { styles } = useStyles();
  const active = requestStatus === 'loading' || requestStatus === 'updating';
  const disclosure = useProcessDisclosure(active);
  const { blocks, linked } = useMemo(
    () => projectTrace(message.activities || []),
    [message.activities],
  );
  const tools = message.activities.filter(
    (activity) => activity.type === 'tool',
  );
  const running = tools.filter((tool) => tool.status === 'running');
  const completed = tools.filter((tool) => tool.status === 'completed').length;
  const failed =
    requestStatus === 'error' ||
    message.finishReason === 'error' ||
    message.activities.some(
      (activity) =>
        ((activity.type === 'tool' || activity.type === 'reasoning') &&
          activity.status === 'error') ||
        (activity.type === 'status' && activity.kind === 'error'),
    );
  const stopped =
    requestStatus === 'abort' ||
    message.activities.some(
      (activity) =>
        (activity.type === 'tool' || activity.type === 'reasoning') &&
        activity.status === 'abort',
    );
  const awaitingApproval = message.activities.some(
    (activity) =>
      activity.type === 'approval' &&
      ['pending', 'submitting', 'error'].includes(activity.status),
  );
  const title = active
    ? awaitingApproval
      ? '等待操作确认'
      : running.length > 1
        ? `正在执行 ${running.length} 项工具 · 已完成 ${completed} 项`
        : running.length === 1
          ? `正在执行：${running[0].label || running[0].tool}`
          : message.contentActive
            ? '正在生成回答'
            : message.activities.some(
                  (activity) =>
                    activity.type === 'reasoning' &&
                    activity.status === 'active',
                )
              ? '正在思考'
              : '正在处理'
    : failed
      ? '执行失败'
      : stopped
        ? '执行已停止'
        : tools.length
          ? `执行完成 · 调用了 ${tools.length} 个工具`
          : '思考完成';

  const reasoning = (activity: ReasoningActivity) => {
    const expanded = disclosure.reasoningKeys.includes(activity.key);
    return (
      <Think
        key={activity.key}
        data-reasoning-key={activity.key}
        className={styles.reasoningThink}
        title={
          <button
            type="button"
            className={styles.traceToggle}
            aria-label={activity.isStageReasoning ? '阶段思考' : '思考过程'}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              disclosure.toggleReasoning(activity.key);
            }}
          >
            {activity.isStageReasoning ? '阶段思考' : '思考过程'}
          </button>
        }
        expanded={expanded}
        onExpand={() => disclosure.toggleReasoning(activity.key)}
        styles={{
          content: {
            borderInlineStart: 0,
            paddingInlineStart: 0,
            marginTop: 8,
          },
        }}
        destroyOnHidden
      >
        <Typography.Paragraph className={styles.reasoningText}>
          {activity.text}
        </Typography.Paragraph>
      </Think>
    );
  };

  if (!blocks.length) return null;
  return (
    <Think
      data-process-trace
      data-request-active={active}
      data-process-state={
        failed
          ? 'error'
          : stopped
            ? 'abort'
            : active && awaitingApproval
              ? 'waiting'
              : active
                ? 'running'
                : 'completed'
      }
      className={styles.processTrace}
      classNames={{
        status: styles.processSummary,
        content: styles.processContent,
      }}
      title={
        <button
          type="button"
          className={styles.traceToggle}
          aria-label="执行过程"
          aria-expanded={disclosure.expanded}
          onClick={(event) => {
            event.stopPropagation();
            disclosure.setExpanded((value) => !value);
          }}
        >
          {title}
        </button>
      }
      icon={<BulbOutlined />}
      loading={
        active ? <SyncOutlined className={styles.thinkingSpinner} /> : false
      }
      expanded={disclosure.expanded}
      onExpand={disclosure.setExpanded}
      styles={{
        content: { borderInlineStart: 0, paddingInlineStart: 0, marginTop: 12 },
      }}
      destroyOnHidden
    >
      <div className={styles.processBlocks}>
        {blocks.map((block) => {
          if (block.type === 'reasoning') return reasoning(block.activity);
          if (block.type === 'status')
            return (
              <div key={block.activity.key} className={styles.statusLine}>
                {block.activity.text}
              </div>
            );
          const items: ThoughtChainItemType[] = block.tools.map((tool) => {
            const name = `${tool.emoji ? `${tool.emoji} ` : ''}${tool.label || tool.tool}`;
            const expanded = disclosure.toolKeys.includes(tool.key);
            return {
              key: tool.key,
              icon: <ToolOutlined />,
              status:
                tool.status === 'completed'
                  ? 'success'
                  : tool.status === 'running'
                    ? 'loading'
                    : tool.status,
              title: (
                <button
                  type="button"
                  className={styles.traceToggle}
                  aria-label={`工具详情：${tool.label || tool.tool}`}
                  aria-expanded={expanded}
                  title={name}
                  data-tool-toggle={tool.key}
                  onClick={(event) => {
                    event.stopPropagation();
                    disclosure.setToolKeys((keys) =>
                      keys.includes(tool.key)
                        ? keys.filter((key) => key !== tool.key)
                        : [...keys, tool.key],
                    );
                  }}
                >
                  {name}
                </button>
              ),
              description: (
                <div className={styles.toolDescription}>
                  <span>{statusLabels[tool.status]}</span>
                  {tool.progressMessage &&
                    tool.progressMessage !== tool.label &&
                    tool.progressMessage !== tool.tool && (
                      <span
                        className={styles.toolProgressText}
                        title={tool.progressMessage}
                      >
                        {tool.progressMessage}
                      </span>
                    )}
                  {typeof tool.progress === 'number' && (
                    <span className={styles.toolPercent}>
                      {Math.round(tool.progress)}%
                    </span>
                  )}
                  {tool.overlapped && <span>并行</span>}
                </div>
              ),
              collapsible: true,
              destroyOnHidden: true,
              content: (
                <div
                  className={styles.toolDetails}
                  data-tool-details={tool.key}
                >
                  <div className={styles.toolName}>工具：{tool.tool}</div>
                  {tool.progressMessage && (
                    <div className={styles.toolLog}>{tool.progressMessage}</div>
                  )}
                  {typeof tool.progress === 'number' && (
                    <Progress
                      percent={Math.round(tool.progress)}
                      size="small"
                      status={
                        tool.status === 'error'
                          ? 'exception'
                          : tool.status === 'completed'
                            ? 'success'
                            : tool.status === 'running' && active
                              ? 'active'
                              : 'normal'
                      }
                    />
                  )}
                  {linked.get(tool.key)?.map(reasoning)}
                </div>
              ),
            };
          });
          return (
            <ThoughtChain
              key={block.key}
              items={items}
              line="dashed"
              expandedKeys={disclosure.toolKeys}
              onExpand={disclosure.setToolKeys}
              rootClassName={styles.toolChain}
              classNames={{ itemHeader: styles.toolChainHeader }}
            />
          );
        })}
      </div>
    </Think>
  );
};

export default ProcessTrace;
