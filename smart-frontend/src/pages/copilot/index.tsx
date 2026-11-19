import {
  AntDesignOutlined,
  CloseOutlined,
  CommentOutlined,
  DownloadOutlined,
  FileTextOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import type { BubbleListProps } from '@ant-design/x';
import {
  Actions,
  Bubble,
  Conversations,
  Prompts,
  Sender,
  Think,
  Welcome,
} from '@ant-design/x';
import type { BubbleListRef } from '@ant-design/x/es/bubble';
import XMarkdown, { type ComponentProps } from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import type {
  DefaultMessageInfo,
  SSEFields,
  XModelMessage,
} from '@ant-design/x-sdk';
import {
  DeepSeekChatProvider,
  useXChat,
  useXConversations,
  type XModelParams,
  type XModelResponse,
  XRequest,
} from '@ant-design/x-sdk';
import { useParams } from '@umijs/max';
import type { MenuProps } from 'antd';
import {
  Alert,
  Button,
  Divider,
  Dropdown,
  Flex,
  message,
  Popover,
  Space,
  Spin,
  Splitter,
  Tag,
} from 'antd';
import { createStyles } from 'antd-style';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getChatErrorMessage, getResponseError } from '@/pages/hermes/service';
import {
  type ChatModelItem,
  deleteChatSession,
  listChatMessages,
  listChatModels,
  listChatSessions,
} from '@/services/chat';
import { ossMdTextToDocxApiOssConvertMdTextToDocxPost } from '@/services/fast-api-manage/osSwenjianshangchuan';
import { getDownloadUrl } from '@/services/fast-api-manage/wenjianguanli';

const STREAMING_ACTIVE = { hasNextChunk: true, enableAnimation: true };
const STREAMING_IDLE = { hasNextChunk: false, enableAnimation: true };

/** 会话ID 用 UUID（后端 chat_id 唯一索引，'default' 这类固定值会跨用户冲突） */
const newChatId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const newDraftConversation = () => ({
  key: newChatId(),
  label: '💬 新对话',
  group: '今天',
  isDraft: true,
});

const formatContext = (tokens: number) =>
  tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : `${tokens}`;

/** 模型名缩写（模型选择按钮上显示，与 chat 页保持一致） */
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

const SwitchTextStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 400,
};

/** 深度思考图标（与 src/assets/icons/deep-think.svg 同源，currentColor 跟随开关文字颜色） */
const DeepThinkIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={size}
    height={size}
    aria-hidden="true"
  >
    <g transform="matrix(0.9728225469589233 0 0 0.9728225469589233 0.21741962432861328 0.21741962432861328)">
      <path
        fill="currentColor"
        d="M8,6.769999980926514 C8.678836822509766,6.769999980926514 9.229999542236328,7.321163177490234 9.229999542236328,8 C9.229999542236328,8.678836822509766 8.678836822509766,9.229999542236328 8,9.229999542236328 C7.321163177490234,9.229999542236328 6.769999980926514,8.678836822509766 6.769999980926514,8 C6.769999980926514,7.321163177490234 7.321163177490234,6.769999980926514 8,6.769999980926514z"
      />
    </g>
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.310430526733398,10.310430526733398 C7.105431079864502,13.51543140411377 3.4737708568573,15.077771186828613 2.197999954223633,13.802000045776367 C0.9222292304039001,12.526228904724121 2.485476493835449,8.89450740814209 5.690476417541504,5.689507484436035 C8.895476341247559,2.4845073223114014 12.526228904724121,0.9222292304039001 13.802000045776367,2.197999954223633 C15.077771186828613,3.4737708568573 13.51543140411377,7.105431079864502 10.310430526733398,10.310430526733398z" />
      <path d="M10.730999946594238,5.269000053405762 C13.935999870300293,8.473999977111816 15.3100004196167,12.293999671936035 13.802000045776367,13.802000045776367 C12.293999671936035,15.3100004196167 8.475000381469727,13.935999870300293 5.269999980926514,10.730999946594238 C2.065000057220459,7.526000022888184 0.6899999976158142,3.7060000896453857 2.197999954223633,2.197999954223633 C3.7060000896453857,0.6899999976158142 7.526000022888184,2.063999891281128 10.730999946594238,5.269000053405762z" />
    </g>
  </svg>
);

/** 文档问答预设问题（欢迎页一键提问） */
const DOC_PROMPTS = [
  { key: 'summary', description: '总结全文核心内容' },
  { key: 'points', description: '提取文档要点，分条列出' },
  { key: 'outline', description: '生成文档大纲与结构' },
  { key: 'risks', description: '找出文档中的问题与风险点' },
];

const useCopilotStyle = createStyles(({ token, css }) => {
  return {
    copilotChat: css`
      display: flex;
      flex-direction: column;
      background: ${token.colorBgContainer};
      color: ${token.colorText};
    `,
    chatHeader: css`
      height: 52px;
      box-sizing: border-box;
      border-bottom: 1px solid ${token.colorBorder};
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px 0 16px;
    `,
    headerTitle: css`
      font-weight: 600;
      font-size: 15px;
    `,
    headerButton: css`
      font-size: 18px;
    `,
    conversations: css`
      width: 300px;
      .ant-conversations-list {
        padding-inline-start: 0;
      }
    `,
    docBanner: css`
      padding: 8px 16px 0;
    `,
    chatList: css`
      flex: 1;
      overflow-y: auto;
      padding-inline: 16px;
      margin-block-start: ${token.margin}px;
      display: flex;
      flex-direction: column;
    `,
    chatWelcome: css`
      margin-inline: ${token.margin}px;
      padding: 12px 16px;
      border-radius: 12px;
      background: ${token.colorBgTextHover};
      margin-bottom: ${token.margin}px;
    `,
    chatPrompts: css`
      margin-inline: ${token.margin}px;
    `,
    chatSend: css`
      padding: ${token.padding}px;
    `,
    senderFooter: css`
      padding-top: 8px;
    `,
    previewLoading: css`
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 300px;
    `,
    previewEmpty: css`
      color: ${token.colorTextSecondary};
      text-align: center;
      padding: 40px 0;
    `,
  };
});

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
    <Think title={title} loading={loading}>
      {props.children}
    </Think>
  );
});

// SSE 直连后端完整路径（不走 proxy，避免 HPM 缓冲）。
// 开发环境按当前访问主机推导（localhost 与局域网 IP 手机真机均可直连 5000）；
// 生产构建取空串走同源（nginx 反代），换环境无需改代码（与 hermes 页惯例一致）。
const SSE_API_BASE =
  process.env.NODE_ENV === 'development'
    ? `${window.location.protocol}//${window.location.hostname}:5000`
    : '';
const CHAT_COMPLETIONS_URL = `${SSE_API_BASE}/api/chat/completions`;

/** 消息回答转 Word 下载（失败抛错由调用方提示） */
const downloadMessageAsDocx = async (content: string, docName: string) => {
  const baseName = docName.replace(/\.(md|markdown)$/i, '') || '文档';
  const result = await ossMdTextToDocxApiOssConvertMdTextToDocxPost({
    md_content: content,
    filename: baseName,
  });
  if (!result?.url) throw new Error('转换服务未返回下载地址');
  const response = await fetch(result.url);
  if (!response.ok) throw new Error('下载失败');
  const fileBlob = await response.blob();
  const blob = new Blob([fileBlob], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `${baseName}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
};

const Footer: React.FC<{
  id?: string;
  content: string;
  status?: string;
  docName: string;
}> = ({ id, content, status, docName }) => {
  const resultContent = content
    .split(/<\/think>/i)
    .pop()!
    .trim();
  const Items = [
    {
      key: 'copy',
      actionRender: <Actions.Copy text={resultContent} />,
    },
    {
      key: 'download',
      label: '下载 Word',
      icon: <DownloadOutlined />,
      onItemClick: async () => {
        const key = `docx-${id}`;
        try {
          message.loading({ content: '正在转换 Word...', key, duration: 0 });
          await downloadMessageAsDocx(resultContent, docName);
          message.success({ content: '已下载', key });
        } catch (error) {
          message.error({
            content: (error as Error)?.message || '下载失败',
            key,
          });
        }
      },
    },
  ];
  return status !== 'updating' && status !== 'loading' ? (
    <div style={{ display: 'flex' }}>{id && <Actions items={Items} />}</div>
  ) : null;
};

interface CopilotProps {
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  /** 文档 md 的 OSS 地址；为空表示未找到解析产物，聊天不注入文档 */
  mdUrl: string;
  docName: string;
  docLoading: boolean;
}

const Copilot = (props: CopilotProps) => {
  const { copilotOpen, setCopilotOpen, mdUrl, docName, docLoading } = props;
  const { styles } = useCopilotStyle();
  const docReady = Boolean(mdUrl);

  // ==================== State ====================
  // 初始为空，挂载后从后端拉取会话列表（持久化到 chat_sessions 表）
  const [initialDraft] = useState(() => newDraftConversation());
  const {
    conversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    getConversation,
    setConversation,
    setConversations: setConvList,
  } = useXConversations({
    defaultConversations: [initialDraft],
    defaultActiveConversationKey: initialDraft.key,
  });
  const [inputValue, setInputValue] = useState('');
  const [models, setModels] = useState<ChatModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [enableThinking, setEnableThinking] = useState(false);

  const listRef = useRef<BubbleListRef>(null);

  // ==================== 会话持久化 ====================
  // 切换会话时由 useXChat 按 conversationKey 拉取后端历史（含思考内容拼回 <think>）
  const loadDefaultMessages = useCallback(
    async (info: { conversationKey?: string }) => {
      const chatId = info?.conversationKey;
      if (!chatId) return [] as DefaultMessageInfo<XModelMessage>[];
      try {
        const res = await listChatMessages(chatId);
        return (res?.data ?? []).map((record) => ({
          id: record.id,
          status: 'success' as const,
          message: {
            role: record.role,
            content: record.reasoningContent
              ? `<think>\n\n${record.reasoningContent}\n\n</think>\n\n${record.content}`
              : record.content,
          },
        })) as DefaultMessageInfo<XModelMessage>[];
      } catch {
        return [] as DefaultMessageInfo<XModelMessage>[];
      }
    },
    [],
  );

  // 拉取后端会话列表；首次加载时若无激活会话则取第一项或新建草稿
  const didInitSessions = React.useRef(false);
  const refreshSessions = useCallback(async () => {
    try {
      const res = await listChatSessions();
      if (res?.success) {
        const list = res.data ?? [];
        setConvList(list as any);
        if (!didInitSessions.current && list.length > 0) {
          didInitSessions.current = true;
          setActiveConversationKey(list[0].key);
        }
      }
    } catch {
      // 会话列表拉取失败不阻断聊天
    }
  }, [setConvList, setActiveConversationKey]);

  // 初始化：拉取会话列表与模型注册表
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await listChatModels();
        if (res?.success) {
          setModels(res.data ?? []);
          setSelectedModel((res as any).default ?? res.data?.[0]?.name ?? '');
        }
      } catch {
        // 模型列表失败时选择器置空
      }
    })();
  }, []);

  const currentModel = useMemo(
    () => models.find((m) => m.name === selectedModel),
    [models, selectedModel],
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

  // ==================== Runtime ====================
  // 单例 provider：XRequest 跨源直连后端需 credentials:'include' 携带登录 cookie，
  // 否则 /api/chat/completions 鉴权 401；onResponse 把非 2xx 转成友好错误文案。
  const provider = useMemo(
    () =>
      new DeepSeekChatProvider({
        request: XRequest<
          XModelParams,
          Partial<Record<SSEFields, XModelResponse>>
        >(CHAT_COMPLETIONS_URL, {
          manual: true,
          params: {
            stream: true,
          },
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          middlewares: {
            onResponse: async (response) => {
              if (!response.ok) {
                throw new Error(await getResponseError(response));
              }
              return response;
            },
          },
        }),
      }),
    [],
  );

  const { onRequest, messages, isRequesting, abort } = useXChat({
    provider,
    conversationKey: activeConversationKey,
    defaultMessages: loadDefaultMessages as any,
    requestPlaceholder: () => {
      return {
        content: '思考中...',
        role: 'assistant',
      };
    },
    requestFallback: (_, { error, messageInfo }) => {
      if (error.name === 'AbortError') {
        return {
          content: messageInfo?.message?.content || '请求已中止',
          role: 'assistant',
        };
      }
      return {
        content: getChatErrorMessage(error),
        role: 'assistant',
      };
    },
  });

  // 请求结束后刷新会话列表（新会话已在后端自动建档）
  const wasRequesting = React.useRef(false);
  useEffect(() => {
    if (wasRequesting.current && !isRequesting) {
      refreshSessions();
    }
    wasRequesting.current = isRequesting;
  }, [isRequesting, refreshSessions]);

  // ==================== Event ====================
  const handleUserSubmit = (val: string) => {
    if (!val) return;
    if (!selectedModel) {
      message.warning('模型列表加载中，请稍候');
      return;
    }
    onRequest({
      messages: [{ role: 'user', content: val }],
      md_urls: mdUrl ? [mdUrl] : [],
      // 后端 /api/chat/completions 需要的会话与模型参数
      chatId: activeConversationKey,
      model: selectedModel,
      enableThinking,
    });
    listRef.current?.scrollTo({ top: 'bottom' });

    // session title：新会话首条消息后把标题更新为消息摘要（后端建档同步使用）
    const conversation = getConversation(activeConversationKey);
    if (conversation && (conversation.label ?? '').includes('新对话')) {
      setConversation(activeConversationKey, {
        key: activeConversationKey,
        label: val?.slice(0, 20),
      });
    }
  };

  // ==================== Nodes ====================
  const chatHeader = (
    <div className={styles.chatHeader}>
      <div className={styles.headerTitle}>✨ AI 助手</div>
      <Space size={0}>
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={() => {
            if (messages?.length) {
              const draft = newDraftConversation();
              addConversation(draft);
              setActiveConversationKey(draft.key);
            } else {
              message.error('当前已经是新会话');
            }
          }}
          className={styles.headerButton}
        />
        <Popover
          placement="bottom"
          styles={{ container: { padding: 0, maxHeight: 600 } }}
          content={
            <Conversations
              items={conversations?.map((i) =>
                i.key === activeConversationKey
                  ? { ...i, label: `[current] ${i.label}` }
                  : i,
              )}
              activeKey={activeConversationKey}
              groupable
              onActiveChange={setActiveConversationKey}
              styles={{ item: { padding: '0 8px' } }}
              className={styles.conversations}
              menu={(conversation) => ({
                items: [
                  {
                    label: '删除',
                    key: 'delete',
                    danger: true,
                    onClick: () => {
                      // 后端级联删除消息；draft 会话无记录，接口 404 静默
                      deleteChatSession(conversation.key).catch(() => {});
                      const remaining = conversations.filter(
                        (c) => c.key !== conversation.key,
                      );
                      setConvList(remaining as any);
                      if (conversation.key === activeConversationKey) {
                        if (remaining.length > 0) {
                          setActiveConversationKey(remaining[0].key);
                        } else {
                          const draft = newDraftConversation();
                          setConvList([draft as any]);
                          setActiveConversationKey(draft.key);
                        }
                      }
                    },
                  },
                ],
              })}
            />
          }
        >
          <Button
            type="text"
            icon={<CommentOutlined />}
            className={styles.headerButton}
          />
        </Popover>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={() => setCopilotOpen(false)}
          className={styles.headerButton}
        />
      </Space>
    </div>
  );

  // 文档引用横幅：有解析产物时显示引用徽标，否则警示聊天不基于文档
  const docBanner = docReady ? (
    <div className={styles.docBanner}>
      <Tag icon={<FileTextOutlined />} color="blue">
        已引用文档：{docName}
      </Tag>
    </div>
  ) : docLoading ? null : (
    <div className={styles.docBanner}>
      <Alert
        type="warning"
        showIcon
        banner
        message="未检测到该文档的解析结果，AI 将不基于文档内容回答"
      />
    </div>
  );

  const role: BubbleListProps['role'] = useMemo(
    () => ({
      assistant: {
        placement: 'start',
        footer: (content, { status, key }) => (
          <Footer
            content={content}
            status={status}
            id={key as string}
            docName={docName}
          />
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
              config={{ extensions: Latex() }}
              paragraphTag="div"
              content={content}
              components={{
                think: ThinkComponent,
              }}
            />
          );
        },
      },
      user: { placement: 'end' },
    }),
    [docName],
  );

  const chatList = (
    <div className={styles.chatList}>
      {messages?.length ? (
        /** 消息列表 */
        <Bubble.List
          ref={listRef}
          items={messages?.map((i) => ({
            ...i.message,
            key: i.id,
            status: i.status,
            loading: i.status === 'loading',
          }))}
          role={role}
        />
      ) : (
        /** 没有消息时的 welcome + 文档预设问题 */
        <>
          <Welcome
            variant="borderless"
            title={`你好，我是徽文 AI 助手`}
            description={
              docReady
                ? `已加载《${docName}》，可以针对文档内容提问~~`
                : `有什么可以帮你~~`
            }
            className={styles.chatWelcome}
          />
          {docReady && (
            <Prompts
              vertical
              title="试试这样问："
              items={DOC_PROMPTS}
              onItemClick={(info) =>
                handleUserSubmit(info?.data?.description as string)
              }
              className={styles.chatPrompts}
            />
          )}
        </>
      )}
    </div>
  );

  const chatSender = (
    <Flex vertical gap={12} className={styles.chatSend}>
      {/** 输入框：多行自适应，footer 左侧功能开关、右侧发送按钮 */}
      <Sender
        loading={isRequesting}
        value={inputValue}
        onChange={setInputValue}
        onSubmit={() => {
          handleUserSubmit(inputValue);
          setInputValue('');
        }}
        onCancel={() => {
          abort();
        }}
        placeholder="针对文档提问，Enter 发送，Shift+Enter 换行"
        autoSize={{ minRows: 3, maxRows: 6 }}
        suffix={false}
        footer={(actionNode) => (
          <Flex
            justify="space-between"
            align="center"
            className={styles.senderFooter}
          >
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
                <Sender.Switch value={false} icon={<AntDesignOutlined />}>
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
                  icon={<DeepThinkIcon />}
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
    <div
      className={styles.copilotChat}
      style={{ width: '100%', height: '100%' }}
    >
      {/** 对话区 - header */}
      {chatHeader}

      {/** 对话区 - 文档引用横幅 */}
      {docBanner}

      {/** 对话区 - 消息列表 */}
      {chatList}

      {/** 对话区 - 输入框 */}
      {chatSender}
    </div>
  );
};

const useWorkareaStyle = createStyles(({ token, css }) => {
  return {
    headerButton: css`
      background-image: linear-gradient(78deg, #8054f2 7%, #3895da 95%);
      border-radius: 12px;
      height: 24px;
      width: 93px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.3s;
      &:hover {
        opacity: 0.8;
      }
    `,
  };
});

const CopilotDemo = () => {
  const { styles: workareaStyles } = useWorkareaStyle();
  const { styles: previewStyles } = useCopilotStyle();

  // ==================== State =================
  const [copilotOpen, setCopilotOpen] = useState(true);

  // ==================== markdown content =================
  // 文档加载状态机：loading（请求中）/ error（失败可重试）/ mdValue（正文）
  const [mdUrl, setMdUrl] = useState('');
  const [mdValue, setMdValue] = useState('');
  const [mdLoading, setMdLoading] = useState(false);
  const [mdError, setMdError] = useState('');
  const [fileName, setFileName] = useState('未知文档');
  const params = useParams<{ id: string }>();
  const fileId = Number(params.id);
  const fileIdValid = Boolean(params.id) && Number.isFinite(fileId);
  const loadAbortRef = useRef<AbortController | null>(null);

  // 加载文档：下载链接（拿 oss_md_url 与文件名）→ 拉取 md 正文
  const loadDocument = useCallback(async () => {
    if (!fileIdValid) {
      setMdError('无效的文档 ID');
      return;
    }
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setMdError('');
    setMdValue('');
    setMdUrl('');
    setMdLoading(true);
    try {
      const result = await getDownloadUrl({ fileId });
      setFileName(result?.original_name || '未知文档');
      const url = result?.oss_md_url as string | undefined;
      if (!url) {
        setMdError('该文档暂无 Markdown 解析结果，可先在文档管理完成解析');
        return;
      }
      setMdUrl(url);
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`请求失败，状态码: ${res.status}`);
      const text = await res.text();
      setMdValue(text);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMdError('读取文档内容失败，请重试');
      }
    } finally {
      if (!controller.signal.aborted) setMdLoading(false);
    }
  }, [fileId, fileIdValid]);

  useEffect(() => {
    void loadDocument();
    return () => {
      loadAbortRef.current?.abort();
    };
  }, [loadDocument]);

  // ==================== Render =================
  const previewBody = mdError ? (
    <Alert
      type="error"
      showIcon
      message={mdError}
      action={
        <Button size="small" onClick={() => void loadDocument()}>
          重试
        </Button>
      }
    />
  ) : mdLoading ? (
    <div className={previewStyles.previewLoading}>
      <Spin tip="正在加载文档...">
        <div style={{ minHeight: 120 }} />
      </Spin>
    </div>
  ) : mdValue ? (
    <XMarkdown config={{ extensions: Latex() }} content={mdValue} />
  ) : (
    <div className={previewStyles.previewEmpty}>
      该文档暂无 Markdown 解析结果
    </div>
  );

  return (
    <PageContainer
      title={false}
      // 本页无页头（title=false），children 直接占满整屏；
      // 原先 calc(100vh - 120px) 按有页头假设硬编码，导致底部空 120px 不铺满
      childrenContentStyle={{
        paddingBlock: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Splitter style={{ height: '100%' }}>
        <Splitter.Panel
          defaultSize="70%"
          min="50%"
          max={copilotOpen ? '70%' : '100%'}
        >
          <ProCard
            title={fileName}
            variant="outlined"
            type="inner"
            style={{ height: '100%' }}
            // body 伸展撑满卡片并内部滚动（默认 flex 0 1 auto 不伸展）
            styles={{ body: { flex: 1, minHeight: 0, overflow: 'auto' } }}
            extra={
              !copilotOpen && (
                <div
                  onClick={() => setCopilotOpen(true)}
                  className={workareaStyles.headerButton}
                >
                  ✨ AI 助手
                </div>
              )
            }
          >
            {previewBody}
          </ProCard>
        </Splitter.Panel>
        {copilotOpen && (
          <Splitter.Panel>
            <Copilot
              copilotOpen={copilotOpen}
              setCopilotOpen={setCopilotOpen}
              mdUrl={mdUrl}
              docName={fileName}
              docLoading={mdLoading}
            />
          </Splitter.Panel>
        )}
      </Splitter>
    </PageContainer>
  );
};

export default CopilotDemo;
