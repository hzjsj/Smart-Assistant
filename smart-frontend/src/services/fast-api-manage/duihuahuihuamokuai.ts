// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** 会话列表 GET /api/conversations */
export async function listConversationsApiConversationsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listConversationsApiConversationsGetParams,
  options?: { [key: string]: any }
) {
  return request<API.ConversationItem[]>("/api/conversations", {
    method: "GET",
    params: {
      // limit has a default value: 100
      limit: "100",
      ...params,
    },
    ...(options || {}),
  });
}

/** 创建会话 POST /api/conversations */
export async function createConversationApiConversationsPost(
  body: API.ConversationCreate,
  options?: { [key: string]: any }
) {
  return request<API.ConversationItem>("/api/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** 会话软删除 DELETE /api/conversations/${param0} */
export async function deleteConversationApiConversationsConversationIdDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteConversationApiConversationsConversationIdDeleteParams,
  options?: { [key: string]: any }
) {
  const { conversation_id: param0, ...queryParams } = params;
  return request<any>(`/api/conversations/${param0}`, {
    method: "DELETE",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** 会话改名 PATCH /api/conversations/${param0} */
export async function renameConversationApiConversationsConversationIdPatch(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.renameConversationApiConversationsConversationIdPatchParams,
  body: API.ConversationRename,
  options?: { [key: string]: any }
) {
  const { conversation_id: param0, ...queryParams } = params;
  return request<API.ConversationItem>(`/api/conversations/${param0}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  });
}

/** 终止进行中的流式对话 POST /api/conversations/${param0}/abort */
export async function abortConversationApiConversationsConversationIdAbortPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.abortConversationApiConversationsConversationIdAbortPostParams,
  options?: { [key: string]: any }
) {
  const { conversation_id: param0, ...queryParams } = params;
  return request<any>(`/api/conversations/${param0}/abort`, {
    method: "POST",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** 消息游标分页 GET /api/conversations/${param0}/messages */
export async function listMessagesApiConversationsConversationIdMessagesGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listMessagesApiConversationsConversationIdMessagesGetParams,
  options?: { [key: string]: any }
) {
  const { conversation_id: param0, ...queryParams } = params;
  return request<API.MessagePage>(`/api/conversations/${param0}/messages`, {
    method: "GET",
    params: {
      // limit has a default value: 50
      limit: "50",
      ...queryParams,
    },
    ...(options || {}),
  });
}
