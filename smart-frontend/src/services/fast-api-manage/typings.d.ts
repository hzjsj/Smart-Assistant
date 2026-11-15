declare namespace API {
  type abortConversationApiConversationsConversationIdAbortPostParams = {
    conversation_id: string;
  };

  type AttachmentChatMessage = {
    /** Role */
    role: "system" | "user" | "assistant";
    /** Content */
    content: string;
  };

  type AttachmentChatRequest = {
    /** Model */
    model?: string | null;
    /** Messages */
    messages: AttachmentChatMessage[];
    /** Conversation Id */
    conversation_id?: string | null;
    /** Stream */
    stream?: boolean;
    /** Attachments */
    attachments?: ChatAttachment[];
  };

  type AttachmentUploaded = {
    /** Id */
    id: string;
    /** Name */
    name: string;
    /** Url */
    url: string;
    /** Size */
    size: number;
    /** Ext */
    ext: string;
    /** Created At */
    created_at: string;
  };

  type BailianAgentChatAttachment = {
    /** Url 附件公网地址（http/https） */
    url: string;
    /** Name 附件名称（用于判断图片/文件） */
    name?: string | null;
  };

  type BailianAgentChatMessage = {
    /** Role 消息角色：system / user / assistant */
    role: string;
    /** Content 消息内容 */
    content?: string;
  };

  type BailianAgentChatRequest = {
    /** Messages 对话消息列表（仅最后一条 user 作为 prompt） */
    messages: BailianAgentChatMessage[];
    /** Conversation Id 会话 ID（conversations 表）；用于落库与 session 映射 */
    conversation_id?: string | null;
    /** Attachments 随消息发送的附件 */
    attachments?: BailianAgentChatAttachment[];
    /** Enable Thinking 是否开启深度思考（思考过程以 reasoning_content 下发） */
    enable_thinking?: boolean;
    /** Incremental Output 是否增量输出（推荐 true） */
    incremental_output?: boolean;
    /** App Id 应用 ID，缺省取 BAILIAN_APP_ID */
    app_id?: string | null;
  };

  type BodyConvertWordFileApiShubanWordConversionsPost = {
    /** File */
    file: string;
    /** Template Id */
    template_id: string;
  };

  type BodyImportFilesApiShubanImportsPost = {
    /** Files */
    files: string[];
    /** Document Id */
    document_id?: string | null;
  };

  type BodyMineruUploadFileApiFilesMineruUploadPost = {
    /** File */
    file: string;
  };

  type BodyStorePaperPdfApiHermesV1Papers_paperId_exportsPdfPost = {
    /** File */
    file: string;
  };

  type BodyUploadApiQietiUploadPost = {
    /** File */
    file: string;
  };

  type BodyUploadAttachmentApiMineruAttachmentsPost = {
    /** File */
    file: string;
  };

  type BodyUploadFileApiFilesUploadPost = {
    /** File */
    file: string;
  };

  type BodyUploadFileApiShubanUploadPost = {
    /** File */
    file: string;
    /** Document Id */
    document_id?: string | null;
  };

  type CallbackRequest = {
    /** Checksum 签名校验值 */
    checksum: string;
    /** Content JSON 字符串 */
    content: string;
  };

  type chat_schemas_ChatCompletionRequest = {
    /** Chatid */
    chatId: string;
    /** Model */
    model: string;
    /** Messages OpenAI 格式消息数组，取最后一条 user */
    messages: Record<string, any>[];
    /** Enablethinking */
    enableThinking?: boolean;
    /** Regenerate 重新生成：先删除该会话最后一条 assistant 消息（不新增 user 消息） */
    regenerate?: boolean;
    /** Mdurls 参考文档 Markdown 的 URL 列表（如 OSS 地址），内容会注入对话上下文 */
    mdUrls?: string[];
  };

  type ChatAttachment = {
    /** Url 附件公网访问 URL */
    url: string;
    /** Name 附件显示名 */
    name?: string | null;
  };

  type ChatMessage = {
    /** Role */
    role: "system" | "user" | "assistant";
    /** Content */
    content: string;
  };

  type ChatMessageItem = {
    /** Id */
    id: number;
    /** Role */
    role: string;
    /** Content */
    content: string;
    /** Reasoningcontent */
    reasoningContent?: string | null;
    /** Model */
    model?: string | null;
    /** Timestamp 毫秒时间戳 */
    timestamp: number;
  };

  type ChatMessagesResponse = {
    /** Success */
    success?: boolean;
    /** Data */
    data: ChatMessageItem[];
  };

  type ChatSessionCreate = {
    /** Chat Id 会话ID（前端UUID） */
    chat_id: string;
    /** Title */
    title?: string;
    /** Model */
    model?: string;
  };

  type ChatSessionRename = {
    /** Title */
    title: string;
  };

  type ConversationCreate = {
    /** Title */
    title?: string | null;
    /** Model */
    model?: string | null;
  };

  type ConversationItem = {
    /** Id */
    id: string;
    /** Title */
    title: string;
    /** Model */
    model: string;
    /** Message Count */
    message_count: number;
    /** Created At */
    created_at: string;
    /** Updated At */
    updated_at: string;
  };

  type ConversationRename = {
    /** Title */
    title: string;
  };

  type CreateExportRequest = {
    /** Format */
    format: "docx" | "xlsx" | "json";
  };

  type CreatePaperRequest = {
    /** Bank Id */
    bank_id: string;
    /** Selected Ids */
    selected_ids: string[];
    /** Title */
    title: string;
    /** Include Answers */
    include_answers?: boolean;
  };

  type createUserLoginTicketApiUsersUserIdLoginTicketPostParams = {
    user_id: number;
  };

  type CreateUserRequest = {
    /** Username 用户名 */
    username: string;
    /** Password 密码 */
    password: string;
    /** Name 姓名，缺省时使用 username */
    name?: string | null;
    /** Email */
    email?: string | null;
    /** Phone */
    phone?: string | null;
    /** Title */
    title?: string | null;
    /** Group Name */
    group_name?: string | null;
    /** Access 权限角色：admin / user */
    access?: string;
  };

  type CutRequest = {
    /** Question Image Url 试卷/题目图片的公网 URL */
    question_image_url: string;
  };

  type DeepSeekChatAttachment = {
    /** Url 图片公网地址（http/https） */
    url: string;
    /** Name 附件名称 */
    name?: string | null;
  };

  type DeepSeekChatMessage = {
    /** Role 消息角色：system / user / assistant */
    role: string;
    /** Content 消息内容 */
    content?: string | Record<string, any>[];
  };

  type DeepSeekChatRequest = {
    /** Messages 对话消息列表 */
    messages: DeepSeekChatMessage[];
    /** Model 模型名，缺省取环境变量 DEEPSEEK_MODEL */
    model?: string | null;
    /** Conversation Id 会话 ID（conversations 表） */
    conversation_id?: string | null;
    /** Attachments 随消息发送的图片附件 */
    attachments?: DeepSeekChatAttachment[];
  };

  type deleteAttachmentApiMineruAttachmentsAttachmentIdDeleteParams = {
    attachment_id: string;
  };

  type deleteConversationApiConversationsConversationIdDeleteParams = {
    conversation_id: string;
  };

  type deleteSessionApiChatSessionsChatIdDeleteParams = {
    chat_id: string;
  };

  type DeleteUsersRequest = {
    /** Ids 要删除的用户ID列表 */
    ids: number[];
  };

  type DifyChatAttachment = {
    /** Url 附件公网地址（http/https） */
    url: string;
    /** Name 附件名称（用于判断 image/document） */
    name?: string | null;
  };

  type DifyChatMessage = {
    /** Role 消息角色：system / user / assistant */
    role: string;
    /** Content 消息内容 */
    content?: string;
  };

  type DifyChatRequest = {
    /** Messages 对话消息列表（仅最后一条 user 作为 query 上送） */
    messages: DifyChatMessage[];
    /** Conversation Id 会话 ID（conversations 表） */
    conversation_id?: string | null;
    /** Attachments 随消息发送的附件 */
    attachments?: DifyChatAttachment[];
    /** Inputs Dify 应用输入变量（缺省为空对象） */
    inputs?: Record<string, any>;
  };

  type downloadExportApiHermesV1ExportsExportIdDownloadGetParams = {
    export_id: string;
  };

  type downloadFileApiFilesDownloadSavedNameGetParams = {
    saved_name: string;
  };

  type downloadMdFileApiFilesDownloadMdMdSavedNameGetParams = {
    md_saved_name: string;
  };

  type downloadQuestionBankApiHermesV1QuestionBanksBankIdDownloadGetParams = {
    bank_id: string;
  };

  type downloadWordConversionApiShubanWordConversionsConversionIdDownloadGetParams =
    {
      conversion_id: string;
    };

  type downloadZipApiMineruProxyZipRecordIdGetParams = {
    record_id: number;
  };

  type ErrorResponse = {
    /** Errorcode 业务约定的错误码 */
    errorCode: string;
    /** Errormessage 业务上的错误信息 */
    errorMessage?: string | null;
    /** Success 业务上的请求是否成功 */
    success: boolean;
  };

  type ExamListResponse = {
    /** Total */
    total: number;
    /** Items */
    items: ExamResponse[];
  };

  type ExamResponse = {
    /** Id */
    id: number;
    /** Title */
    title: string;
    /** Subject */
    subject: string;
    /** Grade */
    grade: string;
    /** Exam Type */
    exam_type: string;
    /** Knowledge Point */
    knowledge_point: string | null;
    /** Test Point */
    test_point: string | null;
    /** Question Types */
    question_types: string | null;
    /** Quantity */
    quantity: number;
    /** Difficulty */
    difficulty: number;
    /** Questions Json */
    questions_json: string;
    /** Created At */
    created_at: string | null;
  };

  type exportDetailApiHermesV1ExportsExportIdGetParams = {
    export_id: string;
  };

  type exportPaperApiHermesV1PapersPaperIdExportsPostParams = {
    paper_id: string;
  };

  type ExportResponse = {
    /** Id */
    id: string;
    /** Paper Id */
    paper_id: string;
    /** Format */
    format: string;
    /** Status */
    status: "generating" | "ready" | "failed";
    /** Filename */
    filename: string;
    /** Download Url */
    download_url?: string | null;
    /** Error */
    error?: string | null;
  };

  type exportWordApiShubanFilesFilenameWordGetParams = {
    filename: string;
  };

  type FileRequestBody = {
    /** Method */
    method?: string;
    /** Data */
    data?: Record<string, any> | null;
  };

  type GenerateRequest = {
    /** User Prompt */
    user_prompt: string;
    /** Existing Questions */
    existing_questions?: any[] | null;
    /** Optimization Suggestion */
    optimization_suggestion?: string | null;
  };

  type getAstApiShubanFilesFilenameAstGetParams = {
    filename: string;
  };

  type getCaptchaApiLoginCaptchaPostParams = {
    /** 手机号 */
    phone?: string | null;
  };

  type getCurrentUserApiCurrentUserGetParams = {
    session_token?: string | null;
  };

  type getDownloadUrlParams = {
    /** 文件ID */
    fileId: number;
  };

  type getExamDetailApiChujuanjiExamsExamIdGetParams = {
    exam_id: number;
  };

  type getKnowledgePointsApiChujuanjiKnowledgePointsGetParams = {
    course_type_code?: string | null;
    parent_id?: string | null;
    level?: number | null;
  };

  type getKnowledgePointsBySubjectApiChujuanjiKnowledgePointsBySubjectGetParams =
    {
      subject: string;
      grade: string;
    };

  type getKnowledgeTreeApiChujuanjiKnowledgePointsTreeGetParams = {
    course_type_code: string;
    parent_id?: string;
  };

  type getMessagesApiChatMessagesGetParams = {
    chat_id: string;
  };

  type getPreviewApiShubanFilesFilenamePreviewGetParams = {
    filename: string;
  };

  type getQuestionTypesApiChujuanjiQuestionTypesGetParams = {
    subject: string;
    grade: string;
  };

  type getReportApiShubanFilesFilenameReportGetParams = {
    filename: string;
  };

  type getTaskStatusApiMineruExtractStatusTaskIdGetParams = {
    task_id: string;
  };

  type getTextApiShubanFilesFilenameTextGetParams = {
    filename: string;
    plain?: boolean;
  };

  type getTokensApiShubanFilesFilenameTokensGetParams = {
    filename: string;
  };

  type getWordConversionPreviewApiShubanWordConversionsConversionIdPreviewGetParams =
    {
      conversion_id: string;
    };

  type hermes_schemas_ChatCompletionRequest = {
    /** Model */
    model?: string | null;
    /** Messages */
    messages: ChatMessage[];
    /** Conversation Id */
    conversation_id?: string | null;
    /** Stream */
    stream?: boolean;
    /** Temperature */
    temperature?: number | null;
    /** Top P */
    top_p?: number | null;
    /** Max Tokens */
    max_tokens?: number | null;
    /** Task */
    task?: "chat" | "question_bank";
    paper_config?: PaperGenerationConfig | null;
  };

  type HTTPValidationError = {
    /** Detail */
    detail?: ValidationError[];
  };

  type ImportQuestionBankRequest = {
    /** Url */
    url?: string | null;
    document?: QuestionBankDocument | null;
    /** Title */
    title?: string | null;
    /** Subject */
    subject?: string | null;
    /** Grade */
    grade?: string | null;
    /** Exam Type */
    exam_type?: string | null;
    /** Difficulty */
    difficulty?: number | null;
  };

  type LangChainChatAttachment = {
    /** Url 附件公网地址（http/https） */
    url: string;
    /** Name 附件名称 */
    name?: string | null;
  };

  type LangChainChatMessage = {
    /** Role 消息角色：system / user / assistant */
    role: string;
    /** Content 消息内容 */
    content?: string | Record<string, any>[];
  };

  type LangChainChatRequest = {
    /** Messages 对话消息列表（含完整本地历史） */
    messages: LangChainChatMessage[];
    /** Conversation Id 会话 ID（conversations 表），空则跳过落库（向后兼容） */
    conversation_id?: string | null;
    /** Attachments 随消息发送的附件 */
    attachments?: LangChainChatAttachment[];
    /** Stream 恒为流式 */
    stream?: boolean;
  };

  type listAttachmentsApiMineruAttachmentsGetParams = {
    limit?: number;
  };

  type listConversationsApiConversationsGetParams = {
    limit?: number;
  };

  type listExamsApiChujuanjiExamsGetParams = {
    skip?: number;
    limit?: number;
    subject?: string | null;
    grade?: string | null;
    exam_type?: string | null;
  };

  type listFilesApiFilesGetParams = {
    /** 当前的页码 */
    current?: number;
    /** 页面的容量 */
    pageSize?: number;
    /** 文件名称（模糊搜索） */
    original_name?: string | null;
  };

  type listMessagesApiConversationsConversationIdMessagesGetParams = {
    conversation_id: string;
    limit?: number;
    before_id?: number | null;
  };

  type listMineruTasksApiMineruTasksGetParams = {
    /** 当前的页码 */
    current?: number;
    /** 页面的容量 */
    pageSize?: number;
    /** 任务名称（模糊搜索） */
    original_name?: string | null;
    /** 状态筛选: submitted(解析中) / done(成功) / error(失败) */
    state?: string | null;
    /** 收藏筛选：true 仅收藏 / false 仅未收藏 / 不传为全部 */
    favorite?: boolean | null;
  };

  type listRecordsApiQietiRecordsGetParams = {
    limit?: number;
    offset?: number;
  };

  type listUsersApiUsersGetParams = {
    /** 页码 */
    current?: number;
    /** 每页数量 */
    pageSize?: number;
    /** 用户名模糊搜索 */
    username?: string | null;
    /** 姓名模糊搜索 */
    name?: string | null;
  };

  type LoginParams = {
    /** Username */
    username: string;
    /** Password */
    password: string;
    /** Autologin */
    autoLogin?: boolean | null;
    /** Type */
    type?: string;
  };

  type logoutApiLoginOutLoginPostParams = {
    session_token?: string | null;
  };

  type MessageItem = {
    /** Id */
    id: number;
    /** Role */
    role: string;
    /** Content */
    content: string;
    /** Content Json */
    content_json: string | null;
    /** Status */
    status: number;
    /** Finish Reason */
    finish_reason: string | null;
    /** Usage */
    usage: string | null;
    /** Created At */
    created_at: string;
  };

  type MessagePage = {
    /** Messages */
    messages: MessageItem[];
    /** Has More */
    has_more: boolean;
    /** Next Before Id */
    next_before_id: number | null;
  };

  type mineruUploadFileApiFilesMineruUploadPostParams = {
    session_token?: string | null;
  };

  type OpenClawChatAttachment = {
    /** Url 附件公网地址（http/https） */
    url: string;
    /** Name 附件名称 */
    name?: string | null;
  };

  type OpenClawChatMessage = {
    /** Role 消息角色：system / user / assistant */
    role: string;
    /** Content 消息内容 */
    content?: string | Record<string, any>[];
  };

  type OpenClawChatRequest = {
    /** Messages 对话消息列表 */
    messages: OpenClawChatMessage[];
    /** Conversation Id 会话 ID（conversations 表） */
    conversation_id?: string | null;
    /** Attachments 随消息发送的附件 */
    attachments?: OpenClawChatAttachment[];
    /** Stream 恒为流式 */
    stream?: boolean;
  };

  type OssMdTextToDocxRequest = {
    /** Md Content Markdown 文本内容 */
    md_content: string;
    /** Filename 目标文件名（不含扩展名也可） */
    filename?: string | null;
  };

  type OssMdToDocxResponse = {
    /** Filename */
    filename?: string;
    /** Url OSS 上的 Word 文件地址 */
    url: string;
  };

  type paperDetailApiHermesV1PapersPaperIdGetParams = {
    paper_id: string;
  };

  type PaperGenerationConfig = {
    /** Subject */
    subject:
      | "数学"
      | "语文"
      | "英语"
      | "物理"
      | "化学"
      | "生物"
      | "历史"
      | "地理"
      | "政治";
    /** Grade */
    grade: string;
    /** Knowledge Points */
    knowledge_points?: string[];
    /** Question Types */
    question_types?: string[];
    /** Quantity */
    quantity: number;
    /** Difficulty */
    difficulty: number;
    /** Exam Type */
    exam_type: "期末考试" | "随堂小测" | "单元测试" | "期中考试" | "模拟考试";
    /** Remarks */
    remarks?: string;
  };

  type PaperResponse = {
    /** Id */
    id: string;
    /** Bank Id */
    bank_id: string;
    /** Title */
    title: string;
    /** Question Count */
    question_count: number;
    /** Total Score */
    total_score: number | null;
    /** Include Answers */
    include_answers: boolean;
    document: QuestionBankDocument;
  };

  type passthroughApiMineruProxyPathDeleteParams = {
    path: string;
  };

  type passthroughApiMineruProxyPathDeleteParams = {
    path: string;
  };

  type passthroughApiMineruProxyPathDeleteParams = {
    path: string;
  };

  type passthroughApiMineruProxyPathDeleteParams = {
    path: string;
  };

  type passthroughApiMineruProxyPathDeleteParams = {
    path: string;
  };

  type pollBatchApiMineruProxyExtractResultsBatchBatchIdGetParams = {
    batch_id: string;
  };

  type Question = {
    /** Id */
    id: string;
    /** Type */
    type: string;
    /** Content */
    content: string;
    /** Options */
    options?: QuestionOption[];
    /** Answer */
    answer?: string;
    /** Analysis */
    analysis?: string;
    /** Score */
    score?: number | null;
    /** Knowledge Points */
    knowledge_points?: string[];
    /** Cognitive Level */
    cognitive_level?: string;
    /** Difficulty */
    difficulty?: number | null;
  };

  type questionBankDetailApiHermesV1QuestionBanksBankIdGetParams = {
    bank_id: string;
  };

  type QuestionBankDocument = {
    /** Type */
    type?: string;
    /** Version */
    version?: number;
    /** Id */
    id?: string;
    /** Title */
    title: string;
    /** Subject */
    subject: string;
    /** Grade */
    grade: string;
    /** Exam Type */
    exam_type?: string;
    /** Difficulty */
    difficulty?: number | null;
    /** Questions */
    questions: Question[];
  };

  type QuestionBankResponse = {
    /** Id */
    id: string;
    /** Question Count */
    question_count: number;
    /** Total Score */
    total_score: number | null;
    document: QuestionBankDocument;
  };

  type QuestionOption = {
    /** Label */
    label: string;
    /** Content */
    content: string;
  };

  type receiveUploadApiMineruProxyUploadBatchIdIndexPutParams = {
    batch_id: string;
    index: number;
  };

  type RecordsResponse = {
    /** Success */
    success: boolean;
    /** Records */
    records?: Record<string, any>[];
  };

  type removeExamApiChujuanjiExamsExamIdDeleteParams = {
    exam_id: number;
  };

  type renameConversationApiConversationsConversationIdPatchParams = {
    conversation_id: string;
  };

  type renameSessionApiChatSessionsChatIdPutParams = {
    chat_id: string;
  };

  type SaveExamRequest = {
    /** Title */
    title: string;
    /** Subject */
    subject: string;
    /** Grade */
    grade: string;
    /** Exam Type */
    exam_type: string;
    /** Knowledge Point */
    knowledge_point?: string | null;
    /** Test Point */
    test_point?: string | null;
    /** Question Types */
    question_types: string[];
    /** Quantity */
    quantity: number;
    /** Difficulty */
    difficulty: number;
    /** Questions */
    questions: any[];
  };

  type saveWordConversionApiShubanWordConversionsConversionIdSavePostParams = {
    conversion_id: string;
  };

  type searchKnowledgePointsApiChujuanjiKnowledgePointsSearchGetParams = {
    keyword: string;
    course_type_code?: string | null;
  };

  type SnapshotGetResponse = {
    /** Success */
    success: boolean;
    /** Snapshot */
    snapshot?: Record<string, any> | null;
  };

  type SnapshotPayload = {
    /** Pages */
    pages?: Record<string, any>[];
    /** Currentpageindex */
    currentPageIndex?: number;
  };

  type SnapshotSaveResponse = {
    /** Success */
    success: boolean;
    /** Totalpages */
    totalPages: number;
    /** Totalquestions */
    totalQuestions: number;
    /** Updatedat */
    updatedAt: number;
  };

  type storePaperPdfApiHermesV1PapersPaperIdExportsPdfPostParams = {
    paper_id: string;
  };

  type SubmitRequest = {
    /** Pdf Url 需要解析的文件 URL */
    pdf_url: string;
    /** Model Version 模型版本: pipeline(轻量) / vlm(推荐,默认) / MinerU-HTML(源文件为 html 时必选) */
    model_version?: string;
    /** Is Ocr 是否启用 OCR（pipeline/vlm 有效） */
    is_ocr?: boolean;
    /** Enable Formula 公式识别（pipeline/vlm 有效；vlm 仅影响行内公式） */
    enable_formula?: boolean;
    /** Enable Table 表格识别（pipeline/vlm 有效） */
    enable_table?: boolean;
    /** Language 文档语言: ch/en/japan/korean/chinese_cht 等 */
    language?: string;
    /** Page Ranges 页码范围，如 "2,4-6"（4到6含端点）、"2--2"（第2页到倒数第2页） */
    page_ranges?: string | null;
  };

  type TicketLoginRequest = {
    /** Ticket 一次性免密登录凭证 */
    ticket: string;
  };

  type toggleTaskFavoriteApiMineruTasksTaskIdFavoritePostParams = {
    task_id: number;
  };

  type updateUserApiUsersUserIdPutParams = {
    user_id: number;
  };

  type UpdateUserRequest = {
    /** Name */
    name?: string | null;
    /** Password */
    password?: string | null;
    /** Email */
    email?: string | null;
    /** Phone */
    phone?: string | null;
    /** Title */
    title?: string | null;
    /** Group Name */
    group_name?: string | null;
    /** Access */
    access?: string | null;
  };

  type uploadFileApiFilesUploadPostParams = {
    session_token?: string | null;
  };

  type ValidationError = {
    /** Location */
    loc: (string | number)[];
    /** Message */
    msg: string;
    /** Error Type */
    type: string;
  };
}
