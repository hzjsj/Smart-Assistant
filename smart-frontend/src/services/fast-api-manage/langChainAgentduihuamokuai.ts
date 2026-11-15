// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** LangChain Agent 对话（SSE 流式） 手动 tool-calling 循环的流式对话：

- 底层模型由 ``LANGCHAIN_AGENT_MODEL`` 决定（默认 deepseek-v4-flash）；
- 多轮上下文使用前端随请求携带的完整 messages（与 deepseek 同构）；
- 工具调用进度走 ``hermes.tool.progress`` 命名事件，前端过程面板复用；
- 落库/续播/abort 全部由 conversations 采集器接管。 POST /api/langchain/chat/completions */
export async function chatCompletionsApiLangchainChatCompletionsPost(
  body: API.LangChainChatRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/langchain/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}
