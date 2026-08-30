"""SSRF 防护：校验用户提供的 URL 仅指向公网 http(s) 资源。

用于 OSS/百炼等「服务端拉取用户传入 URL」的场景，阻断访问内网、环回、
link-local（含云元数据 169.254.169.254）等地址。
"""
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException


def validate_public_url(url: str) -> str:
    """校验 URL 指向公网 http(s) 资源；合法则原样返回，否则抛 HTTPException(400)。

    注意：这是尽力而为的防护，无法完全消除 DNS rebinding（解析后到实际请求间
    地址可能变化）；如需更强保障应在网络层限制出站。
    """
    if not url or not isinstance(url, str):
        raise HTTPException(status_code=400, detail="URL 不能为空")

    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="仅支持 http/https URL")

    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="URL 缺少主机名")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="URL 主机名无法解析")

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="禁止访问内网/保留地址")

    return url
