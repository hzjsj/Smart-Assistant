# -*- coding: utf-8 -*-
"""字节层：GBK 双字节状态机 + 方正书版用户区控制符识别。

方正书版小样（.fbd / .PRO）是 GBK 编码文本，但使用了 GBK 用户自定义区的码位
（AA 行等）存放控制符，Python 的 gbk / cp936 编解码器会拒绝这些码位
（抛 UnicodeDecodeError），因此必须逐双字节自行解码。

控制符语义来自本会话对真实语料的实测（见 docs/agent/FBD排版经验总结.md）。
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ---- 控制符表：(首字节, 次字节) -> (显示代号, 语义) ----
CTRL_TABLE = {
    (0xAA, 0xA4): ("A4", "换行符：出现在行尾（正文 93% 的行尾是它），书版真正的换行"),
    (0xAA, 0xA5): ("A5", "换段符：出现在行尾，78% 为句末；段落之间用它（CRLF 只是小样排版换行）"),
    (0xAA, 0xA6): ("A6", "文件结束符（手册中的 Ω）"),
    (0xAA, 0xA1): ("A1", "圈码定界-开：内含 B<编号>，实测 B11→①…B20→⑩、B21→⑪"),
    (0xAA, 0xA3): ("A3", "圈码定界-闭"),
    (0xAA, 0xA9): ("A9", "盒组括弧-开：成对包裹一段内容，本身不输出字符"),
    (0xAA, 0xAA): ("AA", "盒组括弧-闭"),
    (0xAA, 0xA8): ("A8", "宏参数占位符（〖=X(…〗 展开时被实参替换）"),
    (0xAA, 0xAC): ("AC", "上标/注号标记：数学语料用于上标，后随圈码时表示注号"),
    (0xAA, 0xAD): ("AD", "下标标记：数学语料用于下标"),
}

_PUA_BASE = 0xE000          # 占位符起始码位（每个文件内按需分配）


@dataclass
class Decoded:
    """解码结果：字符流 + 每个字符的源字节偏移与行号。"""

    text: str                                   # 合并后的字符流（控制符已替换为占位符）
    offsets: list[int]                          # 字符索引 -> 源字节偏移
    lines: list[int]                            # 字符索引 -> 行号（1 起）
    marks: dict[str, tuple[str, str]] = field(default_factory=dict)
    # marks: 占位符 -> (kind, label)；kind ∈ {ctrl, unknown}，label 如 "A4" / "aabb"
    stats: dict = field(default_factory=dict)

    # ---- 显示辅助 ----
    def mark_display(self, placeholder: str) -> str:
        kind, label = self.marks[placeholder]
        return f"⟨{label}⟩" if kind == "ctrl" else f"⟨U{label}⟩"

    def translate(self, s: str) -> str:
        """把字符串里的占位符转换成可读形式。"""
        if not self.marks:
            return s
        return s.translate({ord(k): self.mark_display(k) for k in self.marks})


def decode(data: bytes) -> Decoded:
    """把 fbd/PRO 字节解码为 Decoded（不依赖系统编码表）。"""
    chars: list[str] = []
    offsets: list[int] = []
    lines: list[int] = []
    marks: dict[str, tuple[str, str]] = {}
    label_to_ph: dict[str, str] = {}

    def mark(kind: str, label: str) -> str:
        key = f"{kind}:{label}"
        ph = label_to_ph.get(key)
        if ph is None:
            ph = chr(_PUA_BASE + len(label_to_ph))
            label_to_ph[key] = ph
            marks[ph] = (kind, label)
        return ph

    crlf = lone_lf = lone_cr = 0
    i, n, line = 0, len(data), 1
    while i < n:
        b = data[i]
        # ---- 换行：CRLF 归一为 '\n'，行号递增 ----
        if b == 0x0D and i + 1 < n and data[i + 1] == 0x0A:
            chars.append("\n"); offsets.append(i); lines.append(line)
            line += 1; crlf += 1; i += 2
            continue
        if b in (0x0A, 0x0D):
            chars.append("\n"); offsets.append(i); lines.append(line)
            line += 1
            if b == 0x0A:
                lone_lf += 1
            else:
                lone_cr += 1
            i += 1
            continue
        # ---- ASCII ----
        if b < 0x80:
            chars.append(chr(b)); offsets.append(i); lines.append(line)
            i += 1
            continue
        # ---- 双字节 ----
        if i + 1 >= n:                                  # 末尾孤立高位字节
            chars.append(mark("unknown", f"{b:02x}")); offsets.append(i); lines.append(line)
            i += 1
            continue
        pair = (b, data[i + 1])
        if pair in CTRL_TABLE:
            code, _desc = CTRL_TABLE[pair]
            chars.append(mark("ctrl", code)); offsets.append(i); lines.append(line)
            i += 2
            continue
        two = data[i:i + 2]
        try:
            ch = two.decode("gbk")
        except UnicodeDecodeError:
            chars.append(mark("unknown", two.hex())); offsets.append(i); lines.append(line)
            i += 2
            continue
        chars.append(ch); offsets.append(i); lines.append(line)
        i += 2

    stats = {
        "size": len(data),
        "chars": len(chars),
        "crlf": crlf,
        "lone_lf": lone_lf,
        "lone_cr": lone_cr,
        "bom": data[:3] == b"\xef\xbb\xbf",
        "unknown_bytes": sum(1 for v in marks.values() if v[0] == "unknown"),
        "ctrl_kinds": {v[1]: 0 for v in marks.values() if v[0] == "ctrl"},
    }
    return Decoded(text="".join(chars), offsets=offsets, lines=lines, marks=marks, stats=stats)


def read(path: str) -> Decoded:
    with open(path, "rb") as f:
        return decode(f.read())
