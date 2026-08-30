import {
  AppstoreAddOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  CommentOutlined,
  CopyOutlined,
  DislikeOutlined,
  DownloadOutlined,
  LikeOutlined,
  OpenAIFilled,
  PaperClipOutlined,
  PlusOutlined,
  ProductOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import {
  PageContainer,
  ProCard,
  ProFormGroup,
  ProFormSwitch,
} from '@ant-design/pro-components';
import type {
  AttachmentsProps,
  BubbleListProps,
  ConversationItemType,
} from '@ant-design/x';
import {
  Actions,
  Attachments,
  Bubble,
  Conversations,
  Prompts,
  Sender,
  Suggestion,
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
import {
  Button,
  Flex,
  type GetProp,
  type GetRef,
  Image,
  message,
  Popover,
  Space,
  Splitter,
} from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from '@umijs/max';
import {
  deleteChatSession,
  listChatMessages,
  listChatSessions,
} from '@/services/chat';
import { ossMdTextToDocxApiOssConvertMdTextToDocxPost } from '@/services/fast-api-manage/osSwenjianshangchuan';
import { getDownloadUrl } from '@/services/fast-api-manage/wenjianguanli';
import locale from './_utils/local';

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

const DEFAULT_CONVERSATIONS_ITEMS: ConversationItemType[] = [
  newDraftConversation(),
];

// 使用国际化配置生成历史消息
const generateHistoryMessages = (
  locale: any,
): Record<string, DefaultMessageInfo<XModelMessage>[]> => {
  const { historyMessages } = locale;

  return {
    '5': [
      {
        message: { role: 'user', content: historyMessages.newSession.user },
        status: 'success',
      },
      {
        message: {
          role: 'assistant',
          content: historyMessages.newSession.assistant,
        },
        status: 'success',
      },
    ],
    '4': [
      {
        message: {
          role: 'user',
          content: historyMessages.whatHasAntDesignXUpgraded.user,
        },
        status: 'success',
      },
      {
        message: {
          role: 'assistant',
          content: historyMessages.whatHasAntDesignXUpgraded.assistant,
        },
        status: 'success',
      },
    ],
    '3': [
      {
        message: {
          role: 'user',
          content: historyMessages.newAgiHybridInterface.user,
        },
        status: 'success',
      },
      {
        message: {
          role: 'assistant',
          content: historyMessages.newAgiHybridInterface.assistant,
        },
        status: 'success',
      },
    ],
    '2': [
      {
        message: {
          role: 'user',
          content: historyMessages.howToQuicklyInstallAndImportComponents.user,
        },
        status: 'success',
      },
      {
        message: {
          role: 'assistant',
          content:
            historyMessages.howToQuicklyInstallAndImportComponents.assistant,
        },
        status: 'success',
      },
    ],
    '1': [
      {
        message: {
          role: 'user',
          content: historyMessages.whatIsAntDesignX.user,
        },
        status: 'success',
      },
      {
        message: {
          role: 'assistant',
          content: historyMessages.whatIsAntDesignX.assistant,
        },
        status: 'success',
      },
    ],
  };
};

const historyMessageFactory = (
  conversationKey: string,
): DefaultMessageInfo<XModelMessage>[] => {
  const historyMessages = generateHistoryMessages(locale);
  return historyMessages[conversationKey] || [];
};

const MOCK_SUGGESTIONS = [
  { label: locale.writeAReport, value: 'report' },
  { label: locale.drawAPicture, value: 'draw' },
  {
    label: locale.checkSomeKnowledge,
    value: 'knowledge',
    icon: <OpenAIFilled />,
    children: [
      { label: locale.aboutReact, value: 'react' },
      { label: locale.aboutAntDesign, value: 'antd' },
    ],
  },
];
const MOCK_QUESTIONS = [
  locale.whatHasAntDesignXUpgraded,
  locale.whatComponentsAreInAntDesignX,
  locale.howToQuicklyInstallAndImportComponents,
];

const useCopilotStyle = createStyles(({ token, css }) => {
  return {
    copilotChat: css`
      display: flex;
      flex-direction: column;
      background: ${token.colorBgContainer};
      color: ${token.colorText};
    `,
    // chatHeader 样式
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
    // chatList 样式
    chatList: css`
      flex:1;
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
    loadingMessage: css`
      background-image: linear-gradient(90deg, #ff6b23 0%, #af3cb8 31%, #53b6ff 89%);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: bottom;
    `,
    // chatSend 样式
    chatSend: css`
      padding: ${token.padding}px;
    `,
    speechButton: css`
      font-size: 18px;
      color: ${token.colorText} !important;
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

/**
 * 🔔 Please replace the BASE_URL, MODEL with your own values.
 */
const providerCaches = new Map<string, DeepSeekChatProvider>();
const providerFactory = (conversationKey: string) => {
  if (!providerCaches.get(conversationKey)) {
    providerCaches.set(
      conversationKey,
      new DeepSeekChatProvider({
        request: XRequest<
          XModelParams,
          Partial<Record<SSEFields, XModelResponse>>
        >(
          // 走相对路径，由 nginx/dev proxy 反代到后端；同源自动携带登录 Cookie
          '/api/chat/completions',
          {
            manual: true,
            params: {
              stream: true,
            },
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      }),
    );
  }
  return providerCaches.get(conversationKey);
};

interface CopilotProps {
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  mdValue: string;
  mdUrl: string;
}
const getMarkdownTOWord = async (content: string) => {
  const result = await ossMdTextToDocxApiOssConvertMdTextToDocxPost({
    md_content: content,
    filename: 'word 文档',
  });
  if (result.url) {
    const response = await fetch(result.url);
    if (!response.ok) throw new Error('下载失败');
    const fileBlob = await response.blob();
    const blob = new Blob([fileBlob], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'word 文档';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }
};
const Footer: React.FC<{
  id?: string;
  content: string;
  status?: string;
}> = ({ id, content, status }) => {
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
      label: '下载',
      icon: <DownloadOutlined />,
      onItemClick: () => {
        getMarkdownTOWord(resultContent);
      },
    },
  ];
  return status !== 'updating' && status !== 'loading' ? (
    <div style={{ display: 'flex' }}>{id && <Actions items={Items} />}</div>
  ) : null;
};

const role: BubbleListProps['role'] = {
  assistant: {
    placement: 'start',
    footer: (content, { status, key }) => (
      <Footer content={content} status={status} id={key as string} />
    ),
    // footer: (
    //   <div style={{ display: 'flex' }}>
    //     <Button type="text" size="small" icon={<ReloadOutlined />} />
    //     <Button type="text" size="small" icon={<CopyOutlined />} />
    //     <Button type="text" size="small" icon={<LikeOutlined />} />
    //     <Button type="text" size="small" icon={<DislikeOutlined />} />
    //   </div>
    // ),
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
};

const Copilot = (props: CopilotProps) => {
  const { copilotOpen, setCopilotOpen, mdValue, mdUrl } = props;
  const { styles } = useCopilotStyle();
  const attachmentsRef = useRef<GetRef<typeof Attachments>>(null);

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
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [files, setFiles] = useState<GetProp<AttachmentsProps, 'items'>>([]);

  const [inputValue, setInputValue] = useState('');

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

  // 初始化：拉取会话列表
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // ==================== Runtime ====================

  const { onRequest, messages, isRequesting, abort } = useXChat({
    provider: providerFactory(activeConversationKey), // every conversation has its own provider
    conversationKey: activeConversationKey,
    defaultMessages: loadDefaultMessages as any,
    requestPlaceholder: () => {
      return {
        content: locale.noData,
        role: 'assistant',
      };
    },
    requestFallback: (_, { error, errorInfo, messageInfo }) => {
      if (error.name === 'AbortError') {
        return {
          content: messageInfo?.message?.content || locale.requestAborted,
          role: 'assistant',
        };
      }
      return {
        content: errorInfo?.error?.message || locale.requestFailed,
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
    onRequest({
      messages: [{ role: 'user', content: val }],
      md_urls: mdUrl ? [mdUrl] : [],
      // 后端 /api/chat/completions 需要的会话与模型参数
      chatId: activeConversationKey,
      model: 'deepseek-v4-flash',
      enableThinking: true,
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

  const onPasteFile = (files: FileList) => {
    for (const file of files) {
      attachmentsRef.current?.upload(file);
    }
    setAttachmentsOpen(true);
  };

  // ==================== Nodes ====================
  const chatHeader = (
    <div className={styles.chatHeader}>
      <div className={styles.headerTitle}>✨ {locale.aiCopilot}</div>
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
              message.error(locale.itIsNowANewConversation);
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
        /** 没有消息时的 welcome */
        <>
          <Welcome
            variant="borderless"
            title={`你好，我是徽文 AI 助手`}
            description={`有什么可以帮你~~`}
            className={styles.chatWelcome}
          />

          {/* <Prompts
            vertical
            title={`我可以帮助：`}
            items={MOCK_QUESTIONS.map((i) => ({ key: i, description: i }))}
            onItemClick={(info) => handleUserSubmit(info?.data?.description as string)}
            styles={{
              title: { fontSize: 14 },
            }}
          /> */}
        </>
      )}
    </div>
  );
  const sendHeader = (
    <Sender.Header
      title={locale.uploadFile}
      styles={{ content: { padding: 0 } }}
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      forceRender
    >
      <Attachments
        ref={attachmentsRef}
        beforeUpload={() => false}
        items={files}
        onChange={({ fileList }) => setFiles(fileList)}
        placeholder={(type) =>
          type === 'drop'
            ? { title: locale.dropFileHere }
            : {
                icon: <CloudUploadOutlined />,
                title: locale.uploadFiles,
                description: locale.clickOrDragFilesToThisAreaToUpload,
              }
        }
      />
    </Sender.Header>
  );
  const chatSender = (
    <Flex vertical gap={12} className={styles.chatSend}>
      {/* <Flex gap={12} align="center">
        <Button
          icon={<ScheduleOutlined />}
          onClick={() => handleUserSubmit('What has Ant Design X upgraded?')}
        >
          {locale.upgrades}
        </Button>
        <Button
          icon={<ProductOutlined />}
          onClick={() => handleUserSubmit('What component assets are available in Ant Design X?')}
        >
          {locale.components}
        </Button>
        <Button icon={<AppstoreAddOutlined />}>{locale.more}</Button>
      </Flex> */}
      {/** 输入框 */}
      <Suggestion
        items={MOCK_SUGGESTIONS}
        onSelect={(itemVal) => setInputValue(`[${itemVal}]:`)}
      >
        {({ onTrigger, onKeyDown }) => (
          <Sender
            loading={isRequesting}
            value={inputValue}
            onChange={(v) => {
              onTrigger(v === '/');
              setInputValue(v);
            }}
            onSubmit={() => {
              handleUserSubmit(inputValue);
              setInputValue('');
            }}
            onCancel={() => {
              abort();
            }}
            allowSpeech
            placeholder={locale.askOrInputUseSkills}
            onKeyDown={onKeyDown}
            //header={sendHeader}
            // prefix={
            //   <Button
            //     type="text"
            //     icon={<PaperClipOutlined style={{ fontSize: 18 }} />}
            //     onClick={() => setAttachmentsOpen(!attachmentsOpen)}
            //   />
            // }
            onPasteFile={onPasteFile}
          />
        )}
      </Suggestion>
    </Flex>
  );

  return (
    // <div className={styles.copilotChat} style={{ width: copilotOpen ? 400 : 0 }}>
    <div
      className={styles.copilotChat}
      style={{ width: '100%', height: '100%' }}
    >
      {/** 对话区 - header */}
      {chatHeader}

      {/** 对话区 - 消息列表 */}
      {chatList}

      {/** 对话区 - 输入框 */}
      {chatSender}
    </div>
  );
};

const useWorkareaStyle = createStyles(({ token, css }) => {
  return {
    copilotWrapper: css`
      width: 100%;
      height: 100vh;
      display: flex;
    `,
    workarea: css`
      flex: 1;
      background: ${token.colorBgLayout};
      display: flex;
      flex-direction: column;
    `,
    workareaHeader: css`
      box-sizing: border-box;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 48px 0 28px;
      border-bottom: 1px solid ${token.colorBorder};
    `,
    headerTitle: css`
      font-weight: 600;
      font-size: 15px;
      color: ${token.colorText};
      display: flex;
      align-items: center;
      gap: 8px;
    `,
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
    workareaBody: css`
      flex: 1;
      padding: ${token.padding}px;
      background: ${token.colorBgContainer};
      border-radius: ${token.borderRadius}px;
      min-height: 0;
    `,
    bodyContent: css`
      overflow: auto;
      height: 100%;
      padding-right: 10px;
    `,
    bodyText: css`
      color: ${token.colorText};
      padding: 8px;
    `,
  };
});

const CopilotDemo = () => {
  const { styles: workareaStyles } = useWorkareaStyle();

  // ==================== State =================
  const [copilotOpen, setCopilotOpen] = useState(true);

  // ==================== markdown content =================
  // 1. 真正用于请求的 mdUrl 默认为空字符串。这样页面第一次加载时，就不会触发请求
  const [mdUrl, setMdUrl] = useState('');

  // 2. 输入框的初始值，可以预设一个你想要的默认地址，方便用户直接点击
  const [mdValue, setMdValue] = useState('');

  const [fileName, setFileName] = useState('文件名称');
  const params = useParams();

  useEffect(() => {
    console.log('params', params);

    if (!params.id) return;

    const fetchDownloadUrl = async () => {
      try {
        const result = await getDownloadUrl({ fileId: Number(params.id) });
        // console.log('下载链接:', result);
        setMdUrl(result?.oss_md_url);
      } catch (error) {
        console.error('获取下载链接失败:', error);
      } finally {
      }
    };

    fetchDownloadUrl();
  }, [params.id]);

  useEffect(() => {
    // 💡 关键拦截：第一次加载时 mdUrl 为空，直接 return，不执行后续的 fetch 逻辑
    if (!mdUrl) return;

    const controller = new AbortController();

    const fetchMarkdown = async () => {
      try {
        const res = await fetch(mdUrl, { signal: controller.signal });

        if (!res.ok) {
          throw new Error(`请求失败，状态码: ${res.status}`);
        }

        const text = await res.text();

        // 💡 核心改动：解析 URL 获取文件名
        let fileName = '未知文件';
        try {
          const urlObj = new URL(mdUrl);
          // 获取路径的最后一部分作为文件名
          fileName = urlObj.pathname.split('/').pop() || '文件名称';
        } catch (e) {
          // 如果输入的不是标准 URL，做个兜底字符串切割
          fileName = mdUrl.split('/').pop() || '文件名称';
        }
        fileName = decodeURIComponent(fileName);
        setFileName(fileName);
        setMdValue(text);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          console.log(`已取消对上一个 URL 的请求`);
        } else {
          console.error('❌ 读取 MD 文件出错:', (err as Error));
        }
      }
    };

    fetchMarkdown();

    return () => {
      controller.abort();
    };
  }, [mdUrl]); // 只有点击按钮改变了 mdUrl 的值，这里才会执行

  // ==================== Render =================
  return (
    <PageContainer
      title={false}
      childrenContentStyle={{
        paddingBlock: 0,
        height: 'calc(100vh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* <div className={workareaStyles.copilotWrapper}> */}
      {/** 左侧工作区 */}
      <Splitter>
        <Splitter.Panel
          defaultSize="70%"
          min="50%"
          max={copilotOpen ? '70%' : '100%'}
        >
          <ProCard
            title={fileName}
            variant="outlined"
            type="inner"
            extra={
              <>
                {!copilotOpen && (
                  <div
                    onClick={() => setCopilotOpen(true)}
                    className={workareaStyles.headerButton}
                  >
                    ✨ AI 助手
                  </div>
                )}
              </>
            }
          >
            <XMarkdown config={{ extensions: Latex() }} content={mdValue} />
          </ProCard>
        </Splitter.Panel>
        {copilotOpen && (
          <Splitter.Panel>
            <Copilot
              copilotOpen={copilotOpen}
              setCopilotOpen={setCopilotOpen}
              mdValue={mdValue}
              mdUrl={mdUrl}
            />
          </Splitter.Panel>
        )}
      </Splitter>
    </PageContainer>
  );
};

export default CopilotDemo;
