/**
 * 后端 API 基地址（流式 SSE 直连与其他直连后端的请求共用）。
 *
 * - 开发：按当前访问主机推导 + 5000 端口。SSE 必须绕过 dev 代理
 *   （HPM 会缓冲流式响应导致一次性吐出）；局域网 IP / 手机真机同样可直连。
 * - 生产：空串走同源（nginx proxy_buffering off 反代 /api 到后端），
 *   换环境无需改代码（与 copilot / hermes 页的既有惯例一致）。
 *
 * chat / chatbot / generate-test-paper 的流式请求统一引用此常量，
 * 禁止再硬编码 http://localhost:5000（todo 第 3 条）。
 */
export const API_BASE =
  process.env.NODE_ENV === 'development'
    ? `${window.location.protocol}//${window.location.hostname}:5000`
    : '';
