declare namespace API {
  type BodyMineruUploadFileApiFilesMineruUploadPost = {
    /** File */
    file: string;
  };

  type BodyUploadFileApiFilesUploadPost = {
    /** File */
    file: string;
  };

  type CallbackRequest = {
    /** Checksum 签名校验值 */
    checksum: string;
    /** Content JSON 字符串 */
    content: string;
  };

  type ChatCompletionRequest = {
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

  type deleteSessionApiChatSessionsChatIdDeleteParams = {
    chat_id: string;
  };

  type DeleteUsersRequest = {
    /** Ids 要删除的用户ID列表 */
    ids: number[];
  };

  type downloadFileApiFilesDownloadSavedNameGetParams = {
    saved_name: string;
  };

  type downloadMdFileApiFilesDownloadMdMdSavedNameGetParams = {
    md_saved_name: string;
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

  type FileRequestBody = {
    /** Method */
    method?: string;
    /** Data */
    data?: Record<string, any> | null;
  };

  type GenerateRequest = {
    /** User Prompt */
    user_prompt: string;
  };

  type getCaptchaApiLoginCaptchaPostParams = {
    /** 手机号 */
    phone?: string | null;
  };

  type getCurrentUserApiCurrentUserGetParams = {
    mock_token?: string | null;
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

  type getQuestionTypesApiChujuanjiQuestionTypesGetParams = {
    subject: string;
    grade: string;
  };

  type getTaskStatusApiMineruExtractStatusTaskIdGetParams = {
    task_id: string;
  };

  type HTTPValidationError = {
    /** Detail */
    detail?: ValidationError[];
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
    mock_token?: string | null;
  };

  type mineruUploadFileApiFilesMineruUploadPostParams = {
    mock_token?: string | null;
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

  type removeExamApiChujuanjiExamsExamIdDeleteParams = {
    exam_id: number;
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

  type searchKnowledgePointsApiChujuanjiKnowledgePointsSearchGetParams = {
    keyword: string;
    course_type_code?: string | null;
  };

  type SubmitRequest = {
    /** Pdf Url 需要解析的文件 URL */
    pdf_url: string;
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
    mock_token?: string | null;
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
