"""企业微信模块：登录环境探测 + OAuth code 免密登录。

登录逻辑与 hwwh-manage-backend 的 wecom 模块保持同一契约：
- GET /api/wecom/check-env：判断是否企微内置浏览器，下发前端拼授权链接所需配置
- GET /api/wecom/login?code=：code 换 userid，按 User.userid 查找/自动注册用户后签发会话
"""
