// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** 接收 MinerU 处理完成的回调 POST /api/mineru/callback */
export async function callbackApiMineruCallbackPost(
  body: API.CallbackRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/mineru/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** 主动查询任务状态 GET /api/mineru/extract/status/${param0} */
export async function getTaskStatusApiMineruExtractStatusTaskIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getTaskStatusApiMineruExtractStatusTaskIdGetParams,
  options?: { [key: string]: any }
) {
  const { task_id: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/extract/status/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** 提交文档解析任务 POST /api/mineru/extract/submit */
export async function submitTaskApiMineruExtractSubmitPost(
  body: API.SubmitRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/mineru/extract/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}
