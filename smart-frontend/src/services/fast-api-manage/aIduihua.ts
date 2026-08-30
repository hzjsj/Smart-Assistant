// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Chat Completions POST /api/chat/completions */
export async function chatCompletionsApiChatCompletionsPost(
  body: API.ChatCompletionRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Get Messages GET /api/chat/messages */
export async function getMessagesApiChatMessagesGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getMessagesApiChatMessagesGetParams,
  options?: { [key: string]: any }
) {
  return request<API.ChatMessagesResponse>("/api/chat/messages", {
    method: "GET",
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** Get Models GET /api/chat/models */
export async function getModelsApiChatModelsGet(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/chat/models", {
    method: "GET",
    ...(options || {}),
  });
}

/** Get Sessions GET /api/chat/sessions */
export async function getSessionsApiChatSessionsGet(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/chat/sessions", {
    method: "GET",
    ...(options || {}),
  });
}

/** Create Session POST /api/chat/sessions */
export async function createSessionApiChatSessionsPost(
  body: API.ChatSessionCreate,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chat/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Rename Session PUT /api/chat/sessions/${param0} */
export async function renameSessionApiChatSessionsChatIdPut(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.renameSessionApiChatSessionsChatIdPutParams,
  body: API.ChatSessionRename,
  options?: { [key: string]: any }
) {
  const { chat_id: param0, ...queryParams } = params;
  return request<any>(`/api/chat/sessions/${param0}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  });
}

/** Delete Session DELETE /api/chat/sessions/${param0} */
export async function deleteSessionApiChatSessionsChatIdDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteSessionApiChatSessionsChatIdDeleteParams,
  options?: { [key: string]: any }
) {
  const { chat_id: param0, ...queryParams } = params;
  return request<any>(`/api/chat/sessions/${param0}`, {
    method: "DELETE",
    params: { ...queryParams },
    ...(options || {}),
  });
}
