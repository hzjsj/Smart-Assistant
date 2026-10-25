# -*- coding: utf-8 -*-
"""fbdview —— 方正书版小样（.fbd）预览与校验工具。

分层：
    bytes_io   字节层：GBK 状态机 + 用户区控制符识别
    lexer      词法层：文本 / 注解 / 控制符 / 换段
    annotations 注解字典（外置 JSON，可热更新）
    report     统计与校验报告
    cli        命令行入口
"""

__version__ = "0.1.0"
__all__ = ["bytes_io", "lexer", "annotations", "report", "cli"]
