// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** 当前用户附件记录 GET /api/mineru/attachments */
export async function listAttachmentsApiMineruAttachmentsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listAttachmentsApiMineruAttachmentsGetParams,
  options?: { [key: string]: any }
) {
  return request<API.AttachmentUploaded[]>("/api/mineru/attachments", {
    method: "GET",
    params: {
      // limit has a default value: 50
      limit: "50",
      ...params,
    },
    ...(options || {}),
  });
}

/** 上传聊天附件 保存附件到 OSS 并落库，返回公网 URL 供聊天请求引用。 POST /api/mineru/attachments */
export async function uploadAttachmentApiMineruAttachmentsPost(
  body: API.BodyUploadAttachmentApiMineruAttachmentsPost,
  file?: File,
  options?: { [key: string]: any }
) {
  const formData = new FormData();

  if (file) {
    formData.append("file", file);
  }

  Object.keys(body).forEach((ele) => {
    const item = (body as any)[ele];

    if (item !== undefined && item !== null) {
      if (typeof item === "object" && !(item instanceof File)) {
        if (item instanceof Array) {
          item.forEach((f) => formData.append(ele, f || ""));
        } else {
          formData.append(
            ele,
            new Blob([JSON.stringify(item)], { type: "application/json" })
          );
        }
      } else {
        formData.append(ele, item);
      }
    }
  });

  return request<API.AttachmentUploaded>("/api/mineru/attachments", {
    method: "POST",
    data: formData,
    requestType: "form",
    ...(options || {}),
  });
}

/** 删除附件记录与 OSS 对象 DELETE /api/mineru/attachments/${param0} */
export async function deleteAttachmentApiMineruAttachmentsAttachmentIdDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteAttachmentApiMineruAttachmentsAttachmentIdDeleteParams,
  options?: { [key: string]: any }
) {
  const { attachment_id: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/attachments/${param0}`, {
    method: "DELETE",
    params: { ...queryParams },
    ...(options || {}),
  });
}

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

/** 带附件的聊天：注入附件 URL 后转发 Hermes Agent 把附件地址注入最后一条 user 消息后委托 hermes.service 转发上游。

落库 content 用注入前的原始文本（附件卡片由 content_json.attachments
还原）；上游流经 conversations 采集转发器——客户端断开不影响后端
继续读完上游并落库。 POST /api/mineru/chat/completions */
export async function chatCompletionsWithAttachmentsApiMineruChatCompletionsPost(
  body: API.AttachmentChatRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/mineru/chat/completions", {
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

/** MinerU 解析任务列表（分页，供 /mineru 任务管理页） GET /api/mineru/tasks */
export async function listMineruTasksApiMineruTasksGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listMineruTasksApiMineruTasksGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/mineru/tasks", {
    method: "GET",
    params: {
      // current has a default value: 1
      current: "1",
      // pageSize has a default value: 10
      pageSize: "10",

      ...params,
    },
    ...(options || {}),
  });
}

/** 收藏/取消收藏任务 POST /api/mineru/tasks/${param0}/favorite */
export async function toggleTaskFavoriteApiMineruTasksTaskIdFavoritePost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.toggleTaskFavoriteApiMineruTasksTaskIdFavoritePostParams,
  options?: { [key: string]: any }
) {
  const { task_id: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/tasks/${param0}/favorite`, {
    method: "POST",
    params: { ...queryParams },
    ...(options || {}),
  });
}
