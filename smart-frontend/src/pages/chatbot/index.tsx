import { UserOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Bubble, Conversations, Sender, Think, XProvider } from '@ant-design/x';
import type {
  BubbleItemType,
  BubbleListProps,
} from '@ant-design/x/es/bubble/interface';
import XMarkdown, { type ComponentProps } from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import { useXChat } from '@ant-design/x-sdk';
import { Avatar, Card, Select, Space, Switch, Tooltip, message } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  createChatSession,
  deleteChatSession,
  listChatMessages,
  listChatModels,
  listChatSessions,
} from './api';
import type {
  ChatModelItem,
  ConversationItem,
  ParsedMessage,
} from './data';
import { createChatProvider } from './service';
import { useStyles } from './style';

const WELCOME_TEXT = '🤖 你好，我是智能助手，有什么可以帮你？';

const TypewriterTitle: React.FC = () => {
  const { styles } = useStyles();
  const [index, setIndex] = useState(0);
  const done = index >= WELCOME_TEXT.length;

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= WELCOME_TEXT.length) {
          clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {WELCOME_TEXT.slice(0, index)}
      {!done && <span className={styles.cursor}>|</span>}
    </>
  );
};

/** 思考组件：XMarkdown 把 <think> 标签渲染为此组件，流状态驱动标题 */
const ThinkComponent = React.memo((props: ComponentProps) => {
  const [title, setTitle] = React.useState('深度思考中...');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // 当流状态完成时，更新标题和加载状态
    if (props.streamStatus === 'done') {
      setTitle('思考完成');
      setLoading(false);
    }
  }, [props.streamStatus]);

  return (
    <Think title={title} loading={loading} defaultExpanded={props.streamStatus !== 'done'}>
      {props.children}
    </Think>
  );
});

const STREAMING_ACTIVE = { hasNextChunk: true, enableAnimation: true };
const STREAMING_IDLE = { hasNextChunk: false, enableAnimation: true };
const MARKDOWN_EXTENSIONS = Latex();

const roleConfig: BubbleListProps['role'] = {
  user: {
    placement: 'end',
    avatar: <Avatar icon={<UserOutlined />} />,
  },
  ai: {
    placement: 'start',
    avatar: (
      <Avatar
        style={{
          background: 'transparent',
          fontSize: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🤖
      </Avatar>
    ),
    contentRender: (
      content: string,
      info: { status?: string; loading?: boolean },
    ) => {
      if (info?.loading || !content) return undefined;
      return (
        <XMarkdown
          streaming={
            info?.status === 'updating' ? STREAMING_ACTIVE : STREAMING_IDLE
          }
          config={{ extensions: MARKDOWN_EXTENSIONS }}
          paragraphTag="div"
          content={content}
          components={{
            think: ThinkComponent,
          }}
        />
      );
    },
  },
};

const formatContext = (tokens: number) =>
  tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : `${tokens}`;

/** 会话ID 用 UUID（后端 chat_id 要求 8-64 字符） */
const newChatId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const newDraft = (): ConversationItem => ({
  key: newChatId(),
  label: '💬 新对话',
  group: '今天',
  isDraft: true,
});

const ChatbotPage: React.FC = () => {
  const { styles } = useStyles();
  const [messageApi, contextHolder] = message.useMessage();

  // 初始草稿会话：conversations 与 activeKey 必须共用同一个 key
  const [initialDraft] = useState<ConversationItem>(newDraft);
  const [conversations, setConversations] = useState<ConversationItem[]>([
    initialDraft,
  ]);
  const [activeKey, setActiveKey] = useState<string>(initialDraft.key);
  const [inputValue, setInputValue] = useState('');

  const [models, setModels] = useState<ChatModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [enableThinking, setEnableThinking] = useState(false);

  const provider = useMemo(() => createChatProvider() as any, []);
  // 切换会话时由 useXChat 按 conversationKey 调用，拉取后端历史恢复气泡
  const loadDefaultMessages = useCallback(
    async (info: { conversationKey?: string }) => {
      const chatId = info?.conversationKey;
      if (!chatId) return [];
      try {
        const res = await listChatMessages(chatId);
        return (res?.data ?? []).map((record) => ({
          id: record.id,
          status: 'success' as const,
          // 思考内容拼回 <think> 标签，由 XMarkdown 的 think 自定义组件渲染
          message: {
            role: record.role,
            content: record.reasoningContent
              ? `<think>\n\n${record.reasoningContent}\n\n</think>\n\n${record.content}`
              : record.content,
          },
        }));
      } catch {
        return [];
      }
    },
    [],
  );
  const { onRequest, abort, isRequesting, parsedMessages } = useXChat<
    any,
    ParsedMessage
  >({
    provider,
    conversationKey: activeKey,
    // <think> 标签不在此拆分，交给 XMarkdown 的 think 自定义组件渲染
    requestPlaceholder: { role: 'assistant', content: '' },
    defaultMessages: loadDefaultMessages as any,
  });

  const currentModel = useMemo(
    () => models.find((m) => m.name === selectedModel),
    [models, selectedModel],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const res = await listChatSessions();
      if (res?.success) {
        // 后端列表置顶放本地草稿（未发出首条消息的会话不落库）
        setConversations((prev) => {
          const drafts = prev.filter((c) => c.isDraft);
          return [...drafts, ...(res.data ?? [])];
        });
      }
    } catch {
      // 会话列表拉取失败不阻断聊天
    }
  }, []);

  // 初始化：拉模型列表 + 会话列表
  useEffect(() => {
    (async () => {
      try {
        const res = await listChatModels();
        if (res?.success) {
          setModels(res.data ?? []);
          const def = (res.data ?? []).find(
            (m) => m.name === (res as any).default,
          );
          setSelectedModel((res as any).default ?? def?.name ?? (res.data?.[0]?.name ?? ''));
        }
      } catch {
        // 模型列表失败时选择器置空
      }
      await refreshSessions();
    })();
  }, [refreshSessions]);

  const newChat = () => {
    const draft = newDraft();
    setConversations((prev) => [draft, ...prev]);
    setActiveKey(draft.key);
  };

  const sendMessage = (content: string) => {
    if (!selectedModel) {
      messageApi.warning('模型列表加载中，请稍候');
      return;
    }
    setInputValue('');
    setConversations((prev) =>
      prev.map((c) =>
        c.key === activeKey && c.isDraft
          ? { ...c, label: content.slice(0, 20), isDraft: false }
          : c,
      ),
    );
    onRequest({
      messages: [{ role: 'user', content }],
      chatId: activeKey,
      model: selectedModel,
      enableThinking,
    });
  };

  // 请求结束后刷新会话列表（新会话已在后端自动建档）
  const wasRequesting = useRef(false);
  useEffect(() => {
    if (wasRequesting.current && !isRequesting) {
      refreshSessions();
    }
    wasRequesting.current = isRequesting;
  }, [isRequesting, refreshSessions]);

  const handleDeleteConversation = (chatKey: string) => {
    const conv = conversations.find((c) => c.key === chatKey);
    setConversations((prev) => {
      const next = prev.filter((c) => c.key !== chatKey);
      if (next.length === 0) {
        const draft = newDraft();
        next.push(draft);
        setActiveKey(draft.key);
      } else if (activeKey === chatKey) {
        setActiveKey(next[0]?.key ?? '');
      }
      return next;
    });
    // 草稿会话后端无记录，无需删除
    if (!conv?.isDraft) {
      deleteChatSession(chatKey).catch(() => {
        messageApi.error('删除会话失败');
      });
    }
  };

  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      parsedMessages.map((msg) => {
        const parsed = msg.message as ParsedMessage;
        const isAI = parsed.role === 'assistant';

        const item: BubbleItemType = {
          key: msg.id,
          role: isAI ? 'ai' : 'user',
          content: parsed.content,
          loading: isAI && msg.status === 'loading',
          status: msg.status,
        };

        return item;
      }),
    [parsedMessages],
  );

  const hasMessages = parsedMessages.length > 0;

  // 模型选择器（按平台分组）
  const modelOptions = useMemo(() => {
    const groups = new Map<string, ChatModelItem[]>();
    models.forEach((m) => {
      const list = groups.get(m.providerLabel) ?? [];
      list.push(m);
      groups.set(m.providerLabel, list);
    });
    return [...groups.entries()].map(([label, list]) => ({
      label,
      title: label,
      options: list.map((m) => ({
        value: m.name,
        label: `${m.name}（${formatContext(m.contextTokens)}）`,
      })),
    }));
  }, [models]);

  return (
    <PageContainer
      ghost
      childrenContentStyle={{
        paddingBlock: 0,
        height: 'calc(100vh - 160px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {contextHolder}
      <Card
        variant="borderless"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        styles={{
          body: {
            flex: 1,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <XProvider>
          <div className={styles.layout}>
            <div className={styles.sidebar}>
              <Conversations
                items={conversations}
                activeKey={activeKey}
                onActiveChange={setActiveKey}
                groupable
                menu={(conversation) => ({
                  items: [{ key: 'delete', label: '删除', danger: true }],
                  onClick: ({ key }) => {
                    if (key === 'delete') {
                      handleDeleteConversation(conversation.key);
                    }
                  },
                })}
                creation={{ onClick: newChat, label: '新建对话' }}
              />
            </div>

            <div className={styles.main}>
              {hasMessages && (
                <div className={styles.messages}>
                  <Bubble.List
                    items={bubbleItems}
                    role={roleConfig}
                    autoScroll
                    styles={{ root: { maxWidth: 940 } }}
                  />
                </div>
              )}

              <div
                className={hasMessages ? styles.footer : styles.footerCenter}
              >
                {!hasMessages && (
                  <div className={styles.welcomeTitle}>
                    <TypewriterTitle />
                  </div>
                )}
                <Sender
                  value={inputValue}
                  onChange={setInputValue}
                  loading={isRequesting}
                  onSubmit={sendMessage}
                  onCancel={abort}
                  placeholder="输入消息，按 Enter 发送..."
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  style={{ maxWidth: 940, width: '100%' }}
                  styles={{ input: { paddingBlock: 0 } }}
                  prefix={
                    <Space.Compact>
                      <Select
                        value={selectedModel || undefined}
                        onChange={(v) => {
                          setSelectedModel(v);
                          const meta = models.find((m) => m.name === v);
                          if (!meta?.supportsThinking) setEnableThinking(false);
                        }}
                        options={modelOptions}
                        loading={models.length === 0}
                        style={{ minWidth: 240 }}
                        size="middle"
                        variant="borderless"
                        placeholder="选择模型"
                      />
                      {currentModel?.supportsThinking && (
                        <Tooltip title="深度思考">
                          <Switch
                            checked={enableThinking}
                            onChange={setEnableThinking}
                            checkedChildren="思考"
                            unCheckedChildren="思考"
                          />
                        </Tooltip>
                      )}
                    </Space.Compact>
                  }
                />
              </div>
            </div>
          </div>
        </XProvider>
      </Card>
    </PageContainer>
  );
};

export default ChatbotPage;
