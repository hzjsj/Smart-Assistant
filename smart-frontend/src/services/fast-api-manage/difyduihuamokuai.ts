// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Dify Agent 对话（SSE 流式） 把 Dify 事件流翻译为 OpenAI chunk 后交给 conversations 采集转发器：

- 多轮上下文由 Dify 维护，本地只保存 ``conversation_id`` 映射；
- 客户端刷新/断线不影响后端读完上游并落库，仅手动 abort 终止；
- ``agent_thought`` 转为思考内容 + 工具进度事件，复用现有工具链 UI。 POST /api/dify/chat/completions */
export async function chatCompletionsApiDifyChatCompletionsPost(
  body: API.DifyChatRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/dify/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Dify 应用信息与参数 返回应用名称/模式/标签与参数表单，用于确认 key 有效且为 Agent 应用。 GET /api/dify/info */
export async function appInfoApiDifyInfoGet(options?: { [key: string]: any }) {
  return request<any>("/api/dify/info", {
    method: "GET",
    ...(options || {}),
  });
}
