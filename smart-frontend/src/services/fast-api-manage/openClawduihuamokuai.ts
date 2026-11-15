// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** OpenClaw Agent 对话（SSE 流式） OpenClaw 网关直通透传：

- 多轮上下文由上游 agent 会话维护（``user`` = conversations 表 ID）；
- 客户端刷新/断线不影响后端读完上游并落库，仅手动 abort 终止；
- 上游输出标准 OpenAI SSE，前端 Provider 无需区分。 POST /api/openclaw/chat/completions */
export async function chatCompletionsApiOpenclawChatCompletionsPost(
  body: API.OpenClawChatRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/openclaw/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}
