import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { ActionsFeedbackProps, BubbleListProps } from '@ant-design/x';
import {
  Actions,
  Bubble,
  Conversations,
  Prompts,
  Sender,
  Think,
  ThoughtChain,
  Welcome,
  XProvider,
} from '@ant-design/x';
import type { ComponentProps } from '@ant-design/x-markdown';
import XMarkdown from '@ant-design/x-markdown';
import type { DefaultMessageInfo } from '@ant-design/x-sdk';
import { DeepSeekChatProvider, useXChat } from '@ant-design/x-sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Button,
  Divider,
  Dropdown,
  Flex,
  type GetProp,
  Input,
  message,
  type MenuProps,
  Modal,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChatConversationItem,
  ChatModelItem,
  deleteChatSession,
  listChatMessages,
  listChatModels,
  listChatSessions,
  renameChatSession,
} from '@/services/chat';
import '@ant-design/x-markdown/themes/light.css';
import '@ant-design/x-markdown/themes/dark.css';
import { createChatProvider } from './service';
import { useStyles } from './style';
import { useMarkdownTheme } from './utils';

// ==================== 静态提示词 ====================
const HOT_TOPICS: GetProp<typeof Prompts, 'items'> = [
  {
    key: '1',
    label: '职场效率',
    children: [
      {
        key: '1-1',
        icon: <PlusOutlined />,
        label: '写一份周报',
        description: '帮我写一份本周工作周报，内容包括：完成 AI 对话功能开发、修复登录模块问题。',
      },
      {
        key: '1-2',
        icon: <PlusOutlined />,
        label: '会议纪要',
        description: '请根据以下要点帮我整理一份会议纪要：项目排期、风险项、责任人。',
      },
    ],
  },
  {
    key: '2',
    label: '开发助手',
    children: [
      {
        key: '2-1',
        icon: <PlusOutlined />,
        label: '解释代码',
        description: '请用通俗的语言解释 React 的 useEffect 依赖数组是如何工作的。',
      },
      {
        key: '2-2',
        icon: <PlusOutlined />,
        label: '头脑风暴',
        description: '为一个面向中小企业的智能客服产品做头脑风暴，列出 5 个核心功能点。',
      },
    ],
  },
];

const SENDER_PROMPTS: GetProp<typeof Prompts, 'items'> = [
  { key: '1', description: '帮我写一份周报', icon: <SyncOutlined /> },
  { key: '2', description: '用一句话介绍 DeepSeek 和通义千问的区别', icon: <SyncOutlined /> },
  { key: '3', description: '给出 5 个提升代码质量的建议', icon: <SyncOutlined /> },
  { key: '4', description: '把「今天天气真好」翻译成英文和日文', icon: <SyncOutlined /> },
];

const THOUGHT_CHAIN_CONFIG: Record<string, { title: string; status: string }> = {
  loading: { title: '正在调用模型', status: 'loading' },
  updating: { title: '正在调用模型', status: 'loading' },
  success: { title: '大模型执行完成', status: 'success' },
  error: { title: '执行失败', status: 'error' },
  abort: { title: '已终止', status: 'error' },
};

// ==================== 类型 ====================
interface ChatMessage extends Record<string, unknown> {
  role: string;
  content: string;
  extraInfo?: {
    feedback?: ActionsFeedbackProps['value'];
  };
}

// ==================== Context（Actions 页脚回调） ====================
const ChatContext = React.createContext<{
  onReload?: ReturnType<typeof useXChat>['onReload'];
  setMessage?: ReturnType<typeof useXChat<ChatMessage>>['setMessage'];
}>({});

// ==================== 子组件 ====================
/** 深度思考面板：流式「深度思考中...」→ 完成「思考完成」 */
const ThinkComponent = React.memo((props: ComponentProps) => {
  const [title, setTitle] = React.useState('深度思考中...');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
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

/** AI 气泡操作栏：重新生成 / 复制 / 反馈 */
const Footer: React.FC<{
  id?: string | number;
  content: string;
  status?: string;
  extraInfo?: ChatMessage['extraInfo'];
}> = ({ id, content, extraInfo, status }) => {
  const context = React.useContext(ChatContext);
  const items = [
    {
      key: 'retry',
      label: '重新生成',
      icon: <SyncOutlined />,
      onItemClick: () => {
        if (id) {
          context?.onReload?.(id, { userAction: 'retry' });
        }
      },
    },
    {
      key: 'copy',
      actionRender: <Actions.Copy text={content} />,
    },
    {
      key: 'feedback',
      actionRender: (
        <Actions.Feedback
          styles={{ liked: { color: '#f759ab' } }}
          value={extraInfo?.feedback || 'default'}
          onChange={(val) => {
            if (id) {
              context?.setMessage?.(id, () => ({
                extraInfo: { feedback: val },
              }));
            }
          }}
        />
      ),
    },
  ];
  return status !== 'updating' && status !== 'loading' ? (
    <div style={{ display: 'flex' }}>{id && <Actions items={items} />}</div>
  ) : null;
};

const formatContext = (tokens: number) =>
  tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : `${tokens}`;

/** 模型名缩写（模型选择按钮上显示） */
const MODEL_ABBR: Record<string, string> = {
  'deepseek-v4-flash': 'DS-Flash',
  'deepseek-v4-pro': 'DS-Pro',
  'deepseek-v4-flash-vision-exp': 'DS-Vision',
  'qwen3.7-plus': 'Qwen-Plus',
  'qwen3.8-flash': 'Qwen-Flash',
  'qwen3.8-max': 'Qwen-Max',
  'doubao-seed-2-1-pro-260628': 'Doubao-Pro',
  'doubao-seed-2-1-turbo-260628': 'Doubao-Turbo',
  'doubao-seed-evolving': 'Doubao-Evo',
};

const modelAbbr = (name: string) => MODEL_ABBR[name] ?? name;

/** 深度思考开关文字样式（on/off 居中窄列） */
const SwitchTextStyle: React.CSSProperties = {
  display: 'inline-flex',
  width: 24,
  justifyContent: 'center',
  alignItems: 'center',
};

const newChatId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ==================== 主页面 ====================
const ChatPage: React.FC = () => {
  const { styles } = useStyles();
  const [markdownClassName] = useMarkdownTheme();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const [inputValue, setInputValue] = useState('');
  const [models, setModels] = useState<ChatModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [enableThinking, setEnableThinking] = useState(false);

  // 会话列表自管（useState）：新增/删除/激活与 chatbot 页同构，行为可控
  const [conversations, setConversations] = useState<ChatConversationItem[]>([]);
  const [activeConversationKey, setActiveConversationKey] = useState('');

  const provider = useMemo(() => createChatProvider() as any, []);

  // 切换会话时由 useXChat 按 conversationKey 拉取后端历史
  const loadDefaultMessages = useCallback(
    async (info: { conversationKey?: string }) => {
      const chatId = info?.conversationKey;
      if (!chatId) return [] as DefaultMessageInfo<ChatMessage>[];
      try {
        const res = await listChatMessages(chatId);
        return (res?.data ?? []).map((record) => ({
          id: record.id,
          status: 'success' as const,
          // 思考内容拼回 <think> 标签，由 XMarkdown 的 think 组件渲染
          message: {
            role: record.role,
            content: record.reasoningContent
              ? `<think>\n\n${record.reasoningContent}\n\n</think>\n\n${record.content}`
              : record.content,
          },
        })) as DefaultMessageInfo<ChatMessage>[];
      } catch {
        return [] as DefaultMessageInfo<ChatMessage>[];
      }
    },
    [],
  );

  const {
    onRequest,
    abort,
    isRequesting,
    messages,
    onReload,
    setMessage,
  } = useXChat<ChatMessage>({
    provider,
    conversationKey: activeConversationKey,
    requestPlaceholder: { role: 'assistant', content: '' },
    defaultMessages: loadDefaultMessages as any,
    requestFallback: (_params, { error, messageInfo }) => {
      if (error.name === 'AbortError') {
        return {
          content: messageInfo?.message?.content || '请求已中止',
          role: 'assistant',
        };
      }
      return {
        content: '请求失败，请重试！',
        role: 'assistant',
      };
    },
  });

  const currentModel = useMemo(
    () => models.find((m) => m.name === selectedModel),
    [models, selectedModel],
  );

  // 用 ref 读最新 active，避免 refreshSessions 依赖 activeConversationKey
  // 造成「active 变化 → 回调重建 → 初始化 effect 重跑 → 后端列表覆盖本地新会话」的循环
  const activeKeyRef = React.useRef(activeConversationKey);
  activeKeyRef.current = activeConversationKey;

  const refreshSessions = useCallback(async () => {
    try {
      const res = await listChatSessions();
      if (res?.success) {
        const list = (res.data ?? []) as ChatConversationItem[];
        setConversations(list);
        // 仅在完全无激活会话时兜底（首载空列表场景）
        if (!activeKeyRef.current) {
          if (list.length > 0) {
            setActiveConversationKey(list[0].key);
          } else {
            const key = newChatId();
            setConversations([{ key, label: '新对话', group: '今天' }]);
            setActiveConversationKey(key);
          }
        }
      }
    } catch {
      // 会话列表拉取失败不阻断聊天
    }
  }, [setConversations, setActiveConversationKey]);

  // 初始化：模型列表 + 会话列表
  useEffect(() => {
    (async () => {
      try {
        const res = await listChatModels();
        if (res?.success) {
          setModels(res.data ?? []);
          setSelectedModel(
            (res as any).default ?? res.data?.[0]?.name ?? '',
          );
        }
      } catch {
        // 模型列表失败时选择器置空
      }
      await refreshSessions();
    })();
  }, [refreshSessions]);

  // 请求结束后刷新会话列表（新会话已在后端自动建档）
  const wasRequesting = React.useRef(false);
  useEffect(() => {
    if (wasRequesting.current && !isRequesting) {
      refreshSessions();
    }
    wasRequesting.current = isRequesting;
  }, [isRequesting, refreshSessions]);

  // 删除会话
  const { mutate: deleteRun } = useMutation({
    mutationFn: deleteChatSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      refreshSessions();
    },
    onError: () => {
      messageApi.error('删除会话失败');
    },
  });

  const onSubmit = (val: string) => {
    if (!val) return;
    if (!selectedModel) {
      messageApi.warning('模型列表加载中，请稍候');
      return;
    }
    // 兜底：无激活会话时先建一个（防止 chatId 为空导致 422）
    let chatId = activeConversationKey;
    if (!chatId) {
      chatId = newChatId();
      setConversations([{ key: chatId, label: '新对话', group: '今天', isDraft: true }]);
      setActiveConversationKey(chatId);
    }
    // 新会话首条消息：把「新对话」标题改为消息摘要（后端建档也用该摘要）
    const currentConv = conversations.find((c) => c.key === chatId);
    if (currentConv && currentConv.label === '新对话') {
      setConversations((prev) =>
        prev.map((c) => (c.key === chatId ? { ...c, label: val.slice(0, 20) } : c)),
      );
    }
    onRequest({
      messages: [{ role: 'user', content: val }],
      chatId,
      model: selectedModel,
      enableThinking,
    });
  };

  const handleNewConversation = () => {
    if (messages.length === 0) {
      messageApi.info('当前已经是新会话');
      return;
    }
    const key = newChatId();
    setConversations((prev) => [
      { key, label: '新对话', group: '今天', isDraft: true },
      ...prev,
    ]);
    setActiveConversationKey(key);
  };

  // ── 重命名会话 ──────────────────────────────────────────────
  const [renamingConv, setRenamingConv] = useState<ChatConversationItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const handleRenameOk = async () => {
    const conv = renamingConv;
    const title = renameValue.trim();
    if (!conv || !title) {
      messageApi.warning('会话名称不能为空');
      return;
    }
    // 草稿会话（后端无记录）只改本地；已建档会话同步后端
    if (!conv.isDraft) {
      setRenaming(true);
      try {
        const res = await renameChatSession(conv.key, title);
        if (!res?.success) {
          messageApi.error(res?.errorMessage ?? '重命名失败');
          return;
        }
      } catch {
        messageApi.error('重命名失败');
        return;
      } finally {
        setRenaming(false);
      }
    }
    setConversations((prev) =>
      prev.map((c) => (c.key === conv.key ? { ...c, label: title } : c)),
    );
    setRenamingConv(null);
  };

  const handleDeleteConversation = (conv: ChatConversationItem) => {
    const remaining = conversations.filter((c) => c.key !== conv.key);
    setConversations(remaining);
    if (conv.key === activeConversationKey) {
      if (remaining.length > 0) {
        setActiveConversationKey(remaining[0].key);
      } else {
        const key = newChatId();
        setConversations([{ key, label: '新对话', group: '今天' }]);
        setActiveConversationKey(key);
      }
    }
    // draft 会话（label 为「新对话」且无后端记录）删除接口会 404，静默处理
    deleteRun(conv.key);
  };

  // ==================== 气泡角色配置 ====================
  const roleConfig: BubbleListProps['role'] = useMemo(
    () => ({
      assistant: {
        placement: 'start',
        avatar: (
          <Avatar style={{ background: '#6f5bf5', fontSize: 16 }} shape="square">
            AI
          </Avatar>
        ),
        header: (_content, { status }) => {
          const config = THOUGHT_CHAIN_CONFIG[status as string];
          return config ? (
            <ThoughtChain.Item
              style={{ marginBottom: 8 }}
              status={config.status as any}
              variant="solid"
              title={config.title}
            />
          ) : null;
        },
        footer: (content, { status, key, extraInfo }) => (
          <Footer
            content={content}
            status={status}
            extraInfo={extraInfo as ChatMessage['extraInfo']}
            id={key as string}
          />
        ),
        contentRender: (content: string, { status }) => {
          if (!content) return undefined;
          return (
            <XMarkdown
              paragraphTag="div"
              components={{ think: ThinkComponent }}
              className={markdownClassName}
              streaming={{
                hasNextChunk: status === 'updating',
                enableAnimation: true,
              }}
            >
              {content}
            </XMarkdown>
          );
        },
      },
      user: {
        placement: 'end',
        avatar: (
          <Avatar style={{ background: '#87d068', fontSize: 16 }} shape="square">
            我
          </Avatar>
        ),
      },
    }),
    [markdownClassName],
  );

  // ==================== 节点 ====================
  // 重新生成：带上会话/模型参数与 regenerate 标记，后端会移除上一条 AI 回复后重新作答
  const handleReload = useCallback(
    (id: string | number) => {
      onReload?.(
        id,
        {
          userAction: 'retry',
          chatId: activeConversationKey,
          model: selectedModel,
          enableThinking,
          regenerate: true,
        } as any,
      );
    },
    [onReload, activeConversationKey, selectedModel, enableThinking],
  );

  // 模型选择菜单（按平台分组；菜单项显示全名+上下文，按钮上显示缩写）
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

  const chatSide = (
    <div className={styles.side}>
      <div className={styles.logo}>
        <span>🤖 智能助手</span>
      </div>
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={handleNewConversation}
        style={{ marginBottom: 8 }}
      >
        新建对话
      </Button>
      <Conversations
        groupable
        items={conversations as any}
        className={styles.conversations}
        activeKey={activeConversationKey}
        onActiveChange={setActiveConversationKey}
        styles={{ item: { padding: '0 8px' } }}
        menu={(conversation) => ({
          items: [
            {
              label: '重命名',
              key: 'rename',
              icon: <EditOutlined />,
              onClick: () => {
                setRenamingConv(conversation as ChatConversationItem);
                setRenameValue((conversation as ChatConversationItem).label ?? '');
              },
            },
            {
              label: '删除',
              key: 'delete',
              icon: <DeleteOutlined />,
              danger: true,
              onClick: () => handleDeleteConversation(conversation as ChatConversationItem),
            },
          ],
        })}
      />
      <div className={styles.sideFooter}>
        <Avatar size={28} style={{ background: '#87d068' }}>
          我
        </Avatar>
      </div>
    </div>
  );

  const chatList = (
    <div className={styles.chatList}>
      {messages?.length ? (
        <Bubble.List
          items={messages.map((i) => ({
            ...(i.message as any),
            key: i.id,
            status: i.status,
            loading: i.status === 'loading',
            extraInfo: i.extraInfo,
          }))}
          styles={{ root: { maxWidth: 940 } }}
          role={roleConfig}
        />
      ) : (
        <Flex vertical align="center" gap={16} className={styles.placeholder} style={{ maxWidth: 840 }}>
          <Welcome
            style={{ width: '100%' }}
            variant="borderless"
            icon="🤖"
            title="你好，我是智能助手"
            description="接入 DeepSeek / 通义千问 / 豆包，支持多轮对话与深度思考"
          />
          <Flex gap={16} justify="center" style={{ width: '100%' }}>
            {HOT_TOPICS.map((topic) => (
              <Prompts
                key={topic.key}
                items={[topic]}
                styles={{
                  list: { height: '100%' },
                  item: {
                    flex: 1,
                    backgroundImage: 'linear-gradient(123deg, #e5f4ff 0%, #efe7ff 100%)',
                    borderRadius: 12,
                    border: 'none',
                  },
                  subItem: { padding: 0, background: 'transparent' },
                }}
                onItemClick={(info) => onSubmit(info.data.description as string)}
                className={styles.senderPrompt}
              />
            ))}
          </Flex>
        </Flex>
      )}
    </div>
  );

  const chatSender = (
    <Flex vertical gap={12} align="center" style={{ margin: 8 }}>
      {!isRequesting && (
        <Prompts
          items={SENDER_PROMPTS}
          onItemClick={(info) => onSubmit(info.data.description as string)}
          styles={{ item: { padding: '6px 12px' } }}
          className={styles.senderPrompt}
        />
      )}
      <Sender
        value={inputValue}
        onChange={setInputValue}
        onSubmit={() => {
          onSubmit(inputValue);
          setInputValue('');
        }}
        onCancel={abort}
        loading={isRequesting}
        className={styles.sender}
        placeholder="输入 / 提问，Enter 发送，Shift+Enter 换行"
        autoSize={{ minRows: 3, maxRows: 6 }}
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
                    if (!meta?.supportsThinking) setEnableThinking(false);
                  },
                  items: modelMenuItems,
                }}
              >
                <Sender.Switch value={false} icon={<ApiOutlined />}>
                  {modelAbbr(selectedModel) || '选择模型'}
                </Sender.Switch>
              </Dropdown>
              {/* 深度思考开关（仅思考模型显示） */}
              {currentModel?.supportsThinking && (
                <Sender.Switch
                  value={enableThinking}
                  checkedChildren={
                    <>
                      深度思考:<span style={SwitchTextStyle}>开</span>
                    </>
                  }
                  unCheckedChildren={
                    <>
                      深度思考:<span style={SwitchTextStyle}>关</span>
                    </>
                  }
                  onChange={(checked: boolean) => setEnableThinking(checked)}
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
    </Flex>
  );

  return (
    <XProvider>
      <ChatContext.Provider value={{ onReload: handleReload, setMessage }}>
        {contextHolder}
        <div className={styles.layout}>
          {chatSide}
          <div className={styles.chat}>
            {chatList}
            {chatSender}
          </div>
        </div>
        <Modal
          title="重命名会话"
          open={!!renamingConv}
          centered
          onOk={handleRenameOk}
          onCancel={() => setRenamingConv(null)}
          okText="保存"
          cancelText="取消"
          confirmLoading={renaming}
          destroyOnHidden
        >
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="请输入会话名称"
            maxLength={50}
            onPressEnter={handleRenameOk}
            autoFocus
          />
        </Modal>
      </ChatContext.Provider>
    </XProvider>
  );
};

export default ChatPage;
