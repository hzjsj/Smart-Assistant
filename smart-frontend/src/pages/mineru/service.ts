import { request } from '@umijs/max';

// 走相对路径，由 dev proxy / nginx 反代到后端，同源自动携带登录 Cookie
const API_BASE = '/api/mineru';

/** MinerU 解析任务记录（后端 file_records 中 mineru_task_id 非空的行） */
export interface MineruTask {
  id: number;
  original_name: string;
  saved_name: string;
  file_size: number;
  download_url: string | null;
  uid: string | null;
  oss_md_url: string | null;
  oss_word_url: string | null;
  /** HTML 预览地址（extra_formats 生成，新任务才有） */
  oss_html_url: string | null;
  mineru_task_id: string | null;
  /** submitted(解析中) / done(成功) / error(失败) */
  mineru_state: string | null;
  created_at: string;
}

export type MineruTaskState = 'submitted' | 'done' | 'error';

export interface MineruTaskListParams {
  current?: number;
  pageSize?: number;
  /** 任务名称模糊搜索 */
  original_name?: string;
  /** 状态筛选 */
  state?: MineruTaskState;
}

export interface MineruTaskListResp {
  data: MineruTask[];
  total: number;
  success: boolean;
}

/** 任务列表（分页，仅当前用户提交的 MinerU 任务） */
export async function listMineruTasks(
  params: MineruTaskListParams,
): Promise<MineruTaskListResp> {
  return request<MineruTaskListResp>(`${API_BASE}/tasks`, {
    params,
    skipErrorHandler: true,
  });
}

/** 删除任务（复用文档管理批量删除接口：物理文件 + 向量索引一并清理） */
export async function deleteMineruTasks(ids: number[]): Promise<void> {
  await request('/api/files', {
    method: 'POST',
    data: { method: 'delete', data: { id: ids } },
    skipErrorHandler: true,
  });
}
