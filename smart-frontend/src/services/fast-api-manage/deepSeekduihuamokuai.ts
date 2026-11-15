// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** 普通对话：转发 DeepSeek（SSE 流式） 白名单转发 model/messages/attachments；上游流经 conversations 采集
转发器——客户端断开（刷新/断线）不影响后端继续读完上游并落库。

图片附件由 service 注入最后一条 user 消息（image_url 内容块）。
前端沿用 HermesChatProvider 的 OpenAI 增量解析（content 与
reasoning_content 思维链），无需针对 DeepSeek 做任何改动。 POST /api/deepseek/chat/completions */
export async function chatCompletionsApiDeepseekChatCompletionsPost(
  body: API.DeepSeekChatRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/deepseek/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}
