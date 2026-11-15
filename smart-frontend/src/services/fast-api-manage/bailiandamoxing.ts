// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** 百炼 Agent 2.0 对话（SSE 流式 + 会话落库） 调用百炼 Agent 2.0 应用（``/apps/{APP_ID}/completion``）并翻译成
OpenAI 兼容流，交给 conversations 采集转发器统一落库。

- 多轮上下文由百炼 ``session_id`` 维护，本地只保存映射（1 小时有效）；
- 图片附件 → ``image_list``，文档 → ``file_list``（OSS 公网 URL 直传）；
- 客户端刷新/断线不影响后端读完上游并落库，仅手动 abort 终止。 POST /api/bailian/agent/chat/completions */
export async function agentChatCompletionsApiBailianAgentChatCompletionsPost(
  body: API.BailianAgentChatRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/bailian/agent/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}
