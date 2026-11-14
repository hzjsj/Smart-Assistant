"""LangChain Agent 对话模块：自研 Tool-Calling Agent（第五种对话后端）。

与 deepseek（直通）/ dify / bailian（事件翻译）并列的第四种接入形态：
LangChain 手动 tool-calling 循环产出 OpenAI 兼容 SSE，交给 conversations
采集器落库。工具进度走 ``hermes.tool.progress`` 命名事件，前端过程面板
零改动复用。目录名刻意避开 ``langchain``（与已安装包同名会 import 冲突）。
"""
