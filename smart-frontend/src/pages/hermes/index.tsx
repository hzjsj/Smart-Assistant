import {
  ArrowDownOutlined,
  DownloadOutlined,
  FileTextOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  SyncOutlined,
} from '@ant-design/icons';
// 公式渲染样式（x-markdown Latex 插件依赖 katex 样式；hwzs 由出卷页顺带加载，独立路由需自引入）
import 'katex/dist/katex.min.css';
import {
  Actions,
  Bubble,
  Conversations,
  Sender,
  XProvider,
} from '@ant-design/x';
import type {
  BubbleItemType,
  BubbleListProps,
  BubbleListRef,
} from '@ant-design/x/es/bubble/interface';
import type { SenderRef } from '@ant-design/x/es/sender/interface';
import { useXChat, useXConversations } from '@ant-design/x-sdk';
import {
  Badge,
  Button,
  Card,
  Dropdown,
  Input,
  Modal,
  message,
  Spin,
} from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ossMdTextToDocxApiOssConvertMdTextToDocxPost } from '@/services/fast-api-manage/osSwenjianshangchuan';
import AssistantPrompts from './assistant/AssistantPrompts';
import { ASSISTANT_PRESETS } from './assistant/presets';
import { useAssistantMode } from './assistant/useAssistantMode';
import {
  type ChatAttachmentDraft,
  deleteAttachment,
  isDeepSeekImage,
  MAX_SEND_ATTACHMENTS,
} from './attachmentService';
import { chatTokens } from './chatTokens';
import AssistantMessage, {
  type AssistantMessageView,
} from './components/AssistantMessage';
import ChatAttachments from './components/ChatAttachments';
import PaperForm from './components/PaperForm';
import QuestionBankPanel from './components/question-bank/QuestionBankPanel';
import QuestionWorkspace from './components/question-bank/QuestionWorkspace';
import { WorkbenchActionsContext } from './components/question-bank/WorkbenchActionsContext';
import UserMessage from './components/UserMessage';
import {
  abortConversationRecord,
  type ConversationRecord,
  conversationGroupFor,
  createConversationRecord,
  deleteConversationRecord,
  listConversations,
  listMessages,
  messageRecordToMessageInfo,
  readDraftsFromStorage,
  renameConversation,
  syncDraftsToStorage,
} from './conversationService';
import type {
  ApprovalActivity,
  ConversationDrafts,
  ConversationItem,
  HermesMessage,
} from './data';
import { finalizeHermesMessage } from './HermesChatProvider';
import HermesLayout from './layout';
import {
  buildPaperSummary,
  defaultPaperConfig,
  type PaperConfig,
  toPaperRequestConfig,
} from './paper';
import type { QuestionBankCardData } from './question-bank/types';
import { useQuestionBankWorkspace } from './question-bank/useQuestionBankWorkspace';
import { buildRetryParams, type HermesChatParams } from './request';
import {
  ATTACHMENT_CHAT_API_URL,
  BAILIAN_CHAT_API_URL,
  CHAT_API_URL,
  CHAT_MODEL_LABELS,
  type ChatModel,
  createChatProvider,
  DEEPSEEK_CHAT_API_URL,
  DIFY_CHAT_API_URL,
  getChatErrorMessage,
} from './service';
import { useStyles } from './style';
import {
  type RestoredHistory,
  useConversationHistory,
} from './useConversationHistory';
import { useEntryNavigation } from './useEntryNavigation';
import { useNewConversationRequest } from './useNewConversationRequest';
import { usePacedMessages } from './usePacedMessages';

const WELCOME_TEXTS: Record<ChatModel, string> = {
  hermes: '你好，我是 Hermes Agent，有什么可以帮你？',
  deepseek: '你好，我是 DeepSeek，有什么可以帮你？',
  dify: '你好，我是 Dify 智能助手，有什么可以帮你？',
  bailian: '你好，我是百炼智能体，有什么可以帮你？',
};
const CHAT_MODEL_STORAGE_KEY = 'hermes-chat-model';

const readInitialChatModel = (): ChatModel => {
  try {
    const stored = localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
    return stored === 'hermes' ||
      stored === 'deepseek' ||
      stored === 'dify' ||
      stored === 'bailian'
      ? stored
      : 'hermes';
  } catch {
    // 隐私模式等 localStorage 不可用场景下回落默认模型。
    return 'hermes';
  }
};
const chatTheme = {
  token: {
    fontFamily: chatTokens.fontFamily,
    fontFamilyCode: chatTokens.codeFontFamily,
  },
};
const bubbleListStyles: BubbleListProps['styles'] = {
  root: { height: '100%', minHeight: 0 },
  // Column styles compensate for the actual scrollbar width when it appears.
  scroll: { overflowX: 'hidden' },
};

const createConversation = (): ConversationItem => ({
  key: crypto.randomUUID(),
  label: '💬 新对话',
  group: '今天',
});

const TypewriterTitle: React.FC<{ text: string }> = ({ text }) => {
  const { styles } = useStyles();
  const [index, setIndex] = useState(0);
  const done = index >= text.length;

  useEffect(() => {
    // 文案切换（模型切换）时从头重打。
    setIndex(0);
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= text.length) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 60);
    return () => clearInterval(timer);
  }, [text]);

  return (
    <>
      {text.slice(0, index)}
      {!done && <span className={styles.cursor}>|</span>}
    </>
  );
};

const downloadMarkdownAsWord = async (content: string) => {
  const result = await ossMdTextToDocxApiOssConvertMdTextToDocxPost({
    md_content: content,
    filename: 'Hermes Agent 回答',
  });
  if (!result.url) throw new Error('文档转换失败');

  const response = await fetch(result.url);
  if (!response.ok) throw new Error('文档下载失败');
  const fileBlob = await response.blob();
  const blobUrl = URL.createObjectURL(fileBlob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = 'Hermes-Agent-回答.docx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
};

/**
 * 侧栏隐藏时聊天视图顶部的展开入口。
 * 必须是独立组件：WorkbenchActionsContext.Provider 位于 layout 内部，
 * 只有渲染在 Provider 下游的组件才能读到 navHidden。
 */
const NavExpandBar: React.FC<{ workbenchOpen?: boolean }> = ({
  workbenchOpen,
}) => {
  const { styles } = useStyles();
  const { navHidden, navigation } = React.useContext(WorkbenchActionsContext);
  // 工作台视图由其工具栏的「展开导航」按钮负责，避免双入口重叠。
  if (!navHidden || workbenchOpen) return null;
  return <div className={styles.navExpandBar}>{navigation}</div>;
};

const ChatContext = React.createContext<{
  isRequesting: boolean;
  onReload: (id: string | number) => void;
  onDownload: (content: string) => void;
  onApprovalUpdate: (activity: ApprovalActivity) => void;
  onUsePrompt: (content: string) => void;
  onOpenQuestionBank: (card: QuestionBankCardData) => void;
  /** 点击欢迎消息内的示例链接（promptKey/exampleKey）：填入插槽模板。 */
  onSelectExample: (selectionKey: string) => void;
}>({
  isRequesting: false,
  onReload: () => {},
  onDownload: () => {},
  onApprovalUpdate: () => {},
  onUsePrompt: () => {},
  onOpenQuestionBank: () => {},
  onSelectExample: () => {},
});

const Footer: React.FC<{
  id: string | number;
  content: HermesMessage;
  status?: string;
}> = ({ id, content, status }) => {
  const { isRequesting, onReload, onDownload } = React.useContext(ChatContext);
  if (status === 'updating' || status === 'loading') return null;

  const resultContent = content.content;
  if (!resultContent && status !== 'error' && status !== 'abort') return null;
  const items = [
    ...(!isRequesting
      ? [
          {
            key: 'retry',
            label: '重新生成',
            icon: <SyncOutlined />,
            onItemClick: () => onReload(id),
          },
        ]
      : []),
    ...(resultContent
      ? [
          {
            key: 'copy',
            actionRender: () => <Actions.Copy text={resultContent} />,
          },
          {
            key: 'download',
            label: '下载',
            icon: <DownloadOutlined />,
            onItemClick: () => onDownload(resultContent),
          },
        ]
      : []),
  ];

  return (
    <div style={{ display: 'flex' }}>
      <Actions items={items} />
    </div>
  );
};

const AssistantBubbleContent: React.FC<{
  content: AssistantMessageView;
  status?: string;
}> = ({ content, status }) => {
  const { onApprovalUpdate, onOpenQuestionBank, onSelectExample } =
    React.useContext(ChatContext);
  return (
    <AssistantMessage
      message={content}
      status={status}
      requestStatus={content.requestStatus}
      onApprovalUpdate={onApprovalUpdate}
      onOpenQuestionBank={onOpenQuestionBank}
      onSelectExample={onSelectExample}
    />
  );
};

const UserBubbleContent: React.FC<{ message: HermesMessage }> = ({
  message,
}) => {
  const { onUsePrompt } = React.useContext(ChatContext);
  return (
    <UserMessage
      content={message.content}
      attachments={message.attachments}
      onUsePrompt={onUsePrompt}
    />
  );
};

const roleConfig: BubbleListProps['role'] = {
  user: {
    placement: 'end',
    variant: 'borderless',
    typing: false,
    styles: {
      body: { width: '100%', minWidth: 0 },
      content: {
        padding: 0,
        background: 'transparent',
        borderRadius: 0,
        whiteSpace: 'normal',
      },
    },
    contentRender: (content: unknown) => (
      <UserBubbleContent message={content as HermesMessage} />
    ),
  },
  ai: {
    placement: 'start',
    variant: 'borderless',
    typing: false,
    styles: {
      body: { width: '100%', minWidth: 0 },
      content: { padding: 0, background: 'transparent', borderRadius: 0 },
      footer: { marginBlockStart: 8 },
    },
    footer: (content, { status, key }) => (
      <Footer
        content={content as unknown as HermesMessage}
        status={status}
        id={key as string}
      />
    ),
    contentRender: (
      content: string,
      info: { status?: string; loading?: boolean },
    ) => {
      if (info?.loading || !content) return undefined;
      return (
        <AssistantBubbleContent
          content={content as unknown as AssistantMessageView}
          status={info.status}
        />
      );
    },
  },
};

const HermesPage: React.FC = () => {
  const { styles } = useStyles();
  const [messageApi, contextHolder] = message.useMessage();
  const [initialConversation] = useState(createConversation);
  // 输入草稿按会话持久化到 localStorage（读自 storage，写时全量同步）。
  const [drafts, setDrafts] = useState<ConversationDrafts>(
    readDraftsFromStorage,
  );
  // 会话持久化加载态：列表未就绪前主区显示 Spin，避免闪现内存空会话。
  const [conversationsLoading, setConversationsLoading] = useState(true);
  // 后端仍在生成的会话（页面刷新/断线后转移后台）：3 秒轮询恢复进度。
  const [backendStreamingId, setBackendStreamingId] = useState<string | null>(
    null,
  );
  // 被切走的流式会话（本地 provider 流或后端生成）：侧栏项三点左侧显示
  // loading 指示；切回该会话即移除（视图内已直接可见流式/最新内容）。
  const [backgroundStreamingKeys, setBackgroundStreamingKeys] = useState<
    Set<string>
  >(new Set());
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // 会话列表滚动条自动显隐：滚动期间显示，停止 600ms 后隐藏。
  const [listScrolling, setListScrolling] = useState(false);
  const listScrollTimer = useRef<number | undefined>(undefined);
  const handleListScroll = () => {
    setListScrolling(true);
    if (listScrollTimer.current !== undefined) {
      window.clearTimeout(listScrollTimer.current);
    }
    listScrollTimer.current = window.setTimeout(() => {
      setListScrolling(false);
      listScrollTimer.current = undefined;
    }, 600);
  };
  useEffect(
    () => () => {
      if (listScrollTimer.current !== undefined) {
        window.clearTimeout(listScrollTimer.current);
      }
    },
    [],
  );
  /** 附件草稿按会话隔离；发送后清空，附件仅随当次消息生效。 */
  const [attachmentDrafts, setAttachmentDrafts] = useState<
    Record<string, ChatAttachmentDraft[]>
  >({});
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  /** 发送过附件的会话：后续请求（含重试快照）统一走 mineru 附件聊天端点。 */
  const [attachmentConversations, setAttachmentConversations] = useState<
    Set<string>
  >(new Set());
  const [view, setView] = useState<'chat' | 'paper'>('chat');
  const entryNavigation = useEntryNavigation();
  const [paperConfig, setPaperConfig] =
    useState<PaperConfig>(defaultPaperConfig);
  const bubbleListRef = useRef<BubbleListRef>(null);
  const senderRef = useRef<SenderRef>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const pendingScrollConversation = useRef<string | null>(null);
  const providerCache = useRef(
    new Map<
      string,
      Partial<
        Record<
          'plain' | 'ref' | 'deepseek' | 'dify' | 'bailian',
          ReturnType<typeof createChatProvider>
        >
      >
    >(),
  );
  // 对话模型选择：hermes（Hermes Agent）或 deepseek，右下角下拉切换并持久化。
  // 提交智能组卷时默认切回 Hermes Agent（question_bank 任务依赖其题库工具），
  // 用户可在此后再自行切换。
  const [chatModel, setChatModel] = useState<ChatModel>(readInitialChatModel);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_MODEL_STORAGE_KEY, chatModel);
    } catch {
      // 持久化失败不影响本次会话使用。
    }
  }, [chatModel]);

  useEffect(() => {
    syncDraftsToStorage(drafts);
  }, [drafts]);

  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    removeConversation,
    setConversation,
    getConversation,
    setConversations,
  } = useXConversations({
    defaultConversations: [initialConversation],
    defaultActiveConversationKey: initialConversation.key,
  });

  const currentAttachments = attachmentDrafts[activeConversationKey] ?? [];
  const uploadingCount = currentAttachments.filter(
    (item) => item.status === 'uploading',
  ).length;
  const readyAttachments = currentAttachments.filter(
    (item) => item.status === 'done' && item.url,
  );
  // 带附件（或该会话曾用附件）时走 mineru 端点；纯聊天经其为无害空注入。
  const useRefEndpoint =
    readyAttachments.length > 0 ||
    attachmentConversations.has(activeConversationKey);

  const updateAttachments = (
    conversationKey: string,
    updater: (prev: ChatAttachmentDraft[]) => ChatAttachmentDraft[],
  ) => {
    setAttachmentDrafts((previous) => ({
      ...previous,
      [conversationKey]: updater(previous[conversationKey] ?? []),
    }));
  };

  const getProvider = (
    conversationKey: string,
    model: ChatModel,
    withAttachments: boolean,
  ) => {
    let entry = providerCache.current.get(conversationKey);
    if (!entry) {
      entry = {};
      providerCache.current.set(conversationKey, entry);
    }
    // DeepSeek 模式（含图片附件）恒走 DeepSeek 端点，图片由后端注入 image_url。
    if (model === 'deepseek') {
      if (!entry.deepseek) {
        entry.deepseek = createChatProvider(
          DEEPSEEK_CHAT_API_URL,
          conversationKey,
        );
      }
      return entry.deepseek as ReturnType<typeof createChatProvider>;
    }
    // Dify 模式恒走 Dify 端点（后端把事件翻译为 OpenAI 流，上下文由 Dify 维护）。
    if (model === 'dify') {
      if (!entry.dify) {
        entry.dify = createChatProvider(DIFY_CHAT_API_URL, conversationKey);
      }
      return entry.dify as ReturnType<typeof createChatProvider>;
    }
    // 百炼模式恒走百炼 Agent 端点（session 多轮由上游维护）。
    if (model === 'bailian') {
      if (!entry.bailian) {
        entry.bailian = createChatProvider(
          BAILIAN_CHAT_API_URL,
          conversationKey,
        );
      }
      return entry.bailian as ReturnType<typeof createChatProvider>;
    }
    if (withAttachments && !entry.ref) {
      entry.ref = createChatProvider(ATTACHMENT_CHAT_API_URL, conversationKey);
    }
    if (!withAttachments && !entry.plain) {
      entry.plain = createChatProvider(CHAT_API_URL, conversationKey);
    }
    return (withAttachments ? entry.ref : entry.plain) as ReturnType<
      typeof createChatProvider
    >;
  };

  const questionWorkspace = useQuestionBankWorkspace(activeConversationKey);

  const {
    onRequest,
    onReload,
    abort,
    isRequesting,
    messages,
    setMessages,
    setMessage,
    isDefaultMessagesRequesting,
  } = useXChat<HermesMessage, HermesMessage, HermesChatParams>({
    provider: getProvider(activeConversationKey, chatModel, useRefEndpoint),
    conversationKey: activeConversationKey,
    defaultMessages: [],
    requestPlaceholder: {
      role: 'assistant',
      content: '',
      activities: [],
      contentActive: false,
    },
    requestFallback: (_, { error, messageInfo }) => {
      const partial = messageInfo?.message || {
        role: 'assistant' as const,
        content: '',
        activities: [],
      };
      const partialContent = partial.content;
      if (error.name === 'AbortError') {
        const finalized = finalizeHermesMessage(partial, 'abort');
        return {
          ...finalized,
          content: partialContent,
          activities: [
            ...finalized.activities,
            {
              type: 'status',
              key: `abort:${Date.now()}`,
              kind: 'status',
              text: '生成已停止。',
            },
          ],
        };
      }
      const errorMessage = getChatErrorMessage(error);
      const finalized = finalizeHermesMessage(partial, 'error');
      return {
        ...finalized,
        content: partialContent,
        activities: [
          ...finalized.activities,
          {
            type: 'status',
            key: `error:${Date.now()}`,
            kind: 'error',
            text: `回答中断：${errorMessage}`,
          },
        ],
      };
    },
  });

  const {
    visibleMessages,
    pending: isPlaying,
    flush,
  } = usePacedMessages(messages, activeConversationKey);
  // 后端仍在生成的会话视为忙：发送被禁、停止按钮作用于后台采集任务。
  const busy =
    isRequesting || isPlaying || backendStreamingId === activeConversationKey;

  const activateConversation = (key: string) => {
    setBackgroundStreamingKeys((previous) => {
      const next = new Set(previous);
      if (
        key !== activeConversationKey &&
        (isRequesting || backendStreamingId === activeConversationKey)
      ) {
        next.add(activeConversationKey);
      }
      next.delete(key);
      return next;
    });
    setActiveConversationKey(key);
  };

  // 会话持久化：加载服务端会话列表（默认激活最近会话 = 刷新恢复）。
  // 列表加载后继续读取当前会话历史，成功确认后才允许发送。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const records = await listConversations();
        if (cancelled) return;
        if (records.length > 0) {
          // 按会话标题回填快捷助手归属（刷新后仍显示指令行）。
          assistantRef.current?.registerConversations(records);
          setConversations(
            records.map((record: ConversationRecord) => ({
              key: record.id,
              label: record.title,
              group: conversationGroupFor(record.updated_at),
            })),
          );
          setActiveConversationKey(records[0].id);
        } else {
          const record = await createConversationRecord();
          if (cancelled) return;
          setConversations([
            { key: record.id, label: record.title, group: '今天' },
          ]);
          setActiveConversationKey(record.id);
        }
      } catch {
        // 保留当前会话；后续历史读取失败时展示错误，不视为空会话。
      } finally {
        if (!cancelled) setConversationsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 仅页面加载执行一次；setConversations/setActiveConversationKey 为 store 稳定方法。
  }, [setConversations, setActiveConversationKey]);

  const onHistoryRestored = useCallback(
    ({ conversationKey, hasAttachments, streaming }: RestoredHistory) => {
      if (hasAttachments) {
        setAttachmentConversations((previous) => {
          if (previous.has(conversationKey)) return previous;
          return new Set(previous).add(conversationKey);
        });
      }
      if (streaming) setBackendStreamingId(conversationKey);
    },
    [],
  );
  const history = useConversationHistory({
    activeConversationKey,
    enabled: !conversationsLoading,
    messageCount: messages.length,
    setMessages,
    onRestored: onHistoryRestored,
  });
  const { forgetConversation: forgetHistory } = history;
  const historyReady = history.status === 'ready';
  const historyLoading = history.status === 'loading';

  // 后台生成轮询：仅更新当前激活会话；切走时清除其恢复标记（切回重拉最新）。
  // 拉到 status=0 的 assistant 以 'updating' 注入——打字机对增量内容逐字续播，
  // 完成后最后一次以 'local' 收尾（Bubble streaming 光标随之关闭）。
  useEffect(() => {
    if (!backendStreamingId) return;
    if (backendStreamingId !== activeConversationKey) {
      forgetHistory(backendStreamingId);
      return;
    }
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const page = await listMessages(backendStreamingId);
          if (cancelled) return;
          const last = page.messages[page.messages.length - 1];
          const stillStreaming =
            last &&
            (last.role === 'user' ||
              (last.role === 'assistant' && last.status === 0));
          setMessages(
            page.messages.map((record, index) =>
              messageRecordToMessageInfo(
                record,
                stillStreaming && index === page.messages.length - 1,
              ),
            ),
          );
          if (!stillStreaming) {
            setBackendStreamingId(null);
          }
        } catch {
          // 网络抖动：下一轮重试。
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backendStreamingId, activeConversationKey, setMessages, forgetHistory]);

  // 快捷助手：会话归属、独立欢迎内容、插槽模板。
  const assistant = useAssistantMode({
    presets: ASSISTANT_PRESETS,
    activeConversationKey,
    messages,
    model: chatModel,
    createConversation: createConversationRecord,
    addConversation,
    setActiveConversationKey: activateConversation,
    renameConversation,
    setConversationLabel: (key, label) => setConversation(key, { key, label }),
    messageApi,
    ready: historyReady,
  });
  // 会话列表加载 effect 定义在本 hook 之前：经 ref 回填，避免声明顺序依赖。
  const assistantRef = useRef(assistant);
  assistantRef.current = assistant;

  const inputValue = drafts[activeConversationKey] ?? '';

  const paperRequest = useNewConversationRequest({
    activeConversationKey,
    initializing:
      isDefaultMessagesRequesting || !historyReady || view !== 'chat',
    onSend: (content, paperConfig) => {
      pendingScrollConversation.current = activeConversationKey;
      onRequest({
        messages: [{ role: 'user', content }],
        ...(paperConfig
          ? { task: 'question_bank', paper_config: paperConfig }
          : { task: 'chat' }),
      });
    },
  });

  useEffect(() => {
    if (pendingScrollConversation.current !== activeConversationKey) return;

    // Wait for the new bubbles and the list's scroll container to mount.
    const frame = requestAnimationFrame(() => {
      bubbleListRef.current?.scrollTo({ top: 'bottom', behavior: 'instant' });
      pendingScrollConversation.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, activeConversationKey]);

  const sendMessage = (value: string) => {
    const content = value.trim();
    if (!content || busy || !historyReady) return;
    if (uploadingCount > 0) {
      messageApi.info('附件上传中，请等待上传完成后再发送');
      return;
    }
    if (readyAttachments.length > MAX_SEND_ATTACHMENTS) {
      messageApi.warning(
        `一次最多随消息发送 ${MAX_SEND_ATTACHMENTS} 个附件，请移除部分后再发送`,
      );
      return;
    }

    const currentConversation = getConversation(activeConversationKey);
    if (
      messages.length === 0 &&
      currentConversation &&
      !assistant.activePreset
    ) {
      setConversation(activeConversationKey, {
        ...currentConversation,
        label: content.slice(0, 24),
      });
    }

    setDrafts((previous) => ({ ...previous, [activeConversationKey]: '' }));
    // 错误提示只用于展示，不作为下一轮 assistant 上下文发送。
    setMessages((previous) =>
      previous.filter((info) => info.status !== 'error'),
    );
    pendingScrollConversation.current = activeConversationKey;
    // 附件仅随当次消息发送：随请求透传给 mineru 端点，由后端注入后转发上游。
    const attachments = readyAttachments.map((item) => ({
      url: item.url as string,
      name: item.name,
    }));
    if (attachments.length > 0 && chatModel !== 'deepseek') {
      // 「曾用附件」标记仅影响 hermes 端点的选择，DeepSeek 通道恒定。
      setAttachmentConversations((previous) => {
        if (previous.has(activeConversationKey)) return previous;
        const next = new Set(previous);
        next.add(activeConversationKey);
        return next;
      });
    }
    onRequest({
      messages: [{ role: 'user', content }],
      ...(attachments.length ? { attachments } : {}),
    });
    updateAttachments(activeConversationKey, () => []);
    // 发送后附件已随消息带走，收起上传面板避免占住输入区上方空间。
    setAttachmentsOpen(false);
  };

  /** 切换对话模型；切到 DeepSeek 时移除草稿中的非图片附件（图像理解限制）。 */
  const switchChatModel = (model: ChatModel) => {
    if (model === chatModel) return;
    setChatModel(model);
    if (model !== 'deepseek') return;
    const drafts = attachmentDrafts[activeConversationKey] ?? [];
    const removed = drafts.filter((item) => !isDeepSeekImage(item.name));
    if (removed.length === 0) return;
    removed.forEach((item) => {
      if (item.id) void deleteAttachment(item.id).catch(() => undefined);
    });
    updateAttachments(activeConversationKey, (prev) =>
      prev.filter((item) => isDeepSeekImage(item.name)),
    );
    messageApi.info('DeepSeek 仅支持图片解析，已移除草稿中的非图片附件');
  };

  const activateNewConversation = (conversation: ConversationItem) => {
    addConversation(conversation, 'prepend');
    activateConversation(conversation.key);
    setView('chat');
  };

  const newChat = () => {
    paperRequest.cancel();
    questionWorkspace.close();
    setView('chat');
    if (historyReady && messages.length === 0 && !assistant.activePreset) {
      entryNavigation.cancel();
      messageApi.info('当前已是新对话');
      return;
    }
    // 会话先落服务端拿稳定 id（conversationKey 全程用服务端 id）。
    void entryNavigation.run('chat', async (isCurrent) => {
      try {
        // 记录当前所选模型（dify / deepseek / hermes），便于会话列表区分。
        const record = await createConversationRecord(undefined, chatModel);
        const conversation = {
          key: record.id,
          label: record.title,
          group: '今天',
        };
        if (isCurrent()) activateNewConversation(conversation);
        else addConversation(conversation, 'prepend');
      } catch {
        if (isCurrent()) messageApi.error('创建会话失败，请稍后重试');
      }
    });
  };

  const submitPaper = (config: PaperConfig) => {
    if (busy || paperRequest.pending) return;
    void entryNavigation.run('paper', async (isCurrent) => {
      let record: ConversationRecord;
      try {
        record = await createConversationRecord(
          `智能组卷 · ${config.subject} · ${config.grade}`,
          'hermes',
        );
      } catch {
        if (isCurrent()) messageApi.error('创建组卷会话失败，请稍后重试');
        return;
      }
      const conversation: ConversationItem = {
        key: record.id,
        label: record.title,
        group: '今天',
      };
      if (!isCurrent()) {
        addConversation(conversation, 'prepend');
        return;
      }
      if (
        !paperRequest.enqueue({
          conversationKey: conversation.key,
          content: buildPaperSummary(config),
          paperConfig: toPaperRequestConfig(config),
        })
      ) {
        // 排队失败（已有排队请求）：清理刚创建的空会话。
        void deleteConversationRecord(record.id).catch(() => undefined);
        return;
      }
      // 组卷（question_bank）依赖 Hermes Agent 的题库工具：提交组卷时默认
      // 切回 Hermes Agent，用户在此后的对话中仍可自行切换模型。
      setChatModel('hermes');
      setPaperConfig(config);
      activateNewConversation(conversation);
    });
  };

  const deleteConversation = (conversationKey: string) => {
    entryNavigation.cancel();
    paperRequest.cancel();
    if (conversationKey === activeConversationKey) {
      if (isRequesting) abort();
      if (backendStreamingId === conversationKey) setBackendStreamingId(null);
    } else {
      // 各端点的 provider 都可能有进行中的请求，一并中止。
      const entry = providerCache.current.get(conversationKey);
      for (const provider of [
        entry?.plain,
        entry?.ref,
        entry?.deepseek,
        entry?.dify,
        entry?.bailian,
      ]) {
        if (provider?.request.isRequesting) provider.request.abort();
      }
      if (backendStreamingId === conversationKey) setBackendStreamingId(null);
    }
    forgetHistory(conversationKey);
    // 清理快捷助手会话归属标记。
    assistant.forgetConversation(conversationKey);
    // 服务端软删除；失败不阻断界面移除。
    void deleteConversationRecord(conversationKey).catch(() => undefined);

    providerCache.current.delete(conversationKey);
    // 侧栏 loading 指示同步清理。
    setBackgroundStreamingKeys((previous) => {
      if (!previous.has(conversationKey)) return previous;
      const next = new Set(previous);
      next.delete(conversationKey);
      return next;
    });
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[conversationKey];
      return next;
    });
    setAttachmentDrafts((previous) => {
      if (!(conversationKey in previous)) return previous;
      const next = { ...previous };
      delete next[conversationKey];
      return next;
    });

    const remaining = conversations.filter(
      (conversation) => conversation.key !== conversationKey,
    );
    removeConversation(conversationKey);

    if (conversationKey !== activeConversationKey) return;
    if (remaining.length > 0) {
      setActiveConversationKey(remaining[0].key);
      return;
    }

    // 会话清空后新建：先落服务端，失败回落本地内存会话。
    void (async () => {
      try {
        const record = await createConversationRecord(undefined, chatModel);
        addConversation({ key: record.id, label: record.title, group: '今天' });
        setActiveConversationKey(record.id);
      } catch {
        const conversation = createConversation();
        addConversation(conversation);
        setActiveConversationKey(conversation.key);
      }
    })();
  };

  const handleDownload = async (content: string) => {
    try {
      await downloadMarkdownAsWord(content);
      messageApi.success('文档下载成功');
    } catch {
      messageApi.error('文档下载失败，请稍后重试');
    }
  };

  const bubbleItems = useMemo<BubbleItemType[]>(() => {
    const requestStatuses = new Map(
      messages.map((info) => [info.id, info.status]),
    );
    return visibleMessages.map((msg) => {
      const isAI = msg.message.role === 'assistant';
      // 用户气泡同样传入完整消息对象，便于渲染随消息发送的附件卡片。
      const content = isAI
        ? { ...msg.message, requestStatus: requestStatuses.get(msg.id) }
        : msg.message;
      // Reasoning and tool events arrive before answer text and must be
      // rendered immediately instead of being masked by Bubble's loader.
      const waitingForContent =
        isAI &&
        !msg.message.content.trim() &&
        msg.message.activities.length === 0 &&
        !msg.message.questionBankPending &&
        !msg.message.questionBanks?.length &&
        !msg.message.questionBankErrors?.length &&
        (msg.status === 'loading' || msg.status === 'updating');
      return {
        key: msg.id,
        role: isAI ? 'ai' : 'user',
        content,
        loading: waitingForContent,
        streaming: isAI && msg.status === 'updating',
        status: msg.status,
      };
    });
  }, [visibleMessages, messages]);

  const hasMessages = messages.length > 0;
  // 欢迎区只参与布局，不作为 AI 消息传入 Bubble.List 或模型请求。
  const hasChatContent = hasMessages || Boolean(assistant.welcomeContent);

  useEffect(() => {
    if (!hasMessages || view !== 'chat') return;
    let observer: ResizeObserver | undefined;
    // Bubble.List publishes its scroll element after its own first render.
    const frame = requestAnimationFrame(() => {
      const list = bubbleListRef.current;
      const scroll = list?.scrollBoxNativeElement;
      if (!list || !scroll) return;
      // Center columns in main, including the reserved scrollbar gutter.
      const syncWidth = () => {
        list.nativeElement.style.setProperty(
          '--hermes-scrollbar-width',
          `${scroll.offsetWidth - scroll.clientWidth}px`,
        );
      };
      syncWidth();
      observer = new ResizeObserver(syncWidth);
      observer.observe(scroll);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [hasMessages, view]);

  const updateApproval = (activity: ApprovalActivity) => {
    const target = messages.find((info) =>
      info.message.activities.some(
        (item) => item.type === 'approval' && item.key === activity.key,
      ),
    );
    if (!target) return;
    setMessage(target.id, ({ message: current }) => ({
      message: {
        ...current,
        activities: current.activities.map((item) =>
          item.type === 'approval' && item.key === activity.key
            ? activity
            : item,
        ),
      },
    }));
  };

  const conversationList = (
    <>
      <Conversations
        items={[]}
        className={styles.conversationActions}
        creation={{
          onClick: newChat,
          label: '新建对话',
          // 组卷表单或快捷助手会话下当前不在普通新对话：灰化入口按钮。
          className:
            view === 'paper' || assistant.activePreset
              ? styles.paperActionInactive
              : undefined,
        }}
      />
      <Conversations
        items={[]}
        className={styles.conversationActions}
        creation={{
          onClick: () => {
            entryNavigation.cancel();
            paperRequest.cancel();
            questionWorkspace.close();
            setView('paper');
          },
          label: '智能组卷',
          icon: <FileTextOutlined />,
          className: view === 'paper' ? undefined : styles.paperActionInactive,
        }}
      />
      {/* 快捷助手入口：由 presets 驱动，新增助手只需在 assistant/presets.ts 追加配置。 */}
      {ASSISTANT_PRESETS.map((preset) => (
        <Conversations
          key={preset.key}
          items={[]}
          className={styles.conversationActions}
          creation={{
            onClick: () => {
              // 空会话复用；已有作文对话时新建，异步结果服从最后一次入口选择。
              paperRequest.cancel();
              questionWorkspace.close();
              setView('chat');
              void entryNavigation.run(`assistant:${preset.key}`, (isCurrent) =>
                assistant.open(preset, isCurrent),
              );
            },
            label: preset.title,
            icon: preset.icon,
            className:
              view !== 'paper' && assistant.isPresetActive(preset)
                ? undefined
                : styles.paperActionInactive,
          }}
        />
      ))}
      <Conversations
        items={conversations}
        // 会话列表独立滚动区：数据多时在列表内部滚动，入口按钮保持固定。
        className={styles.conversationList}
        // 滚动条自动显隐：滚动时显示，停止后隐藏。
        onScroll={handleListScroll}
        data-scrolling={listScrolling ? 'true' : undefined}
        // 会话项始终保持当前会话选中（组卷视图下也保留，仅灰化上方入口按钮）。
        activeKey={activeConversationKey}
        onActiveChange={(key) => {
          entryNavigation.cancel();
          paperRequest.cancel();
          activateConversation(key);
          setView('chat');
        }}
        groupable
        menu={(conversation) => ({
          items: [
            { key: 'rename', label: '重命名' },
            { key: 'delete', label: '删除', danger: true },
          ],
          onClick: ({ key }) => {
            if (key === 'delete') deleteConversation(conversation.key);
            if (key === 'rename') {
              setRenameTarget(conversation.key);
              setRenameValue(
                typeof conversation.label === 'string'
                  ? conversation.label
                  : '',
              );
            }
          },
          // 官方 menu.trigger API：后台流式中的会话在三点左侧附加 loading。
          trigger: (info, { originNode }) =>
            backgroundStreamingKeys.has(info.key) ? (
              <span className={styles.conversationStreamingBadge}>
                <LoadingOutlined spin />
                {originNode}
              </span>
            ) : (
              originNode
            ),
        })}
      />
      <Modal
        title="重命名会话"
        open={renameTarget !== null}
        onOk={() => {
          const title = renameValue.trim();
          const target = renameTarget;
          if (!target || !title) return;
          void (async () => {
            try {
              await renameConversation(target, title);
              // x-sdk setConversation 为 Object.assign 部分更新。
              setConversation(target, { key: target, label: title });
              setRenameTarget(null);
            } catch {
              messageApi.error('重命名失败，请稍后重试');
            }
          })();
        }}
        onCancel={() => setRenameTarget(null)}
        okButtonProps={{ disabled: !renameValue.trim() }}
      >
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          maxLength={50}
          placeholder="输入新的会话名称"
        />
      </Modal>
    </>
  );

  return (
    <XProvider theme={chatTheme}>
      <HermesLayout
        conversations={conversationList}
        workbenchOpen={questionWorkspace.state.open}
        onCloseWorkspace={questionWorkspace.close}
      >
        <QuestionWorkspace
          open={questionWorkspace.state.open}
          onClose={questionWorkspace.close}
          title={
            questionWorkspace.entry?.title ||
            questionWorkspace.state.loading?.name.replace(/\.json$/i, '') ||
            questionWorkspace.state.retryCard?.name.replace(/\.json$/i, '') ||
            '题库'
          }
          titleKey={questionWorkspace.entry?.key}
          onSaveTitle={
            questionWorkspace.entry
              ? (title) => questionWorkspace.patchEntry({ title })
              : undefined
          }
          panel={
            <QuestionBankPanel
              entry={questionWorkspace.entry}
              loading={Boolean(questionWorkspace.state.loading)}
              error={questionWorkspace.state.error}
              onRetry={() => {
                void questionWorkspace.retry();
              }}
              onChange={questionWorkspace.patchEntry}
            />
          }
        >
          <Card
            variant="borderless"
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            styles={{
              body: {
                flex: 1,
                minHeight: 0,
                padding: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              },
            }}
          >
            {contextHolder}
            {/* 窥视入口提升到视图分支之外：组卷表单视图收起侧栏后同样
                提供悬浮窥视入口（fixed 定位，不参与表单/聊天布局）。 */}
            <NavExpandBar workbenchOpen={questionWorkspace.state.open} />
            {view === 'paper' ? (
              <PaperForm
                value={paperConfig}
                onChange={setPaperConfig}
                onSubmit={submitPaper}
                busy={
                  busy ||
                  paperRequest.pending ||
                  entryNavigation.pendingKey === 'paper'
                }
              />
            ) : (
              <ChatContext.Provider
                value={{
                  isRequesting: busy,
                  onReload: (id) => {
                    if (busy) return;
                    onReload(id, buildRetryParams(messages, id));
                  },
                  onDownload: (content) => void handleDownload(content),
                  onApprovalUpdate: updateApproval,
                  onOpenQuestionBank: (card) => {
                    void questionWorkspace.openBank(card);
                  },
                  onSelectExample: assistant.selectPrompt,
                  onUsePrompt: (content) => {
                    setDrafts((previous) => ({
                      ...previous,
                      [activeConversationKey]: content,
                    }));
                    senderRef.current?.focus();
                  },
                }}
              >
                <div className={styles.layout}>
                  <div className={styles.main}>
                    {historyLoading && (
                      <div
                        className={styles.welcomeTitle}
                        style={{ display: 'flex', justifyContent: 'center' }}
                      >
                        <Spin />
                      </div>
                    )}
                    {history.status === 'error' && (
                      <div className={styles.welcomeTitle} role="alert">
                        历史消息加载失败，请刷新页面重试
                      </div>
                    )}
                    {historyReady && assistant.welcomeContent && (
                      <div className={styles.assistantWelcome}>
                        <AssistantBubbleContent
                          content={{
                            role: 'assistant',
                            content: assistant.welcomeContent,
                            activities: [],
                          }}
                          status="local"
                        />
                      </div>
                    )}
                    {historyReady && hasMessages && (
                      <div className={styles.messages}>
                        <Bubble.List
                          ref={bubbleListRef}
                          items={bubbleItems}
                          role={roleConfig}
                          className={styles.messageList}
                          autoScroll
                          styles={bubbleListStyles}
                          onScroll={(event) => {
                            // Bubble.List autoScroll uses a reversed flex scroller:
                            // visual bottom is 0 and scrolling upwards is negative.
                            setAwayFromBottom(
                              Math.abs(event.currentTarget.scrollTop) > 80,
                            );
                          }}
                        />
                        {awayFromBottom && (
                          <button
                            type="button"
                            className={styles.returnToBottom}
                            aria-label="回到底部"
                            onClick={() => {
                              bubbleListRef.current?.scrollTo({
                                top: 'bottom',
                              });
                              setAwayFromBottom(false);
                            }}
                          >
                            <ArrowDownOutlined />
                          </button>
                        )}
                      </div>
                    )}

                    <div
                      className={
                        hasChatContent || !historyReady
                          ? styles.footer
                          : styles.footerCenter
                      }
                    >
                      {historyReady && !hasChatContent && (
                        <div className={styles.welcomeTitle}>
                          {/* key 随模型变化：切换时欢迎语从头重打 */}
                          <TypewriterTitle
                            key={chatModel}
                            text={WELCOME_TEXTS[chatModel]}
                          />
                        </div>
                      )}
                      {/* 快捷助手指令行：点击把插槽模板填入输入框（不发送）。 */}
                      {assistant.activePreset && !attachmentsOpen && (
                        <AssistantPrompts
                          preset={assistant.activePreset}
                          onSelect={assistant.selectPrompt}
                        />
                      )}
                      <Sender
                        ref={senderRef}
                        disabled={!historyReady}
                        header={
                          <ChatAttachments
                            open={attachmentsOpen}
                            onOpenChange={setAttachmentsOpen}
                            items={currentAttachments}
                            imageOnly={chatModel === 'deepseek'}
                            onItemsChange={(updater) =>
                              updateAttachments(activeConversationKey, updater)
                            }
                            getDropContainer={() =>
                              senderRef.current?.nativeElement
                            }
                          />
                        }
                        // 插槽模式由 SlotTextArea 自管内容，不能同时传受控 value。
                        {...(assistant.slotConfig
                          ? { slotConfig: assistant.slotConfig }
                          : {
                              value: inputValue,
                              onChange: (value: string) =>
                                setDrafts((previous) => ({
                                  ...previous,
                                  [activeConversationKey]: value,
                                })),
                            })}
                        loading={busy}
                        onSubmit={(value) => {
                          sendMessage(value);
                          if (assistant.slotConfig) {
                            assistant.resetSlots();
                            senderRef.current?.clear?.();
                          }
                        }}
                        onCancel={() => {
                          // 后端权威：先请求终止后端采集任务（已生成部分落库为
                          // aborted），再中止本地流；无后台任务时该调用静默无害。
                          void abortConversationRecord(activeConversationKey);
                          if (isRequesting) abort();
                          flush();
                        }}
                        placeholder="输入消息，按 Enter 发送，Shift + Enter 换行..."
                        autoSize={{ minRows: 1, maxRows: 12 }}
                        className={styles.composer}
                        suffix={false}
                        footer={(actions) => (
                          <div className={styles.composerToolbar}>
                            <Badge
                              dot={
                                currentAttachments.length > 0 &&
                                !attachmentsOpen
                              }
                            >
                              <Button
                                type="text"
                                onClick={() =>
                                  setAttachmentsOpen(!attachmentsOpen)
                                }
                                icon={<PaperClipOutlined />}
                                aria-label="附件"
                              />
                            </Badge>
                            {/* 模型选择紧邻发送按钮（输入框右下角），向上弹出。 */}
                            <div className={styles.composerToolbarRight}>
                              <Dropdown
                                menu={{
                                  selectable: true,
                                  selectedKeys: [chatModel],
                                  items: (
                                    Object.keys(
                                      CHAT_MODEL_LABELS,
                                    ) as ChatModel[]
                                  ).map((key) => ({
                                    key,
                                    label: CHAT_MODEL_LABELS[key],
                                  })),
                                  onClick: ({ key }) =>
                                    switchChatModel(key as ChatModel),
                                }}
                                trigger={['click']}
                                placement="topLeft"
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  aria-label="选择对话模型"
                                >
                                  {CHAT_MODEL_LABELS[chatModel]}
                                </Button>
                              </Dropdown>
                              {actions}
                            </div>
                          </div>
                        )}
                      />
                    </div>
                  </div>
                </div>
              </ChatContext.Provider>
            )}
          </Card>
        </QuestionWorkspace>
      </HermesLayout>
    </XProvider>
  );
};

export default HermesPage;
