/** 切题模块类型定义（迁移自 smart-question-bank） */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface QuestionInfo {
  figures: string[];
  stemText: string;
  optionTexts: string[];
  subquestionTexts: string[];
  fullText: string;
}

export interface QietiQuestion {
  id: string;
  no: number;
  type: string;
  /** 主矩形（rects[0] 的冗余副本，兼容旧数据） */
  rect: Rect | null;
  rects: Rect[];
  subImages: string[];
  mergedImage: string;
  info: QuestionInfo;
}

export interface QietiPage {
  id: string;
  name: string;
  /** 本地 dataURL 或远程 URL */
  imageUrl: string;
  /** 已上传到 TOS 的远程 URL（自动识别前为 null） */
  uploadedImageUrl: string | null;
  width: number;
  height: number;
  questions: QietiQuestion[];
}

/** 右侧题目列表预览项 */
export interface QuestionPreview {
  id: string;
  no: number;
  pageIndex: number;
  type: string;
  mergedImage: string;
  figures: string[];
  stemText: string;
  optionTexts: string[];
  subquestionTexts: string[];
  fullText: string;
}

/** 切题接口（EduTutor）返回的原始题目结构 */
export interface CutApiQuestion {
  pos_list?: number[][];
  sub_images?: string[];
  merged_image?: string;
  info?: {
    stem?: { text?: string };
    option?: { text?: string }[];
    subquestion?: unknown[];
    figure?: unknown;
  };
}

export interface CutApiResponse {
  questions_data?: {
    questions?: CutApiQuestion[];
  };
}

export interface UploadApiResponse {
  success?: boolean;
  filename?: string;
  content_type?: string;
  size?: number;
  message?: string;
  url?: string;
  /** 错误响应 */
  detail?: string;
}

/** 快照（/api/qieti/snapshot）结构 */
export interface SnapshotFile {
  pageId: string;
  pageIndex: number;
  name: string;
  width: number;
  height: number;
  uploadedImageUrl: string;
  questionCount: number;
}

export interface SnapshotQuestion {
  id: string;
  no: number;
  type: string;
  pageIndex: number;
  pageId: string;
  pageName: string;
  mergedImage: string;
  stemText: string;
  optionTexts: string[];
  subquestionTexts: string[];
  figures: string[];
  fullText: string;
  questionImageUrl: string;
}

export interface QietiSnapshot {
  snapshotKey: string;
  currentPageIndex: number;
  files: SnapshotFile[];
  questions: SnapshotQuestion[];
  imageStats: {
    questionImageCount: number;
    figureImageCount: number;
    totalImageCount: number;
  };
  totalPages: number;
  totalQuestions: number;
  updatedAt: number;
}

/** 上传记录（/api/qieti/records）结构 */
export interface QietiUploadRecord {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedUrl: string;
  createdAt: number | null;
}
