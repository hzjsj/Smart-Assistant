export const QUESTION_TYPES = [
  '单选题',
  '多选题',
  '填空题',
  '判断题',
  '简答题',
] as const;

/** 矩形最小尺寸（像素），小于该值的框在松开时丢弃 */
export const MIN_SIZE = 12;

/** localStorage 缓存键（带项目前缀，与同机其他 localhost 项目的缓存隔离） */
export const CACHE_KEY = 'smart-assistant-question-bank-data';

/** 自动识别请求限速（次/秒） */
export const DETECT_REQUESTS_PER_SECOND = 5;

export const PDF_MAX_SIZE = 50 * 1024 * 1024;
export const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
