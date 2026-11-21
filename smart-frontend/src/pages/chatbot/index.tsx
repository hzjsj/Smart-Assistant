import { AntDesignOutlined, UserOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Bubble, Conversations, Sender, XProvider } from '@ant-design/x';
import type {
  BubbleItemType,
  BubbleListProps,
} from '@ant-design/x/es/bubble/interface';
import XMarkdown from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import { useXChat } from '@ant-design/x-sdk';
import {
  Avatar,
  Card,
  Divider,
  Dropdown,
  Flex,
  type MenuProps,
  message,
} from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ConversationSkeleton,
  MessageSkeleton,
} from '@/components/ChatSkeleton';
import {
  createChatProvider,
  formatContext,
  modelAbbr,
  newChatId,
  SwitchTextStyle,
  ChatKitThink as ThinkComponent,
} from '@/components/chat-kit';
import LottieThinkingIcon from '@/components/LottieThinkingIcon';
import { useDelayedLoading } from '@/hooks/useDelayedLoading';

import {
  deleteChatSession,
  listChatMessages,
  listChatModels,
  listChatSessions,
} from '@/services/chat';
import type { ChatModelItem, ConversationItem, ParsedMessage } from './data';
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

/** 思考组件使用 chat-kit 的 ChatKitThink（本页以 ThinkComponent 别名引用） */
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
    avatar: <Avatar icon={<AntDesignOutlined />} />,
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

// 模型注册工具与思考面板已收敛到 @/components/chat-kit（todo 第 29 条三页去重）

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

  // 骨架屏：仅首屏会话列表加载时立即显示（历史消息切换用延迟骨架，避免瞬闪）
  const [bootLoading, setBootLoading] = useState(true);

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
  const {
    onRequest,
    abort,
    isRequesting,
    parsedMessages,
    isDefaultMessagesRequesting,
  } = useXChat<any, ParsedMessage>({
    provider,
    conversationKey: activeKey,
    // <think> 标签不在此拆分，交给 XMarkdown 的 think 自定义组件渲染
    requestPlaceholder: { role: 'assistant', content: '' },
    defaultMessages: loadDefaultMessages as any,
  });

  // 切换会话时保留上一次的消息内容做过渡，避免出现空白帧
  const lastParsedRef = useRef(parsedMessages);
  if (parsedMessages.length) lastParsedRef.current = parsedMessages;
  const displayMessages =
    parsedMessages.length > 0
      ? parsedMessages
      : isDefaultMessagesRequesting
        ? lastParsedRef.current
        : parsedMessages;
  const hasDisplayMessages = displayMessages.length > 0;
  // 有旧消息时，加载超过 150ms 才切骨架（快切无感）；无旧消息则立即显示骨架
  const delayedHistoryLoading = useDelayedLoading(isDefaultMessagesRequesting);

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
    } finally {
      // 首屏会话列表骨架屏收起（后续刷新不再触发首屏骨架）
      setBootLoading(false);
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
          setSelectedModel(
            (res as any).default ?? def?.name ?? res.data?.[0]?.name ?? '',
          );
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
      displayMessages.map((msg) => {
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
    [displayMessages],
  );

  // 骨架屏：首屏 / 无旧消息可展示时立即显示；有旧消息时超过 150ms 才切骨架（快切无感）
  const showSkeleton =
    bootLoading ||
    (!hasDisplayMessages && isDefaultMessagesRequesting) ||
    delayedHistoryLoading;
  // 只有加载完成且确实没有消息时才展示欢迎标题与居中输入区
  const showEmpty = !showSkeleton && !hasDisplayMessages;

  // 模型选择器（按平台分组）
  const modelMenuItems: MenuProps['items'] = useMemo(() => {
    const groups = new Map<string, ChatModelItem[]>();
    models.forEach((m) => {
      const list = groups.get(m.providerLabel) ?? [];
      list.push(m);
      groups.set(m.providerLabel, list);
    });
    return [...groups.entries()].map(([label, list]) => ({
      key: label,
      label,
      type: 'group' as const,
      children: list.map((m) => ({
        key: m.name,
        label: `${modelAbbr(m.name)} · ${m.name}（${formatContext(m.contextTokens)}）`,
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
              {bootLoading ? (
                <ConversationSkeleton />
              ) : (
                <Conversations
                  items={conversations}
                  activeKey={activeKey}
                  onActiveChange={(key) => {
                    // 切换会话时中止在途流式（后端权威落库继续完成消息，前端停止接收）
                    if (key !== activeKey && isRequesting) abort();
                    setActiveKey(key);
                  }}
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
              )}
            </div>

            <div className={styles.main}>
              {showSkeleton ? (
                <div className={styles.messages}>
                  <MessageSkeleton />
                </div>
              ) : hasDisplayMessages ? (
                <div className={styles.messages}>
                  <Bubble.List
                    items={bubbleItems}
                    role={roleConfig}
                    autoScroll
                    styles={{ root: { maxWidth: 952, width: '100%' } }}
                  />
                </div>
              ) : null}

              <div className={showEmpty ? styles.footerCenter : styles.footer}>
                {showEmpty && (
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
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  style={{ maxWidth: 952, width: '100%' }}
                  suffix={false}
                  footer={(actionNode) => (
                    <Flex justify="space-between" align="center">
                      <Flex gap="small" align="center">
                        {/* 模型选择：Dropdown + 缩写按钮 */}
                        <Dropdown
                          menu={{
                            selectedKeys: [selectedModel],
                            onClick: ({ key }) => {
                              setSelectedModel(key);
                              const meta = models.find((m) => m.name === key);
                              if (!meta?.supportsThinking) {
                                setEnableThinking(false);
                              }
                            },
                            items: modelMenuItems,
                          }}
                        >
                          <Sender.Switch
                            value={false}
                            icon={<AntDesignOutlined />}
                          >
                            {modelAbbr(selectedModel) || '选择模型'}
                          </Sender.Switch>
                        </Dropdown>
                        {/* 深度思考开关（仅思考模型显示） */}
                        {currentModel?.supportsThinking && (
                          <Sender.Switch
                            value={enableThinking}
                            checkedChildren={
                              <>
                                深度思考:
                                <span style={SwitchTextStyle}>开</span>
                              </>
                            }
                            unCheckedChildren={
                              <>
                                深度思考:
                                <span style={SwitchTextStyle}>关</span>
                              </>
                            }
                            onChange={(checked: boolean) =>
                              setEnableThinking(checked)
                            }
                            icon={
                              <LottieThinkingIcon active={enableThinking} />
                            }
                          />
                        )}
                      </Flex>
                      <Flex align="center">
                        <Divider orientation="vertical" />
                        {actionNode}
                      </Flex>
                    </Flex>
                  )}
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
