/**
 * 生成 UUID v4。
 *
 * crypto.randomUUID 仅在安全上下文（HTTPS 或 localhost）存在；
 * 局域网 IP 的 HTTP 调试（如 http://192.168.x.x:8000）属于非安全上下文，
 * 该方法为 undefined。此时退化为 crypto.getRandomValues 实现——
 * 该 API 在非安全上下文仍然可用。均不可用时最后兜底时间戳 + 随机串。
 */
export const genUuid = (): string => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // 按 RFC 4122 设置 version(4) 与 variant(10xx) 位。
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
