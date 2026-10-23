# -*- coding: utf-8 -*-
"""生成浏览器预览用的 HTML 流、结构视图和纯文本。

近似原则（诚实标注，不假装等于书版排版）：
  · 页面/版心/栏按 BP+PRO 的真实毫米值换算像素；
  · 字体字号按 HT/WT/ST 状态机近似（五号=10.5pt 等），对齐/着重/彩色/方框/图片占位近似；
  · **自定义注解（〖=A〗〖=C〗〖=1〗〖=SB(…〗）按文件内的 ZD 定义做宏展开**，
    因此"答案黑体加线""新考法红标""黑底白字标签"等能正确呈现；
  · 行、栏、页坐标由 `pagination.js` 在浏览器中测量并近似分页；不等价于书版的排版算法。
"""
from __future__ import annotations

import html
import os
import re
import json
import struct
from urllib.parse import quote

from . import report as report_mod
from .layout import Geometry
from .macros import collect_defs, expand
from .sizes import family_css, font_css, font_name, mm_of, parse_ht, parse_size_font, CSS_PT_SCALE
from .font_state import FontState
from .context import load_context

# ---------------- 彩色（官方：CS[X|D][%]<C>,<M>,<Y>,<K>） ----------------
# 《方正书版使用指南》9.9 明确 <C>,<M>,<Y>,<K> 顺序；如需按其他顺序（例如该系列若
# 实际把第一个数当 K 用），只改这一行即可：可选 "CMYK" | "KCMY"。
CMYK_ORDER = "CMYK"


def cmyk_to_css(params: str) -> str | None:
    """按官方公式把 CMYK 参数转为 CSS 颜色。

    无 `%` 时 C/M/Y/K 取 0-255，有 `%` 时取 0-100。
    """
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", params)]
    if len(nums) < 4:
        return None
    pct = "%" in params
    scale = 100.0 if pct else 255.0
    a, b, c, d = (min(v, scale) / scale for v in nums[:4])
    if CMYK_ORDER == "KCMY":
        k, c, m, y = a, b, c, d
    else:
        c, m, y, k = a, b, c, d
    r = 255 * (1 - c) * (1 - k)
    g = 255 * (1 - m) * (1 - k)
    bl = 255 * (1 - y) * (1 - k)
    return f"#{int(round(r)):02x}{int(round(g)):02x}{int(round(bl)):02x}"


# ---------------- 着重（官方：Z正线 F反线 D点线 S双线 Q曲线 =双曲线 L三连点 。加圈，缺省着重点） ----------------
def zz_css(flag: str, above: bool = False) -> str:
    f = (flag or "").strip()
    pos = "over right" if above else "under right"
    if f in ("", "。"):
        return (f"text-emphasis: {'circle' if f == '。' else 'dot'};"
                f"text-emphasis-position: {pos};")
    return {
        "Z": "text-decoration: underline; text-decoration-thickness: 1px;",
        "F": "text-decoration: underline; text-decoration-thickness: 3px;",
        "D": "text-decoration: underline; text-decoration-style: dotted;",
        "S": "text-decoration: underline; text-decoration-style: double;",
        "Q": "text-decoration: underline; text-decoration-style: wavy;",
        "=": "text-decoration: underline; text-decoration-style: wavy; text-decoration-thickness: 2px;",
        "L": "text-decoration: underline; text-decoration-style: dotted; text-decoration-thickness: 2px;",
    }.get(f, "text-decoration: underline;")


# ---------------- 注号（AC 后的圈码）排版参数：想微调就改这三个数 ----------------
NOTE_PCT = 82        # 注号字号 = 正文字号的 82%
NOTE_RAISE = 0.58    # 注号上移量（相对注号自身字号，em）；越大越靠上
NOTE_SIDE = 0.15     # 注号左右边距（相对注号自身字号，em）；0 表示不留空隙


def parse_bw_params(params: str) -> dict:
    """解析边文注解(BW)参数（本指南未收录 BW，语义由实测语料推定）。

    实测形态（正文每个单元重复出现）：
      〖BW(D(X2mm,,)M1D0〗  前导 D、内层 X → 单页·下边文 2mm   （内含 DMX.EPS）
      〖BW(S(X2mm,,)M1D0〗  前导 S、内层 X → 双页·下边文 2mm   （内含 SMX.EPS）
      〖BW(B(Z1mm，，)〗     前导 B、内层 Z → 左边文 1mm        （内含 ZBW新＝左装订线）
      〖BW(B(Y1mm，，)〗     前导 B、内层 Y → 右边文 1mm        （内含 YBW新＝右装订线）
      〖BW((Y-2*2，，)〗/〖BW((Z0，，)〗 → 只有参数、无内容（切换/清除用）

    单双页：前导 D=单页(奇数)、S=双页(偶数)；前导 B 不区分，按边别推定
    （书脊侧：左边文→单页、右边文→双页，与用户确认的成书效果一致）。
    """
    p = re.sub(r"\s+", "", params or "")
    p = re.sub(r"^[（(]", "", p)          # 先去掉注解自身的开弧
    out = {"raw": re.sub(r"\s+", "", params or ""), "side": None, "parity": None,
           "offset": None, "letter": None}
    m = re.match(r"^([A-Za-z]?)[（(]([SXZY])(-?\d+(?:\.\d+)?)?", p)
    if m:
        out["letter"] = m.group(1) or None
        out["side"] = {"S": "top", "X": "bottom", "Z": "left", "Y": "right"}[m.group(2)]
        if m.group(3):
            try:
                out["offset"] = float(m.group(3).lstrip("+"))
            except ValueError:
                out["offset"] = None
    else:
        mm = re.search(r"([SXZY])", p)
        if mm:
            out["side"] = {"S": "top", "X": "bottom", "Z": "left", "Y": "right"}[mm.group(1)]
    if out["letter"] == "D":
        out["parity"] = "单页（奇数页）"
    elif out["letter"] == "S":
        out["parity"] = "双页（偶数页）"
    elif out["side"] == "left":
        out["parity"] = "单页（奇数页）*"
    elif out["side"] == "right":
        out["parity"] = "双页（偶数页）*"
    return out


def circled(n: int) -> str:
    """圈码定界（A1…A3）里的 `B<编号>` → 圈码字符。

    实测：正文里连续段落写作 B11、B12、B13、B14、B15，对应 ①②③④⑤
    （现代文阅读的段落号），故 B11→①、B20→⑩、B21→⑪。
    """
    if n >= 11:
        idx = n - 11
        return chr(0x2460 + idx) if idx < 20 else f"({n - 10})"
    return f"⟨B库符号 {n}⟩"


# ---------------- 宏展开（实现见 macros.py，此处复用） ----------------
build_defs = collect_defs


# ---------------- 图片：查找 / 尺寸 / 内嵌 ----------------
_IMG_RASTER = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")
_IMG_CONVERT = (".tif", ".tiff", ".bmp")
_BLANK = "〓"          # A1FE：小样里的空位符，书版输出为空白（成书 PS 中 0 次出现）
RASTERIZE_EPS = True   # 是否用 Ghostscript 把 EPS 栅格化后预览（--no-eps 可关闭）
# 上下注解（SX）里，上半图片上方留出与图片等高的空白（按需求加的上边距，置 False 可关）
SX_TOP_GAP_EQUAL_IMAGE = False
# 上边距只对“横幅类”图片生效（超过此高度说明是整页大图，不再留等图高的空白）
SX_TOP_GAP_MAX_MM = 30.0


# 方框注解(FK)的 <边框说明> → CSS（官方第 6295–6310 行）
#   F 反线｜S 双线｜D 点线｜W **不要线也不占位置**｜K 空边框(无线但占一字宽)｜Q 曲线
#   ＝ 双曲线｜CW 外粗内细｜XW 外细内粗｜H<编号> 花边线｜缺省 正线
_FK_BORDER = {
    "W": "border:0;padding:0;",
    "K": "border:0;padding:0 .5em;",
    "F": "border:1px solid;",
    "S": "border:3px double;",
    "D": "border:1px dotted;",
    "Q": "border:1px solid;",
    "=": "border:3px double;",
    "CW": "border:3px double;",
    "XW": "border:3px double;",
}


def fk_border_css(params: str) -> str:
    """方框注解的 <边框说明> → CSS 边框样式。"""
    m = re.match(r"[（(]\s*(CW|XW|H\d{1,3}|[FSDWKQ=])", params or "", re.I)
    code = m.group(1).upper() if m else ""
    if code.startswith("H"):
        return "border:3px double;"          # 花边线：近似双线
    return _FK_BORDER.get(code, "border:1px solid;")
import threading as _threading
_EPS_SEM = _threading.Semaphore(3)


_IMG_INDEX: dict[str, list[str]] = {}
_IMG_INDEX_STATE = {"root": None, "t": 0.0}


def _image_index(root: str | None) -> dict[str, list[str]]:
    """全工程图片名索引（小写文件名 → 路径列表），带 60 秒缓存。

    小样常被复制到独立文件夹（如交付目录），而图片仍在原书目录里，
    仅靠向上找父目录会漏，因此再建立一次全局索引兜底。
    """
    import time as _time
    if not root:
        return {}
    now = _time.time()
    if (_IMG_INDEX_STATE["root"] == root and _IMG_INDEX
            and now - _IMG_INDEX_STATE["t"] < 60):
        return _IMG_INDEX
    idx: dict[str, list[str]] = {}
    exts = _IMG_RASTER + _IMG_CONVERT + (".eps",)
    for dp, _dns, fns in os.walk(root):
        for fn in fns:
            if os.path.splitext(fn)[1].lower() in exts:
                path = os.path.join(dp, fn)
                names = [fn]
                try:
                    legacy_name = fn.encode("cp437").decode("gb18030")
                    if legacy_name != fn and any("\u3400" <= char <= "\u9fff" for char in legacy_name):
                        names.append(legacy_name)
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
                for name in names:
                    idx.setdefault(name.lower(), []).append(path)
                    idx.setdefault(re.sub(r"\s+", "", name.lower()), []).append(path)
    _IMG_INDEX.clear()
    _IMG_INDEX.update(idx)
    _IMG_INDEX_STATE.update(root=root, t=now)
    return _IMG_INDEX


def _shared_prefix_len(a: str, b: str) -> int:
    a, b = os.path.normcase(os.path.abspath(a)), os.path.normcase(os.path.abspath(b))
    n = 0
    for x, y in zip(a.split(os.sep), b.split(os.sep)):
        if x != y:
            break
        n += 1
    return n


def resolve_image(name: str, fbd_path: str, root: str | None = None,
                  detail: dict | None = None) -> str | None:
    """先按注解相对路径查找，再按文件名回退；回退时取路径最相近者。"""
    raw_name = (name or "").strip()
    if len(raw_name) >= 2 and raw_name[0] == "<" and raw_name[-1] == ">":
        raw_name = raw_name[1:-1]
    d = os.path.realpath(os.path.dirname(os.path.abspath(fbd_path)))
    root_abs = os.path.realpath(root) if root else d

    # 注解可带 Windows 路径；服务端不能访问客户端路径，因此仅尝试包内相对路径。
    normalized = raw_name.replace("\\", "/")
    is_windows_absolute = bool(re.match(r"^[A-Za-z]:/", normalized) or normalized.startswith("//"))
    if normalized and not is_windows_absolute and "/" in normalized:
        parts = [part for part in normalized.split("/") if part not in {"", "."}]
        if parts and ".." not in parts:
            for base in (d, root_abs):
                candidate = os.path.realpath(os.path.join(base, *parts))
                try:
                    if os.path.commonpath([candidate, root_abs]) != root_abs:
                        continue
                except ValueError:
                    continue

                current = root_abs
                try:
                    for part in os.path.relpath(candidate, root_abs).split(os.sep):
                        if part == ".":
                            continue
                        matches = {entry.casefold(): entry for entry in os.listdir(current)}
                        current = os.path.join(current, matches[part.casefold()])
                    if os.path.isfile(current):
                        if detail is not None and os.path.abspath(current) != os.path.abspath(os.path.join(d, *parts)):
                            detail["via_relative_path"] = True
                            detail["path"] = current
                        return current
                except (KeyError, OSError):
                    continue

    clean = re.sub(r"[\s\r\n]+", "", raw_name).replace("\\", "/").rsplit("/", 1)[-1]
    clean = re.split(r"[（(]", clean)[0]
    if len(clean) < 2:
        return None
    if root:
        dirs = [d] if os.path.commonpath([d, root_abs]) == root_abs else [root_abs]
        if root_abs not in dirs:
            dirs.append(root_abs)
    else:
        dirs, cur = [d], d
        for _ in range(3):
            cur = os.path.dirname(cur)
            if cur and cur not in dirs:
                dirs.append(cur)
    low = clean.lower()
    names = ([low] if os.path.splitext(low)[1] else
             [low + e for e in (".eps", ".tif", ".tiff", ".png", ".jpg", ".jpeg", ".gif")])
    for dd in dirs:
        if not os.path.isdir(dd):
            continue
        try:
            raw_files = os.listdir(dd)
        except OSError:
            continue
        files = {f.lower(): f for f in raw_files}
        # 忽略空白再匹配一次（引用名与磁盘名常有空格差异）
        files_ns = {re.sub(r"\s+", "", f.lower()): f for f in raw_files}
        for nm in names:
            hit = files.get(nm) or files_ns.get(re.sub(r"\s+", "", nm))
            if hit:
                return os.path.join(dd, hit)
    idx = _image_index(root)                      # 兜底：全工程索引
    cands: list[str] = []
    for nm in names:
        cands.extend(idx.get(nm, []))
    if cands:
        best = max(cands, key=lambda p: _shared_prefix_len(d, os.path.dirname(p)))
        if detail is not None:                    # 供界面标注“其实取自别处”
            detail["via_index"] = True
            detail["path"] = best
        return best
    return None


def _native_size(path: str) -> tuple[tuple[int, int], tuple[float, float] | None] | None:
    """纯标准库读位图像素与 DPI（Pillow 缺席/打不开时的兜底，参照 CSS_PT_SCALE 的
    显式换算思路：布局尺寸不能取决于可选依赖是否安装）。支持 TIFF/PNG/JPEG/BMP/GIF。"""
    ext = os.path.splitext(path)[1].lower()

    def dpi_from_meter(ppm: float) -> float:
        return ppm * 0.0254 if ppm else 0.0

    try:
        if ext in (".tif", ".tiff"):
            with open(path, "rb") as f:
                head = f.read(8)
                if len(head) < 8 or head[:2] not in (b"II", b"MM"):
                    return None
                bo = "<" if head[:2] == b"II" else ">"
                ifd = struct.unpack(bo + "I", head[4:8])[0]
                f.seek(ifd)
                n = struct.unpack(bo + "H", f.read(2))[0]
                ent = f.read(12 * n)
                if len(ent) < 12 * n:
                    return None
                w = h = 0
                xres = yres = 0.0
                unit = 2

                def rational(off: int) -> float:
                    f.seek(off)
                    a, b = struct.unpack(bo + "II", f.read(8))
                    return a / b if b else 0.0

                for i in range(n):
                    tag, typ, cnt = struct.unpack(bo + "HHI", ent[i * 12:i * 12 + 8])
                    val = ent[i * 12 + 8:i * 12 + 12]
                    if tag == 256:            # ImageWidth（SHORT/LONG 都按数值读）
                        w = struct.unpack(bo + ("H" if typ == 3 else "I"), val[:2 if typ == 3 else 4])[0]
                    elif tag == 257:          # ImageLength
                        h = struct.unpack(bo + ("H" if typ == 3 else "I"), val[:2 if typ == 3 else 4])[0]
                    elif tag == 282:          # XResolution（RATIONAL 存偏移）
                        xres = rational(struct.unpack(bo + "I", val)[0])
                    elif tag == 283:
                        yres = rational(struct.unpack(bo + "I", val)[0])
                    elif tag == 296:          # ResolutionUnit：2=英寸 3=厘米
                        unit = struct.unpack_from(bo + "H", val)[0]
                if not w or not h:
                    return None
                if unit == 3:
                    xres, yres = xres * 2.54, yres * 2.54
                dpi = (xres, yres) if xres and yres else None
                return ((w, h), dpi)
        if ext == ".png":
            with open(path, "rb") as f:
                if f.read(8) != b"\x89PNG\r\n\x1a\n":
                    return None
                f.read(4)                      # IHDR 长度
                if f.read(4) != b"IHDR":
                    return None
                w, h = struct.unpack(">II", f.read(8))
                f.seek(9, 1)                   # 跳过 IHDR 剩余 5 字节与 CRC
                dpi = None
                while True:                    # pHYs 在 IDAT 前，头部几个块内就能读到
                    hdr = f.read(8)
                    if len(hdr) < 8:
                        break
                    clen, ctype = struct.unpack(">I4s", hdr)
                    if ctype == b"pHYs":
                        ppu_x, ppu_y = struct.unpack(">II", f.read(8))
                        dpi = (dpi_from_meter(ppu_x), dpi_from_meter(ppu_y)) \
                            if struct.unpack(">B", f.read(1))[0] == 1 else None
                        break
                    f.seek(clen + 4, 1)        # 跳过数据与 CRC
                return ((w, h), dpi)
        if ext in (".jpg", ".jpeg"):
            data = open(path, "rb").read()
            if data[:2] != b"\xff\xd8":
                return None
            i, w, h, dpi = 2, 0, 0, None
            while i + 4 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3):   # SOF：精度(1) 高(2) 宽(2)
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    break
                if marker == 0xE0 and data[i + 4:i + 9] == b"JFIF\x00":  # APP0 JFIF
                    units = data[i + 11]
                    dx, dy = struct.unpack(">HH", data[i + 12:i + 16])
                    if units == 1:
                        dpi = (float(dx), float(dy))
                    elif units == 2:                    # 点/厘米
                        dpi = (dx * 2.54, dy * 2.54)
                i += 2 + seg_len
            return ((w, h), dpi) if w and h else None
        if ext == ".bmp":
            with open(path, "rb") as f:
                if f.read(2) != b"BM":
                    return None
                f.read(12)                     # 文件头其余：大小/保留/位图数据偏移
                head = f.read(40)              # BITMAPINFOHEADER
                if len(head) < 40:
                    return None
                w = abs(struct.unpack("<i", head[4:8])[0])
                h = abs(struct.unpack("<i", head[8:12])[0])
                ppm_x, ppm_y = struct.unpack("<ii", head[24:32])   # biXPelsPerMeter/biYPelsPerMeter
                dpi = (dpi_from_meter(ppm_x), dpi_from_meter(ppm_y)) if ppm_x and ppm_y else None
                return ((w, h), dpi) if w and h else None
        if ext == ".gif":
            with open(path, "rb") as f:
                if f.read(4) != b"GIF8":
                    return None
                f.read(2)                      # 版本号
                w, h = struct.unpack("<HH", f.read(4))
                return ((w, h), None) if w and h else None
    except Exception:
        return None
    return None


def image_size_mm(path: str, det: dict | None = None) -> tuple[float, float] | None:
    """图片自身尺寸（mm）：EPS 读 %%BoundingBox，位图读像素+DPI。

    Pillow 可用则用 Pillow；缺席或打不开时回退到标准库解析（_native_size），
    保证布局尺寸不随运行环境浮动。det 可选收集：via（PIL/stdlib）、
    dpi（实测值或 None）、dpi_assumed（未标注 DPI 按 96 估算时为 True）。
    """
    ext = os.path.splitext(path)[1].lower()
    if det is None:
        det = {}
    try:
        if ext == ".eps":
            with open(path, 'rb') as stream:
                head = stream.read(16384)
                stream.seek(max(0, os.path.getsize(path) - 16384))
                head += stream.read()
            head = head.decode('latin-1', errors='replace')
            m = re.search(r"%%HiResBoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)", head)
            m = m or re.search(r"%%BoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)", head)
            if m:
                x0, y0, x1, y1 = (float(v) for v in m.groups())
                return ((x1 - x0) * 25.4 / 72, (y1 - y0) * 25.4 / 72)
            return None
        px = dpi = None
        try:
            from PIL import Image
            with Image.open(path) as im:
                px = (im.width, im.height)
                raw = im.info.get("dpi")
                if isinstance(raw, tuple):
                    dpi = (float(raw[0]), float(raw[1])) if len(raw) > 1 else (float(raw[0]),) * 2
                elif raw:
                    dpi = (float(raw),) * 2
            det["via"] = "PIL"
        except ImportError:
            nat = _native_size(path)
            if not nat:
                return None
            px, dpi = nat
            det["via"] = "stdlib"
        except Exception:
            nat = _native_size(path)           # Pillow 装了但打不开（异形 TIFF 等）
            if not nat:
                return None
            px, dpi = nat
            det["via"] = "stdlib"
        if not px or not px[0] or not px[1]:
            return None
        if not dpi or not dpi[0] or not dpi[1]:
            dpi = (96.0, 96.0)
            det["dpi_assumed"] = True
        det["dpi"] = dpi
        return (px[0] / dpi[0] * 25.4, px[1] / dpi[1] * 25.4)
    except Exception:
        return None


def _find_ghostscript() -> str | None:
    """定位 Ghostscript（Pillow 需要一个明确的 gs 路径才能栅格化 EPS）。"""
    if getattr(_find_ghostscript, "_cached", "unset") != "unset":
        return _find_ghostscript._cached
    import shutil
    import glob as _glob
    found = None
    for exe in ("gswin64c", "gswin32c", "gs"):
        p = shutil.which(exe)
        if p:
            found = p
            break
    if not found:
        pats = [r"C:\Program Files\gs\*\bin\gswin64c.exe",
                r"C:\Program Files (x86)\gs\*\bin\gswin64c.exe",
                r"C:\Program Files\gs\*\bin\gswin32c.exe",
                "/usr/bin/gs", "/usr/local/bin/gs"]
        for pat in pats:
            hits = sorted(_glob.glob(pat))
            if hits:
                found = hits[-1]
                break
    _find_ghostscript._cached = found
    return found


def _cache_path(path: str, max_px: int) -> str | None:
    import hashlib
    import tempfile
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = f"{os.path.abspath(path)}|{st.st_mtime_ns}|{st.st_size}|{max_px}"
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
    d = os.path.join(tempfile.gettempdir(), "fbdview-imgcache")
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        # A cache is optional; an unwritable temp directory must not abort HTTP.
        return None
    return os.path.join(d, h + ".png")


def rasterize(path: str, max_px: int = 900) -> bytes | None:
    """把 EPS/位图转成 PNG 字节（带磁盘缓存）。EPS 走 Ghostscript。"""
    cached = _cache_path(path, max_px)
    if cached and os.path.exists(cached):
        try:
            return open(cached, "rb").read()
        except OSError:
            pass
    ext = os.path.splitext(path)[1].lower()
    if ext == ".eps":
        if not RASTERIZE_EPS:
            return None
        # Ghostscript 是子进程，限制并发，避免整页 40 张图同时起 40 个进程
        with _EPS_SEM:
            return _rasterize_uncached(path, max_px, cached)
    return _rasterize_uncached(path, max_px, cached)


def _rasterize_uncached(path: str, max_px: int, cached: str | None) -> bytes | None:
    try:
        import io as _io
        from PIL import Image
        ext = os.path.splitext(path)[1].lower()
        if ext == ".eps":
            from PIL import EpsImagePlugin
            gs = _find_ghostscript()
            if not gs:
                return None
            if os.name == "nt":
                EpsImagePlugin.gs_windows_binary = gs
            else:
                EpsImagePlugin.gs_binary = gs
            with Image.open(path) as im:
                try:
                    im.load(scale=2)
                except Exception:
                    im.load()
                im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
                if max(im.size) > max_px:
                    r = max_px / max(im.size)
                    im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))),
                                   Image.LANCZOS)
                buf = _io.BytesIO()
                im.save(buf, "PNG", optimize=True)
        else:
            with Image.open(path) as im:
                im.load()
                if max(im.size) > max_px:
                    r = max_px / max(im.size)
                    im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))),
                                   Image.LANCZOS)
                buf = _io.BytesIO()
                im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB") \
                  .save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        if cached:
            try:
                open(cached, "wb").write(data)
            except OSError:
                pass
        return data
    except Exception:
        return None


def image_data_uri(path: str, max_px: int = 900) -> str | None:
    """图片 → 可内嵌的 data URI（EPS 经 Ghostscript 栅格化，TIFF 一并转 PNG）。"""
    import base64
    ext = os.path.splitext(path)[1].lower()
    if ext in (".eps",) or ext in _IMG_CONVERT:
        data = rasterize(path, max_px)
        if not data:
            return None
    else:
        try:
            data = open(path, "rb").read()
        except OSError:
            return None
        if len(data) > 1_500_000:
            data = rasterize(path, max_px)
            if not data:
                return None
    if len(data) > 1_800_000:
        return None
    mime = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else \
           ("image/jpeg" if data[:2] == b"\xff\xd8" else "application/octet-stream")
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def _params_filename(params: str) -> str:
    return re.sub(r"[\s\r\n]+", "", re.split(r"[;；,，]", params or "")[0])


def parse_pic_params(params: str) -> dict:
    """按官方公式解析 TP/PS/XC 的图片参数。

    官方：
      PS: [PS<文件名>[,@][,<占位尺寸>][;<实体尺寸>][;S/;X/;Z/;Y<边空>][<起点>][<排法>][#]%;<旋转度>]
      XC: [XC<文件名>[,@][,<占位尺寸>][;<实体尺寸>][边空][基线位置]{;C|;P<旋转度>}]
      <尺寸> = <高>[。<宽>]；<排法> = PZ|PY|BP；<起点> = (高,宽) | ZS/ZX/YS/YX/S/X/Z/Y

    实测（成书 PS 佐证）：`〖PSZBW新，+10mm。265mm，BP〗` 里 10/265 是**占位尺寸**，
    书版按图片自身方向出图（PS 中该图放置框约 34.6×266mm，旋转量为 0），
    因此占位框只用来预留版面，不能当作图片的显示尺寸。
    """
    p = re.sub(r"[\s\r\n]+", "", params or "")
    out: dict = {"raw": p, "file": _params_filename(params)}
    m = re.search(r"[,，]\+?([\d.]+)(mm|p|x)?[。.]([\d.]+)(mm|p|x)?", p)
    if m:                                   # 占位尺寸：<高>。<宽>
        out["box_h"] = float(m.group(1))
        out["box_w"] = float(m.group(3))
        out["box_unit"] = m.group(2) or m.group(4) or "mm"
    m = re.search(r";\s*E([\d.]+)(?:mm)?(?:[。.]([\d.]+)(?:mm)?)?", p)
    if m:                                   # 实体尺寸：E<高>[。<宽>]
        out["ent_h"] = float(m.group(1))
        out["ent_w"] = float(m.group(2)) if m.group(2) else None
    m = re.search(r"[;；]\s*P(\d+(?:\.\d+)?)?", p)
    if m:                                   # XC 的 `;P`＝插入 EPS 文件（可带旋转度）
        out["eps_marker"] = True
        if m.group(1):
            out["rotate"] = float(m.group(1))
    if re.search(r"[;；]\s*C(W)?", p):       # XC 的 `;C`＝插入 CR 文件
        out["cr_marker"] = True
    m = re.search(r"[,，]\s*(SQ|XQ|JZ)", p)
    if m:                                   # XC 的 <基线位置>：SQ 上齐 / XQ 下齐 / JZ 居中
        out["baseline"] = m.group(1)
    m = re.search(r"%\s*([\d.]+)\s*%\s*([\d.]+)", p)
    if m:                                   # 缩放比例 %%X%Y
        out["scale_x"], out["scale_y"] = float(m.group(1)) / 100, float(m.group(2)) / 100
    m = re.search(r"[,，](BP|PZ|PY)\b", p)
    if m:
        out["flow"] = m.group(1)
    m = re.search(r"[,，](ZS|ZX|YS|YX|S|X|Z|Y)\b", p)
    if m:
        out["anchor"] = m.group(1)
    m = re.search(r"\(([-—]?[\d.]+)mm?[,，]([-—]?[\d.]+)mm?\)", p)
    if m:                                   # 起点坐标 (高,宽)
        out["start_h"] = float(m.group(1).replace("—", "-"))
        out["start_w"] = float(m.group(2).replace("—", "-"))
    for key, code in (("space_top", "S"), ("space_bottom", "X"),
                      ("space_left", "Z"), ("space_right", "Y")):
        m = re.search(rf"[;；]{code}([-—]?)[+]?([\d.]+)(mm|p|x)?", p)
        if m:
            out[key] = float(m.group(2)) * (-1 if m.group(1) else 1)
            out[key + '_unit'] = m.group(3) or 'x'
    return out


# ---------------- 近似排版渲染 ----------------
class PreviewRenderer:
    """近似排版状态机。关键量：字号(双向)、行高(=字高+行距)、三通道颜色、着重符。"""

    def __init__(self, dec, geo: Geometry, fbd_path: str = "", root: str | None = None,
                 inline: bool = False, join_lines: bool = False):
        self.dec = dec
        self.geo = geo
        self.fbd_path = fbd_path
        self.root = root
        self.inline = inline          # True=单文件 HTML（图片内嵌 data URI）
        # True：CRLF 视为小样编辑器的排版换行（续行，不输出换行），只认 A4/A5 换行
        self.join_lines = join_lines
        self.joint = join_lines
        self.script_next: str | None = None  # AC/AD 后的单个上标/下标字符
        self.script_groups: list[str | None] = []
        self.bg_open = False          # 处于 〖BJ…〗 背景块内（整块内容进背景层）
        self.bp_buf: list[str] | None = None   # 〖BP(…〗块暂存（闭弧后判定参数块/内容）
        self.bg_parts: list[str] = []  # 背景层内容
        self.bw: dict | None = None   # 当前边文块（BW）的解析结果
        self.bw_parts: list[str] = []  # 边文层内容（绝对定位到页边）
        self.bw_groups: dict[tuple, int] = {}   # (边别, 页别) → 全文出现次数
        self.bw_tag_pos: dict[tuple, int] = {}  # 该组标签在 bw_parts 中的下标
        self.bw_suppress = False      # 当前边文块是重复声明（只计数、不显示）
        self.bw_depth = 0             # >0 表示正在边文块内（内容进边文层）
        self.bw_index = 0
        self.base = geo.base_pt or 10.5
        self.base_h = geo.base_pt_h or self.base
        self.context = load_context(fbd_path, geo.pro_path) if fbd_path else None
        fonts = (self.context.bx.get("base_fonts", "") if self.context else "").replace("＆", "&").split("&")
        self.fonts = FontState(self.base, self.base_h, geo.base_font or "SS",
                               fonts[1] if len(fonts) > 1 else "BZ",
                               fonts[2] if len(fonts) > 2 else "BZ",
                               self.context.aliases if self.context else None)
        self.jp = 0
        self.layer_states = []
        self.paragraph_indent = 2 * mm_of(self.base_h)
        self.indent_next = False
        self.bp_depth = 0
        self.source_line = 1
        self.source_offset = 0
        self.tables = []
        self.layout_warnings = set()
        self.block_finished = False
        self.line_has_content = False
        self.title = None
        self.line_align = False
        self.line_align_has_image = False
        self.image_caption_open = False
        self.captures = []
        self.last_image_ref = None
        self.ts_state = None
        self.note_count = 0
        self.prelude = []
        self.saw_fl = False
        self.region_open = False
        self.size = self.base
        self.size_h = self.base_h
        self.family = geo.base_font or "SS"   # 方正汉字字体代号（缺省＝版心字体）
        # 外挂字体（官方 HT 的《…》）：GBK 字符用它，书版特有符号仍用方正字体
        self.ext_font: str | None = None
        self.ext_bold = False
        self.ext_italic = False
        # 官方：行距为行间空隙，行高 = 字高 + 行距；字号变了要重算
        self.gap = geo.line_gap_mm if geo.line_gap_mm is not None else 3.0
        self.lh = geo.line_pitch_mm or round(mm_of(self.size) + self.gap, 3)
        self.decor: list[str] = []          # 成对着重
        self.pending_zz: tuple[int, str, bool] | None = None   # (剩余字数, 着重符, 是否在上)
        self.color: str | None = None       # 字符颜色（CS）
        self.rule_color: str = "#000"       # 框线颜色（CSX）
        self.shade: str | None = None       # 底纹颜色（CSD）
        self.reverse = False
        self.align = None
        self.hang = 0
        self.box = 0
        self.box_tags = []
        self.bg_open = False          # 处于 〖BJ…〗 背景块内（整块内容进背景层）
        self.pending_circle: str | None = None
        self.group_depth = 0
        # 居右（状态式 〖JY。…〗）：手册 [JY〔。|D<符号>〕[，<后空字距>]] 无闭合，
        # 语义是“本行注解之后的内容顶到右端、中间用三连点充满”，因此按“行”收尾。
        self.jy: dict | None = None
        # 上下注解（SX）：上半/下半内容分别暂存，闭弧时叠排输出
        self.sx: dict | None = None
        self.parts: list[str] = []

    # ---- 样式 ----
    def _style(self) -> str:
        s = [f"font-size:{self.size * CSS_PT_SCALE:g}pt",
             f"font-family:{family_css(self.family, self.ext_font)}",
             f"line-height:{self.lh:g}mm"]
        if self.ext_font:                     # 外挂字体效果 `#B`/`#I`
            if self.ext_bold:
                s.append("font-weight:700;")
            if self.ext_italic:
                s.append("font-style:italic;")
        s.extend(self.decor)
        if self.shade:
            s.append(f"background:{self.shade};")
        if self.reverse:
            s.append("background:#000;color:#fff;padding:0 .15em;")
        elif self.color:
            s.append(f"color:{self.color};")
        return ";".join(x for x in s if x)

    _DIGIT_RUN = re.compile(r"\d+(?:\.\d*)*\.?")   # 1 / 1.5 / 1.8. 整段归数字字体

    def _digit_segments(self, text):
        """切成 (start,end) 段：数字串（含紧随的 '.'，如 1. / 1.5 / 150.）整体走
        ST 数字字体，避免书版里“1.”的点和数字字体不一致；其余字符逐个判定。"""
        segs = []
        pos = 0
        for m in self._DIGIT_RUN.finditer(text):
            if m.start() > pos:
                segs.append((pos, m.start()))
            segs.append((m.start(), m.end()))
            pos = m.end()
        if pos < len(text):
            segs.append((pos, len(text)))
        return segs

    def _text_runs(self, text, extra=""):
        out = []
        for start, end in self._digit_segments(text):
            chunk = text[start:end]
            for channel, group in __import__('itertools').groupby(chunk, lambda c: self.fonts.select(c)[0]):
                value = ''.join(group)
                _, font = self.fonts.select(value[0])
                # Decorations and colours belong to all three channels.
                css = self.fonts.css(font, self.gap) + ';' + ';'.join(self.decor) + ';' + extra
                if self.reverse:
                    css += f';background:{self.shade or "#000"};color:#fff'
                elif self.color:
                    css += f';color:{self.color}'
                # The guide specifies 1..32 levels, but no physical pitch table.
                # 1 is English only. This configurable approximation is disclosed in the UI.
                if self.jp and (abs(self.jp) != 1 or channel == 'WT'):
                    css += f';letter-spacing:{self.jp / 128:g}em'
                attrs = f'data-channel="{channel}" data-line="{self.source_line}" data-offset="{self.source_offset}"'
                if self.color:
                    attrs += f' data-color="{self.color}"'   # 颜色清单/按色隐藏的定位钩子
                if abs(font.horizontal - font.vertical) > .001:
                    ratio = font.horizontal / font.vertical
                    # Reserve the scaled advance as well as scaling the glyph; transform alone loses width.
                    for ch in value:
                        width = font.horizontal * CSS_PT_SCALE * (0.5 if ch.isascii() else 1)
                        out.append(f'<span {attrs} data-atomic="glyph" style="{css};display:inline-block;width:{width:g}pt">'
                                   f'<span style="display:inline-block;transform-origin:left baseline;transform:scaleX({ratio:g})">'
                                   f'{self._render_text(ch)}</span></span>')
                else:
                    content = self._render_text(value)
                    if channel == 'HT' and not font.external:
                        # Built-in book typography uses half-body punctuation. External
                        # fonts retain their own advances (guide §9.2 HT).
                        # Opening brackets/quotes draw in the RIGHT half of the em:
                        # shrink the empty LEFT half (margin-left), otherwise the
                        # trailing text would be pulled onto the glyph.
                        content = re.sub(r'[（《〈【「‘“]', lambda m: '<span class="book-punct" style="margin-left:-0.5em">'+m.group(0)+'</span>', content)
                        # Closing brackets/quotes and centered marks draw in the
                        # LEFT half: shrink the empty RIGHT half (letter-spacing).
                        content = re.sub(r'[）》〉】」』’”，。、；：？！]', lambda m: '<span class="book-punct" style="letter-spacing:-0.5em">'+m.group(0)+'</span>', content)
                    out.append(f'<span {attrs} style="{css}">{content}</span>')
        return ''.join(out)

    def _render_text(self, s: str) -> str:
        """转义文本，并把 〓 空位符转成等宽空白（书版输出为空白，不该显示出符号）。"""
        out = html.escape(s)
        for placeholder, (kind, label) in self.dec.marks.items():
            if kind == "unknown":
                tip = html.escape(f"Unknown FBD byte {label.upper()}; see structure and report", quote=True)
                replacement = f'<sup class="unk" title="{tip}">•</sup>'
            else:
                replacement = html.escape(self.dec.mark_display(placeholder))
            out = out.replace(placeholder, replacement)
        return re.sub(_BLANK + "+",
                      lambda m: f'<span style="display:inline-block;width:{len(m.group(0))}em"></span>',
                      out)

    def text(self, s: str) -> None:
        if not s or s == "\n":
            return
        # A centered XC image group ends before its following caption; adjacent images stay grouped.
        if self.line_align and self.line_align_has_image and not self.ts_state and s.strip():
            self._emit('</div>')
            self.line_align = False
            self.line_align_has_image = False
            self.indent_next = False
            self._emit('<div class="fbd-image-caption">')
            self.image_caption_open = True
        if self.pending_circle is not None:
            self.pending_circle += s
            return
        if self.indent_next:
            self._emit(f'<span class="paraindent" style="display:inline-block;width:{self.paragraph_indent:g}mm"></span>')
            self.indent_next = False
        if self.script_next:
            script, self.script_next = self.script_next, None
            char, s = s[0], s[1:]
            # AC is shared by math exponents and footnote circles in the source corpus.
            if script == "AC" and char in "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳":
                self._emit(f'<sup class="refmark" title="注号">{char}</sup>')
            else:
                position = "super" if script == "AC" else "sub"
                css = f'font-size:70%;vertical-align:{position};line-height:0'
                self._emit(self._text_runs(char, css))
            if not s:
                return
        rest = s
        while self.pending_zz and rest:
            n, flag, above = self.pending_zz
            head, rest = rest[:n], rest[n:]
            self._emit(self._text_runs(head, zz_css(flag, above)))
            n2 = n - len(head)
            self.pending_zz = (n2, flag, above) if n2 > 0 else None
        if rest:
            self._emit(self._text_runs(rest))

    # ---- 主循环 ----
    def run(self, tokens) -> str:
        self.parts = []
        self.regional_layout = sum(t.name=='FL' and t.params.startswith(('(', '（')) for t in tokens)>1
        for t in tokens:
            self.source_line, self.source_offset = t.line, t.offset
            if t.kind == 'annot' and t.name == 'BP':
                if t.params.startswith(('(', '（')):
                    self.bp_depth += 1
                elif t.params.startswith((')', '）')):
                    self.bp_depth = max(0, self.bp_depth - 1)
                continue
            if self.bp_depth:
                continue
            if t.kind == 'annot' and t.name == 'FL' and not self.saw_fl and t.params.startswith(('(', '（')) and not (self.tables or self.sx or self.bw_depth or self.captures):
                self._jy_flush()
                if self.line_align:
                    self._emit('</div>')
                    self.line_align = False
                self.prelude, self.parts = self.parts, []
                self.saw_fl = True
            if t.kind == "newline":
                # 小样里的 CRLF 只是编辑器的排版换行；书版只认 A4(换行符)/A5(换段符)。
                # 文件若普遍使用 A4/A5 约定，就忽略 CRLF（让文字按栏宽自然折行）。
                pass  # Physical editor line endings never affect Bookmaker output.
            elif t.kind == "ctrl":
                self._ctrl(t)
            elif t.kind == "text":
                self.text(t.raw)
            else:
                self._annot(t)
        if self.ts_state:
            self._emit('</figcaption></figure>' if self.ts_state['wrapped'] else '</div>')
            self.ts_state = None
            self.layout_warnings.add('未闭合的 TS 图说已收口')
        if self.image_caption_open:
            self._emit('</div>')
            self.image_caption_open = False
        self._jy_flush()
        if self.line_align:
            self._emit('</div>')
            self.line_align = False
        if self.title:
            self._end_title()
        while self.tables:
            self._table_row_end()
            table = self.tables.pop()
            self.layout_warnings.add('未闭合的表格已收口')
            self._emit('<table class="fbdtable"><tbody>' + ''.join(table['rows']) + '</tbody></table>')
        if self.region_open:
            self._emit('</div>')
            self.region_open = False
        return "".join(self.parts)

    def _ctrl(self, t) -> None:
        code = t.raw
        if code in ("A4", "A5"):
            if self.image_caption_open:
                self._emit('</div>')
                self.image_caption_open = False
            self.script_next = None
            if self.line_align:
                self._emit('</div>')
                self.line_align = False
            if self.title and not self.title['paired']:
                self._end_title()
            self._jy_flush()            # 状态式居右只作用于当前一行
            if not self.block_finished:
                if not self.line_has_content:
                    self._emit(f'<span class="blank-line" style="display:inline-block;width:0;height:{self.lh:g}mm;vertical-align:top"></span>')
                self._emit(f'<br style="font-size:{self.size * CSS_PT_SCALE:g}pt;line-height:{self.lh:g}mm">')
            self.block_finished = False
            self.line_has_content = False
            self.indent_next = code == 'A5'
        elif code == "A1":
            self.pending_circle = ""
        elif code == "A3":
            if self.pending_circle is not None:
                m = re.match(r"B(\d+)", self.pending_circle.strip())
                label = circled(int(m.group(1))) if m else self.pending_circle.strip()
                self._emit(self._text_runs(label))
                self.pending_circle = None
        elif code in ("A9", "AA"):
            if code == 'A9':
                script, self.script_next = self.script_next, None
                self.script_groups.append(script)
                if script:
                    position = "super" if script == "AC" else "sub"
                    self._emit(f'<span class="math-script" style="font-size:70%;vertical-align:{position};line-height:0">')
                self.group_depth += 1
                self._emit('<span class="boxgroup" data-atomic="group" style="white-space:nowrap">')
            elif self.group_depth:
                self.group_depth -= 1
                self._emit('</span>')
                script = self.script_groups.pop() if self.script_groups else None
                if script:
                    self._emit('</span>')
        elif code in ("AC", "AD"):
            self.script_next = code
        elif code == "A6":
            self._emit('<span class="eof">文件结束符</span>')
        elif code == "A8":
            pass                               # 宏参数占位符，展开阶段已处理
        else:
            # 其它书版 10.0 用户区字节：预览里只给一个极不显眼的标记，
            # 具体编码与出现位置请看“结构视图/统计”（避免正文里冒出 “AC” 之类的代码）
            self._emit(
                f'<sup class="unk" title="书版用户区字节 AA{code}（详见结构视图与统计报告）">•</sup>')

    # 会开/闭结构块（<div>、框、分栏、层）的注解：其前必须先把居右行收尾，
    # 否则块级元素会被塞进居右行的右半里（嵌套不合法）
    _JY_BREAK = frozenset({"JZ", "JY", "ZK", "BG", "BH", "FL", "FK", "SX", "BW", "BJ", "BP",
                           "TP", "TS", "XC", "ML", "LM", "LL", "ZD", "BT", "ZW"})

    def _annot(self, t) -> None:
        n, p = t.name, t.params
        if n == "(空注解)":
            if self.sx is not None and self.sx["phase"] == "up":
                self.sx["phase"] = "down"     # SX 里 〖〗 是“上半/下半”的分界
                return
            if self.tables:
                self._jy_flush()
                self.tables[-1]['cell'] += 1
                self.tables[-1]['content'].append([])
            return                       # 其余空注解 〖〗 在书版中不产生任何输出，预览不显示
        if n in self._JY_BREAK:
            self._jy_flush()
        if self.line_align and n in ('BG','ZB','BW','BJ','SX','FL'):
            if n == 'SX':
                self.sx_center_next = True
            self._emit('</div>')
            self.line_align = False
        if n == 'BM':
            self._emit('<span class="dynamic-page">' + self._text_runs('1') + '</span>')
            return
        if n == 'FL' and self.saw_fl and self.regional_layout and not (self.tables or self.sx or self.bw_depth or self.captures):
            if self.region_open:
                self._emit('</div>')
            opening = p.startswith(('(', '（'))
            mode = 'columns' if opening else 'full'
            self._emit(f'<div class="flow-region" data-mode="{mode}" data-columns="{self.geo.columns if opening else 1}" data-start-page="{0 if opening or "X" in p.upper() else 1}">')
            self.region_open = True
            self.block_finished = False
            self.line_has_content = False
            return
        if n in ('LL', 'LM'):
            # LM=另面（新页起排）、LL=另栏（新栏起排）。本项目 15 份试卷均以
            # 〖LM〗〖FL）0〗收卷，成品 PDF 中下一卷全部从页首开始，可证 LM 是页级换页。
            brk = 'page' if n == 'LM' else 'column'
            self._emit(f'<span data-atomic="break" data-break="{brk}" style="display:block;break-before:column;width:.01px;height:.01px"></span>')
            if n == 'LM':
                self.layout_warnings.add('LM 另面：下一卷从新页起排（溢出行会留在近空页上）')
            return
        if n == 'CT':
            import copy
            if p.startswith(('(', '（')):
                self.captures.append({'parts':[], 'fonts':copy.deepcopy(self.fonts), 'gap':self.gap, 'params':p})
            elif p.startswith((')', '）')) and self.captures:
                capture = self.captures.pop()
                content = ''.join(capture['parts'])
                if '#' not in capture['params']:
                    self._emit(content)
                self._emit('<span class="header-anchor" data-atomic="header"><template>' + content + '</template></span>')
            else:
                self.layout_warnings.add('CT 单字符词条抽取尚未实现')
            return
        if n == 'TS':
            if p.startswith((')', '）')) and self.ts_state:
                wrapped = self.ts_state['wrapped']
                closing = '</figcaption></figure>' if wrapped else '</div>'
                self._emit(closing)
                self.ts_state = None
                if wrapped and self.line_align:
                    self._emit('</div>')
                    self.line_align = False
                    self.line_align_has_image = False
            elif p.startswith(('(', '（')) and not self.ts_state:
                align_match = re.search(r'([LMR])!?$', p)
                align = {'L': 'left', 'M': 'center', 'R': 'right'}.get(
                    align_match.group(1) if align_match else 'L', 'left')
                caption_style = f'text-align:{align};'
                if '!' in p:
                    caption_style += 'writing-mode:vertical-rl;'
                target = self._target_list()
                image_ref = self.last_image_ref
                wrapped = bool(image_ref and image_ref[0] is target
                               and image_ref[1] == len(target) - 1)
                if wrapped:
                    image = target[image_ref[1]]
                    target[image_ref[1]] = (
                        '<figure class="fbd-figure" title="TS 图说注解：图题排在图片下方">'
                        + image + f'<figcaption style="{caption_style}">'
                    )
                else:
                    self.layout_warnings.add('TS 图说未紧跟可识别的图片，按独立图题显示')
                    self._emit(f'<div class="fbd-figcaption" style="{caption_style}">')
                if re.search(r'[ZY]', p):
                    self.layout_warnings.add('TS 图片左右侧排法暂按图片下方近似')
                self.ts_state = {'wrapped': wrapped}
            return
        if n == 'BT':
            if p.startswith((')', '）')):
                self._end_title()
            else:
                m = re.match(r'[（(]?(\d)',p)
                spec = self.context.headings.get(m.group(1)) if m and self.context else None
                if spec:
                    import copy
                    self.title = {'fonts':copy.deepcopy(self.fonts), 'paired':p.startswith(('(', '（'))}
                    old_pitch = self.lh
                    values = spec['fonts'].replace('＆','&').split('&')
                    self.fonts.apply('HT',values[0])
                    for key,value in zip(('WT','ST'),values[1:]): self.fonts.apply(key,value)
                    self._emit(f'<div class="pro-title" style="min-height:{spec["lines"] * old_pitch:g}mm;text-align:center;break-inside:avoid">')
                else:
                    self.layout_warnings.add('BT 缺少对应 BD 定义')
            return
        if n == 'ZW':
            import copy
            if p.startswith(('(', '（')):
                self.captures.append({'parts':[], 'fonts':copy.deepcopy(self.fonts), 'gap':self.gap})
                definition = self.context.settings.get('ZS',['6SS'])[0] if self.context else '6SS'
                values = re.split('[＆&]', re.split('[,，]', definition)[0])
                self.fonts.apply('HT',values[0])
                self.gap = .8
            elif p.startswith((')', '）')) and self.captures:
                capture = self.captures.pop()
                self.fonts, self.gap = capture['fonts'], capture['gap']
                self.note_count += 1
                content = ''.join(capture['parts'])
                self._emit(f'<sup class="footnote-anchor" data-note="{self.note_count}">{self.note_count}<template>{content}</template></sup>')
                self.layout_warnings.add('脚注按整页预留区近似；复杂编号和拆页规则尚未实现')
            return
        # ---- 字体字号 ----
        if n in ("HT", "WT", "ST"):
            self.fonts.apply(n, p)
            f = self.fonts.fonts['HT']
            self.size, self.size_h, self.family = f.vertical, f.horizontal, f.code
            self.ext_font, self.ext_bold, self.ext_italic = f.external, f.bold, f.italic
            self.lh = round(mm_of(self.size) + self.gap, 3)
            return
        if n == 'SJ':
            from .layout import _to_mm
            if not p:
                self.paragraph_indent = 2 * mm_of(self.base_h)
            elif p.startswith('J'):
                value = _to_mm(p[1:], self.size_h)
                if value is not None:
                    self.paragraph_indent = value
            else:
                m = re.fullmatch(r'(\d+[\"”]?)(?:。(\d+))?', p)
                if m:
                    from .sizes import parse_size
                    self.paragraph_indent = mm_of(parse_size(m.group(1))) * int(m.group(2) or 2)
            return
        # ---- 行距：行高 = 字高 + 行距 ----
        if n == "HJ":
            from .layout import _to_mm
            gap = _to_mm(p, self.size) if p else (self.geo.line_gap_mm if self.geo.line_gap_mm is not None else 3)
            if gap is not None:
                self.gap = gap
                self.lh = round(mm_of(self.size) + gap, 3)
            return
        # ---- 上下注解（SX）：上半/下半叠排；`〖〗` 是两半的分界 ----
        if n == "SX":
            if p.startswith(("(", "（")):
                self._sx_open(p)
            elif p.startswith((")", "）")):
                self._sx_close()
            return
        # ---- 空格注解：mm/p/x 用绝对值，其余按字宽 ----
        if n == "KG":
            from .layout import _to_mm
            negative = p.startswith('-')
            distance = _to_mm(p.lstrip('-+'), self.size_h)
            if distance is not None:
                style = f'margin-left:-{distance:g}mm;width:0' if negative else f'width:{distance:g}mm'
                self._emit(f'<span style="display:inline-block;{style}"></span>')
            return
        # ---- 空行注解：KH[-]<参数>[X|D]，负号=向排版反方向（压缩） ----
        if n == "KH":
            from .layout import _to_mm
            expr = p.rstrip('XD').strip()
            neg = expr.startswith('-')
            expr = expr.lstrip('-+')
            off = _to_mm(expr, self.size)
            if off is not None:
                if neg:
                    self._emit(f'<div class="khspace" style="height:.001mm;margin-bottom:-{off:g}mm"></div>')
                else:
                    self._emit(f'<div class="khspace" style="height:{off:g}mm"></div>')
                # KH changes spacing; the following explicit A4 still advances
                # a line. Treating its div as a completed text block lost that advance.
                self.block_finished = False
                self.line_has_content = False
            return
        # ---- 紧排 ----
        if n == "JP":
            m = re.fullmatch(r'([+＋]?)(\d+)', p.strip())
            self.jp = min(32, int(m.group(2))) * (1 if m.group(1) else -1) if m else 0
            return
        # ---- 居中 / 居右 ----
        if n in ("JZ", "JY"):
            if p.startswith(("(", "（")):
                self.align = "center" if n == "JZ" else "right"
                self._emit(f'<div style="text-align:{self.align}">')
            elif p.startswith((")", "）")):
                if self.align:
                    self._emit("</div>")
                self.align = None
            elif p.startswith("。"):
                # 状态式居右（无闭合）：本行后续内容顶到右端，中间三连点填满。
                # 官方目录小样：〖HT5H〗第一单元综合评价〖JY。〗〖HTSS〗1  → 标题……1
                self._jy_open()
            elif n == 'JZ' and not p and not (self.sx or self.tables or self.bg_open or self.bw_depth or self.captures):
                if self.line_align:
                    self._emit('</div>')
                self._emit('<div class="alignline" style="text-align:center">')
                self.line_align = True
                self.line_align_has_image = False
            return
        # ---- 自空（〖ZK(〗悬挂缩进开 / 〖ZK)〗闭） ----
        # 小样里「题号 + 〖ZK(〗」成对出现（如 1.〖ZK(〗、）（1）〖ZK(〗、(1)〖ZK(〗），
        # 书版是“从当前位置接着排、后续行悬挂缩进”。若直接把 ZK 渲染成块级 div，
        # 会把题号单独留在上一行，因此这里把紧邻的题号搬进缩进块内。
        if n == "ZK":
            if p.startswith(("(", "（")):
                self.hang += 1
                prefix = self._take_label()
                self._emit(f'<div class="zk" style="padding-left:2em;text-indent:-2em"><span class="zklabel">{prefix}</span>')
            elif p.startswith((")", "）")) and self.hang > 0:
                self.hang -= 1
                self._emit("</div>")
            return
        # ---- 着重：Z正线 F反线 D点线 S双线 Q曲线 =双曲线 L三连点 。加圈；缺省着重点 ----
        if n == "ZZ":
            if p.startswith(("(", "（")):
                body, flag, above = p[1:], "", False
                for ch in body:
                    if ch in "ZFDSQ=L。":
                        if not flag:
                            flag = ch
                    elif ch == "#":
                        above = True
                    elif ch in ",，":
                        break
                self.decor.append(zz_css(flag, above))
            elif p.startswith((")", "）")):
                if self.decor:
                    self.decor.pop()
            else:                                     # 〖ZZn〗 对后 n 个字符加着重点
                m = re.match(r"\s*(\d+)", p)
                if m:
                    flag = ""
                    for ch in p:
                        if ch in "ZFDSQ=L。":
                            flag = ch
                            break
                    self.pending_zz = (int(m.group(1)), flag, "#" in p)
            return
        # ---- 彩色：CS=字符色，CSX=框线色，CSD=底纹色；裸形式复位 ----
        if n in ("CS", "CSX", "CSD"):
            col = cmyk_to_css(p) if p else None
            if n == "CS":
                self.color = col                        # 裸 CS → 恢复版心色（黑）
            elif n == "CSX":
                self.rule_color = col or "#000"         # 裸 CSX → 黑
            else:
                self.shade = col                        # 裸 CSD → 黑（此处按无底纹处理）
            return
        # ---- 阴阳（反白） ----
        if n == "YY":
            if p.startswith(("(", "（")):
                self.reverse = True
            elif p.startswith((")", "）")):
                self.reverse = False
            return
        # ---- 方框 / 表格 ----
        if n == "FK":
            if p.startswith(("(", "（")):
                self.box += 1
                bd = fk_border_css(p)
                color = "" if "border:0" in bd else f"border-color:{self.rule_color};"
                wide = re.search(r'。([\d.]+)mm', p)
                tag = 'div' if wide else 'span'
                self.box_tags.append(tag)
                size = f'width:{wide.group(1)}mm;' if wide else 'display:inline;'
                shade = f'background:{self.shade};' if self.shade and 'B' in p else ''
                self._emit(f'<{tag} class="fkbox" data-shade="{self.shade or "#000"}" style="{bd}{color}{size}{shade}">')
            elif p.startswith((")", "）")) and self.box > 0:
                self.box -= 1
                self._emit(f'</{self.box_tags.pop()}>')
            return
        if n in ("BG", "ZB"):
            if p.startswith(("(", "（")):
                self.tables.append({'rows': [], 'spec': None, 'content': [[]], 'cell': 0, 'color': self.rule_color,
                                    'center': '!' in p or '！' in p, 'width': 0})
            elif p.startswith((")", "）")):
                if self.tables:
                    self._table_row_end()
                    table = self.tables.pop()
                    from .tables import border
                    margin = 'margin-left:auto;margin-right:auto;' if table.get('center') else ''
                    bottom = p.lstrip(')）')[:1] or 'Z'
                    self._emit(f'<table class="fbdtable" style="width:{table["width"]:g}mm;{margin}border-bottom:{border(bottom,table["color"])}"><tbody>' + ''.join(table['rows']) + '</tbody></table>')
            return
        if n == 'BH' and self.tables:
            from .tables import parse_row
            self._table_row_end()
            table = self.tables[-1]
            table['spec'] = parse_row(p, self.size_h, self.geo.column_w or self.geo.text_w or 170, table['spec'])
            table['content'], table['cell'] = [[]], 0
            return
        # ---- 版面注解（BP）：块的正文是页面尺寸/边空参数，不该出现在正文里 ----
        if n == "BP":
            if p.startswith(("(", "（")):
                self.bp_buf = []
            elif p.startswith((")", "）")) and self.bp_buf is not None:
                buf, self.bp_buf = self.bp_buf, None
                plain = re.sub(r"<[^>]+>", "", "".join(buf))
                if not self._bp_is_params(plain):
                    # 不是纯参数 → 内容容器（如小册子封面），照常输出；
                    # 但容器里**自成一行**的纯参数片段（如 `上下18左右18成品206乘以296`）
                    # 是版面声明、不是正文，按行剔除（带数字且去掉参数词后为空）
                    target = (self.bw_parts if self.bw_depth else
                              self.bg_parts if self.bg_open else self.parts)
                    target.extend(f for f in buf if not self._bp_param_frag(f))
            return
        # ---- 边文（BW）：内容放到页边的绝对定位层，不占正文流 ----
        if n == "BW":
            if p.startswith(("(", "（")):
                self._save_layer_state('BW')
                self.bw = parse_bw_params(p)
                self._bw_open()
            elif p.startswith((")", "）")):
                self._bw_close()
                self._restore_layer_state('BW')
            return
        # ---- 背景块（BJ）：整块内容进背景层 —— 含块内的换行与空位符，
        #      它们只用于在背景层内定位，绝不能挤动正文（书版层次：背景→边文→正文）----
        if n == "BJ":
            if p.startswith(("(", "（")):
                self._save_layer_state('BJ')
                self.bg_open = True
                self.bg_parts.append('<span class="bglayer" '
                                     f'title="背景注解 〖BJ{p}〗（背景层，不占正文版面）">')
            elif p.startswith((")", "）")):
                if self.bg_open:
                    self.bg_parts.append("</span>")
                    self.bg_open = False
                    self._restore_layer_state('BJ')
            return
        # ---- 加底纹（JD<底纹编号>：深浅度+3 位编号） ----
        if n == "JD":
            m = re.match(r"(\d)(\d{3})", p)
            if m:
                self._emit(f'<span class="shade-directive" data-depth="{m.group(1)}" data-pattern="{m.group(2)}"></span>')
                self.layout_warnings.add('底纹纹理以浅色实底近似')
            return
        # ---- 图片 ----
        if n in ("XC", "PS", "TP"):
            self._image(n, p)
            return
        # ---- 画线 / 对位 / 长度 ----
        if n == "CD":
            m = re.search(r"#?(\d+)", p)
            if m:
                self._emit(f'<span style="display:inline-block;'
                                  f'border-bottom:1px solid {self.rule_color};'
                                  f'width:{int(m.group(1)) * 0.5:g}em"></span>')
            return
        if n == "DW":
            self._emit('<span style="display:inline-block;width:2em"></span>')
            return
        # 其余注解（版面/边文/分栏控制/目录/页码等）不产生行内视觉输出

    def _save_layer_state(self, name):
        """Page decorations have their own typography, independent of body flow."""
        from copy import deepcopy
        keys = ('fonts', 'size', 'size_h', 'family', 'ext_font', 'ext_bold',
                'ext_italic', 'gap', 'lh', 'jp', 'decor', 'color', 'rule_color',
                'paragraph_indent', 'indent_next', 'line_has_content', 'block_finished')
        self.layer_states.append((name, {k: deepcopy(getattr(self, k)) for k in keys}))

    def _restore_layer_state(self, name):
        if self.layer_states and self.layer_states[-1][0] == name:
            _, state = self.layer_states.pop()
            for key, value in state.items():
                setattr(self, key, value)

    # ---- 输出路由：背景层(BJ) / 边文层(BW) / 版面缓冲(BP) / 正文流 ----
    def _target_list(self) -> list:
        """当前输出目标是哪个列表（_emit 与 _cur_list 共用同一套路由）。"""
        if self.captures:
            return self.captures[-1]['parts']
        if self.tables:
            return self.tables[-1]['content'][self.tables[-1]['cell']]
        if self.bw_depth:
            return self.bw_parts
        if self.bg_open:
            return self.bg_parts
        if self.bp_buf is not None:
            return self.bp_buf
        return self.parts

    def _end_title(self):
        if self.title:
            self.fonts = self.title['fonts']
            self.title = None
            self._emit('</div>')

    def _table_row_end(self):
        if not self.tables:
            return
        from .tables import border
        table = self.tables[-1]
        if not any(table['content']):
            return
        available = max(1, (self.geo.column_w or self.geo.text_w or 170) - 2)
        spec = table['spec'] or {'cells': [{'width': available, 'align': 'left', 'line': 'Z'}], 'top': 'Z', 'valign': 'middle'}
        count = max(len(spec['cells']), len(table['content']))
        cells = []
        cell_start = 0
        if len(table['content']) > len(spec['cells']):
            self.layout_warnings.add('表格内容列多于 BH 定义列；额外列按等宽近似')
        row_specs = [dict(cell) for cell in spec['cells']]
        for _ in range(len(row_specs), count):
            row_specs.append({'width': available / count, 'align': 'left', 'line': 'Z'})
        row_width = sum(cell['width'] for cell in row_specs)
        if row_width > available:
            scale = available / row_width
            for cell in row_specs:
                cell['width'] *= scale
            row_width = available
            self.layout_warnings.add('表格总宽超出扣除左右边距后的栏宽，已按比例压缩')
        table['width'] = max(table.get('width', 0), row_width)
        if not table.get('grid'):
            table['grid'] = [cell['width'] for cell in row_specs]
        for i in range(count):
            cell = row_specs[i]
            content = ''.join(table['content'][i]) if i < len(table['content']) else ''
            height = f"height:{spec['height']:g}mm;" if spec.get('height') else ''
            lr = '1mm'      # 单元格左右内边距：成品里文字与线留有一点距离
            padding = f"padding:{spec.get('padding_top') if spec.get('padding_top') is not None else mm_of(self.size)/2:g}mm {lr} {spec.get('padding_bottom') if spec.get('padding_bottom') is not None else mm_of(self.size)/2:g}mm {lr};"
            if spec.get('height') and spec.get('padding_top') is None and spec.get('padding_bottom') is None:
                padding = f'padding:0 {lr};'   # 固定行高时上下由 valign 居中，左右仍留边距
            right = f"border-right:{border(spec.get('right','Z'),table['color'])};" if i==count-1 else ''
            style = (f"width:{cell['width']:g}mm;line-height:{mm_of(self.size) + self.gap:g}mm;vertical-align:{spec['valign']};text-align:{cell['align']};" + right +
                     f"border-left:{border(cell['line'], table['color'])};border-top:{border(spec['top'], table['color'])};" + height + padding)
            # BH can merge a previous row's columns: K150 after K75,K75
            # is one full-width cell, not a cell restricted to the first column.
            boundaries = [0]
            for width in table['grid']:
                boundaries.append(boundaries[-1]+width)
            left = next((j for j,x in enumerate(boundaries) if abs(x-cell_start)<.01),None)
            right_edge = cell_start+cell['width']
            right_index = next((j for j,x in enumerate(boundaries) if abs(x-right_edge)<.01),None)
            span = max(1,right_index-left) if left is not None and right_index is not None else 1
            cell_start = right_edge
            cells.append(f'<td colspan="{span}" style="{style}">{content}</td>')
        table['rows'].append('<tr>' + ''.join(cells) + '</tr>')
        table['content'], table['cell'] = [[]], 0

    # ---- 上下注解（SX）：把“下半内容”叠排到“上半内容”之上 ----
    # 官方公式不在《书版使用指南》里（第 8318 行说明 SX 属数学公式类、本书未收录），
    # 语义按本工程成书效果反推：`〖SX(B-6.5mm〗上半〖〗下半〖SX)〗`
    #   · 上半内容（多为图片）定义盒子；`〖〗` 是上下两半的分界；
    #   · 下半内容叠在上半之上，其**内容盒中心**位于上半底边之上 |<距离>| 处
    #     （单行文字时等价于字身盒中心；用"中心"而非行盒/基线，同一效果在各节
    #      不同 〖HJ〗 下才不会漂移，整块内容也照样成立）；
    #   · `<距离>` 缺省时按自然叠放：下半紧贴上半底边之下（图题）；
    #   · 下半在上半宽度内居中（配合外层 〖JZ〗）。
    def _sx_open(self, params: str) -> None:
        self._jy_flush()
        from .layout import _to_mm
        m = re.search(r"[（(]\s*[A-Za-z]?\s*([-−—]?[\d.]+)\s*([A-Za-z]*)", params or "")
        off = 0.0
        if m:
            val = _to_mm(m.group(1).replace("−", "-").replace("—", "-") + (m.group(2) or ""),
                         self.size)
            off = abs(val) if val is not None else abs(float(m.group(1).replace("−", "-")))
        self.sx = {"up": [], "down": [], "phase": "up", "off": off, "raw": params,
                   'center':getattr(self,'sx_center_next',False)}
        self.sx_center_next = False

    def _sx_close(self) -> None:
        st = self.sx
        if st is None:
            return
        self.sx = None
        up = "".join(st["up"])
        down = "".join(st["down"])
        if not up.strip() and not down.strip():
            return
        if not up.strip():                 # 没有上半：退回普通输出
            self._emit(down)
            return
        # 上半图片上方留出与图片等高的空白（按需求）。
        # 只对**声明了叠排距离**、且是“横幅类”小图的 SX 生效：
        #   · 图题类 `〖SX(B〗`（无距离）不加上边距，否则每张图前会空出图高；
        #   · 整页大图（如 231.4mm 的 名著概览+.EPS）也不加，否则图前会空出近一页。
        up_h = 0.0
        if SX_TOP_GAP_EQUAL_IMAGE and st["off"] > 0:
            m = re.search(r"height:([\d.]+)mm", up)
            if m and float(m.group(1)) <= SX_TOP_GAP_MAX_MM:
                up_h = float(m.group(1))
        # 下半的**内容盒中心**落在“上半底边之上 off 处”（单行时等价于字身盒中心，
        # 多行/整块内容时也成立）：bottom 定在 off，再用 translateY 把自身中心挪上去。
        # off 未声明（图题 `〖SX(B〗`）时**不叠**：按自然堆叠，图在下半之上、各占各的行，
        # 否则说明文字不占版面，会与相邻图题和后续正文叠在一起。
        if st["off"] > 0:
            dn_style = f"bottom:{st['off']:g}mm;transform:translateY(50%)"
            note = f"内容盒中心位于上半底边之上 {st['off']:g}mm"
        else:
            dn_style = "position:static"
            note = "无叠排距离：下半按自然堆叠排在上半之下"
        tip = (f"上下注解 〖SX{st['raw']}〗：{note}（手册未收录 SX，按成书效果反推）")
        up_attr = f' style="margin-top:{up_h:g}mm"' if up_h else ""
        math_group = "Cambria Math" in up or "Cambria Math" in down
        box_class = "sxbox sxmath" if math_group else "sxbox"
        self._emit(
            ('<div class="alignline" style="text-align:center">' if st.get('center') else '') +
            f'<span class="{box_class}" title="{html.escape(tip, quote=True)}">'
            f'<span class="sxup"{up_attr}>{up}</span>'
            f'<span class="sxdn" style="{dn_style}">{down}</span>'
            f'</span>' + ('</div>' if st.get('center') else ''))

    def _cur_list(self) -> list:
        """当前输出目标是哪个列表（与 _emit 一致）。"""
        return self._target_list()

    # ---- 状态式居右（〖JY。…〗）：按“行”收尾 ----
    def _jy_open(self) -> None:
        """〖JY。…〗：把本行已输出的内容取为左半，后续内容攒进右半。

        左侧内容按“本行最后一个 <br> 之后”界定；收尾时机为换行符(A4/A5)、
        输出目标层切换、结构类注解或渲染结束——书版里它只作用于当前一行。
        """
        self._jy_flush()
        lst = self._target_list()
        start = 0
        for i in range(len(lst) - 1, -1, -1):
            if ("<br" in lst[i] or lst[i].endswith(('</div>', '</table>'))
                    or lst[i].startswith('<div class="khspace"')):
                start = i + 1
                break
        self.jy = {"target": lst, "left": lst[start:], "right": []}
        del lst[start:]

    @staticmethod
    def _jy_visible(html_text: str) -> bool:
        """右半是否有可见内容（只有宏参数占位符/空位符时不画三连点）。"""
        return bool(re.sub(r"<[^>]*>", "", html_text).replace("&nbsp;", " ").strip())

    def _jy_flush(self) -> None:
        st = self.jy
        if st is None:
            return
        self.jy = None
        left = "".join(st["left"])
        right = "".join(st["right"])
        if not self._jy_visible(right):
            st["target"].append(left + right)          # 右端没内容：按普通行输出
            return
        st["target"].append(f'<span class="jyline">{left}'
                            f'<span class="jydots"></span>'
                            f'<span class="jyright">{right}</span></span>')
        self.block_finished = True
        self.line_has_content = False

    # ---- 〖BP(…〗版面注解：参数块 vs 内容容器 ----
    # “乘以”是小册子写 `成品206乘以296` 的用法，必须算作参数词，否则参数行会被当成正文
    _BP_KEEP = ("含出血", "成品", "乘以", "上下", "左右", "页眉", "页码",
                "上", "下", "左", "右", "mm")

    @classmethod
    def _bp_is_params(cls, text: str) -> bool:
        """判断 BP 块内容是否只是版面参数（页面尺寸/边空）。

        正文/目录/答案/答题卡里是 `426*303（含出血）〓上16.5〓下21.5〓左右23` 这类纯参数；
        小册子里 `〖BP(…〗` 却是个跨 12 行的**内容容器**（含"综合性学习活动…建议用时"等正文），
        因此按内容判定：去掉参数关键词与标点数字后若无剩余汉字，则视为参数块。
        """
        t = text
        for kw in cls._BP_KEEP:
            t = t.replace(kw, "")
        t = re.sub(r"[\s\d*×xX.．,，。:：;；/／()（）\[\]【】\-—+〓]", "", t)
        return len(t) == 0

    @classmethod
    def _bp_param_frag(cls, frag: str) -> bool:
        """BP 内容容器里的单个片段是否只是版面参数行（带数字、去掉参数词后为空）。"""
        t = re.sub(r"<[^>]+>", "", frag)
        return bool(t.strip()) and bool(re.search(r"\d", t)) and cls._bp_is_params(t)

    # 题号/选项号的写法（实测语料统计得来，精确匹配，避免误搬正文）：
    #   数字+点(1. 12． 3、 4)) ｜ （1）(2) ｜ 字母+点(A. B． C、 D)) ｜ （A）(B)
    #   ｜ 圈码 ①…⑳ ｜ 中文数字（一、）｜ 允许前导中点(·（2）) 与再跟一段(（2）②)
    _LABEL_RE = re.compile(
        r"^[·•・]?(?:"
        r"\d{1,2}[.．、)）]"
        r"|[（(]\d{1,2}[）)]"
        r"|[A-Da-d][.．、)）]"
        r"|[（(][A-Da-d][）)]"
        r"|[①-⑳]"
        r"|[一二三四五六七八九十]{1,3}[、.．]"
        r")(?:[①-⑳]|[（(]\d{1,2}[）)])?$"
    )

    def _take_label(self) -> str:
        """取出紧邻输出的“题号”片段（1. / （1） / (1) / ① …

        用于 〖ZK(〗：把题号放进悬挂缩进块，使其与题干同行。
        只认“纯题号”的单个文本 span，避免误搬正文。
        """
        lst = self._cur_list()
        if not lst:
            return ""
        for count in range(1, min(4, len(lst)) + 1):
            candidate = ''.join(lst[-count:])
            # Typography may nest half-body punctuation spans inside the run.
            if not candidate.startswith('<span') or re.search(r'<(?!/?span\b)[^>]+>', candidate):
                break
            visible = html.unescape(re.sub(r'<[^>]+>', '', candidate))
            if self._LABEL_RE.fullmatch(visible):
                del lst[-count:]
                return candidate
        return ""

    def _emit(self, s: str) -> None:
        if not s:
            return
        if self.sx is not None:                # 上下注解内：内容进上半/下半缓冲
            target = self.sx[self.sx["phase"]]
            target.append(s)
            if s.startswith('<img') or s.startswith('<span class="imgph'):
                self.last_image_ref = (target, len(target) - 1)
                if self.line_align:
                    self.line_align_has_image = True
            return
        if self.jy is not None:
            if self._target_list() is not self.jy["target"]:
                self._jy_flush()               # 换层（进/出 BJ/BW/BP）时先收尾本行
            else:
                self.jy["right"].append(s)
                if s.startswith('<img') or s.startswith('<span class="imgph'):
                    self.last_image_ref = (self.jy['right'], len(self.jy['right']) - 1)
                    if self.line_align:
                        self.line_align_has_image = True
                return
        target = self._target_list()
        target.append(s)
        if s.startswith('<img') or s.startswith('<span class="imgph'):
            self.last_image_ref = (target, len(target) - 1)
            if self.line_align:
                self.line_align_has_image = True
        self.block_finished = s.endswith(('</div>', '</table>', '</figure>')) or s.startswith('<div class="khspace"')
        if self.block_finished or s.startswith('<br'):
            self.line_has_content = False
        elif s.startswith(('<span', '<img', '<sup')):
            self.line_has_content = True

    # ---- 边文层（写进 bw_parts，绝对定位在页边） ----
    def _bw_open(self) -> None:
        info = self.bw or {}
        side = info.get("side") or "bottom"
        parity = info.get("parity") or ""
        geo = self.geo
        top = geo.m_top if geo.m_top is not None else 15.0
        left = geo.m_left if geo.m_left is not None else 15.0
        h = geo.text_h or 260.0
        w = geo.text_w or 180.0
        if side == "left":
            style = f"left:0;top:{top:g}mm;height:{h:g}mm"
        elif side == "right":
            style = f"right:0;top:{top:g}mm;height:{h:g}mm"
        elif side == "top":
            style = f"top:0;left:{left:g}mm;width:{w:g}mm"
        else:
            style = f"bottom:0;left:{left:g}mm;width:{w:g}mm"
        off = info.get("offset")
        side_cn = {"left": "左", "right": "右", "top": "上", "bottom": "下"}[side]
        label = f"{side_cn}边文" + (f"·{parity}" if parity else "") + (f" {off:g}mm" if off else "")
        # 页别类：奇数页 / 偶数页（供“一页只显示一条装订线”的切换使用）
        pk = ("bw-odd" if parity.startswith("单页") else
              "bw-even" if parity.startswith("双页") else "bw-any")
        self.bw_parts.append(
            f'<div class="bwband bw-{side} {pk}" style="{style}" '
            f'title="边文注解 〖BW{html.escape(info.get("raw", ""))}〗（{html.escape(label)}）"></div>')
        self.bw_parts.append(
            f'<span class="bwtag bw-{side} {pk}" style="{style}">{html.escape(label)}</span>')
        self.bw_depth = 1
        self.bw_index = len(self.bw_parts) - 2   # 该边文容器的下标

    def _bw_close(self) -> None:
        """收口：无内容 → 整体丢弃；已有同类（边别+页别）边文 → 只计数不重复显示。"""
        if not self.bw_depth:
            return
        info = self.bw or {}
        key = (info.get("side"), info.get("parity") or "")
        inner = "".join(self.bw_parts[self.bw_index + 2:])
        del self.bw_parts[self.bw_index + 2:]
        if not inner.strip():
            del self.bw_parts[self.bw_index:]          # 只有参数、没有内容
        elif self.bw_groups.get(key):
            self.bw_groups[key] += 1                   # 重复声明：保留第一条
            del self.bw_parts[self.bw_index:]
        else:
            self.bw_groups[key] = 1
            self.bw_parts[self.bw_index] = self.bw_parts[self.bw_index].replace(
                "></div>", f">{inner}</div>")
            self.bw_tag_pos[key] = self.bw_index + 1
        self.bw_depth = 0
        self.bw = None

    def finish_bw(self) -> None:
        """给重复声明的边文标签补上“全文 N 处”说明。"""
        for key, pos in self.bw_tag_pos.items():
            n = self.bw_groups.get(key, 1)
            if n > 1 and pos < len(self.bw_parts):
                self.bw_parts[pos] = self.bw_parts[pos].replace(
                    "</span>", f'（全文 {n} 处）</span>')

    def _image(self, name: str, params: str) -> None:
        """按官方语义绘制图片：以图片自身方向/尺寸为准，占位尺寸只用于预留版面。"""
        info = parse_pic_params(params)
        fn = info["file"]
        det: dict = {}
        path = resolve_image(fn, self.fbd_path, self.root, det) if self.fbd_path else None
        ext = os.path.splitext(path)[1].lower() if path else ""
        sizedet: dict = {}
        nat = image_size_mm(path, sizedet) if path else None    # (宽mm, 高mm)，图片自身
        notes = []
        if det.get("via_index"):
            rel_src = os.path.relpath(det["path"], self.root) if self.root else det["path"]
            notes.append(f"文件取自全工程索引：{rel_src}")
        if sizedet.get("dpi_assumed"):
            notes.append("图片未标注 DPI，按 96dpi 估算尺寸")

        # ---- 计算显示尺寸：实体尺寸/缩放 → 自身尺寸 → 占位尺寸（最后手段）----
        w_mm = h_mm = None
        if info.get("ent_w") and info.get("ent_h"):
            w_mm, h_mm = info["ent_w"], info["ent_h"]
            notes.append("按实体尺寸")
        elif nat:
            w_mm, h_mm = nat
            if info.get("scale_x") and info.get("scale_y"):
                w_mm *= info["scale_x"]
                h_mm *= info["scale_y"]
                notes.append(f"按自身尺寸×{info['scale_x']:.0%}/{info['scale_y']:.0%}")
            else:
                notes.append("按图片自身尺寸")
            # 与注解的占位尺寸对照：若两者数值相同但方向相反，属“占位框写反”，仍按自身方向
            bh, bw = info.get("box_h"), info.get("box_w")
            if bh and bw and abs(bh - w_mm) < max(1.5, w_mm * 0.2) \
                    and abs(bw - h_mm) < max(3.0, h_mm * 0.2):
                notes.append(f"注解占位尺寸 {bh:g}×{bw:g}mm 与图片自身方向相反，已按图片方向渲染")
        elif info.get("box_h") and info.get("box_w"):
            h_mm, w_mm = info["box_h"], info["box_w"]
            notes.append("仅注解尺寸，未取到图片自身尺寸")

        box_h = info.get("box_h")
        box_w = info.get("box_w")
        rot = info.get("rotate")
        style = []
        from .layout import _to_mm
        for prop, key, ref in [('margin-top','space_top',self.size), ('margin-bottom','space_bottom',self.size),
                               ('margin-left','space_left',self.size_h), ('margin-right','space_right',self.size_h)]:
            if key in info:
                raw = info[key]
                distance = _to_mm(f"{abs(raw):g}{info.get(key+'_unit','mm')}", ref)
                if distance is not None:
                    style.append(f'{prop}:{distance * (-1 if raw < 0 else 1):g}mm')
        if w_mm:
            style.append(f"width:{w_mm:g}mm")
        if h_mm:
            style.append(f"height:{h_mm:g}mm")
        if rot:
            style.append(f"transform:rotate({rot:g}deg)")
        if info.get("flow") == "BP":
            style.append("display:block")
        # XC 的 <基线位置>（官方：SQ 上齐 / XQ 下齐 / JZ 居中，缺省随当前行基线）
        base_pos = info.get("baseline")
        if base_pos == "JZ":
            style.append("vertical-align:middle")
            notes.append("基线位置：居中（,JZ）")
        elif base_pos == "SQ":
            style.append("vertical-align:text-top")
            notes.append("基线位置：上齐（,SQ）")
        else:
            style.append("vertical-align:baseline")
            if base_pos == "XQ":
                notes.append("基线位置：下齐（,XQ）")
        if info.get("cr_marker"):
            notes.append(";C＝插入 CR 文件")
        elif info.get("eps_marker"):
            notes.append(";P＝插入 EPS 文件")
        if info.get("start_h") or info.get("start_w"):
            style.append(f"margin-top:{info.get('start_h') or 0:g}mm")
            style.append(f"margin-left:{info.get('start_w') or 0:g}mm")
        style = ";".join(style) + ";" if style else ""
        if not w_mm:
            # 无可靠尺寸（图片缺失/异形且注解未给占位尺寸）时兜底限宽，
            # 绝不放任 <img> 用栅格 PNG 的自然像素尺寸（受 /asset 上限影响会撑爆版面）。
            style += "max-width:calc(100% - 2mm);height:auto;"
        tip = f"{name} {fn}" + ("　" + "；".join(notes) if notes else "")

        if path and (ext in _IMG_RASTER or ext in _IMG_CONVERT or
                     (ext == ".eps" and RASTERIZE_EPS)):
            if self.inline:
                src = image_data_uri(path)
            else:
                rel = os.path.relpath(path, self.root) if self.root else path
                src = "/asset?f=" + quote(rel.replace("\\", "/"))
            if src:
                tag = (f'<img class="img{" bgimg" if self.bg_open else ""}" src="{src}" '
                       f'style="{style}" alt="{html.escape(fn)}" title="{html.escape(tip)}">')
                self._emit(tag)
                return
        # EPS 未栅格化 / 未找到 → 占位（按占位尺寸或自身比例给出框）
        if path and ext == ".eps":
            bw = f"width:{w_mm:g}mm;" if w_mm else "max-width:100%;"
            bh = f"height:{h_mm:g}mm;" if h_mm else ""
            self._emit(
                f'<span class="imgph eps" style="{bw}{bh}" title="{html.escape(tip)}">EPS 图位'
                f'<br><b>{html.escape(fn)}</b>'
                + (f'<br><i>{w_mm:g}×{h_mm:g}mm</i>' if w_mm and h_mm else '') + '</span>')
            return
        self._emit(
            f'<span class="imgph miss" title="{html.escape(tip)}">{name} 图片未找到'
            f'<br><b>{html.escape(fn)}</b></span>')

    def _wrap_bg(self, tag: str, info: dict) -> str:
        """（保留备用）把单个元素包成背景层。现在整块 BJ 内容统一进背景层，不再逐个包裹。"""
        return tag


# ---------------- 三种视图 ----------------
def _flow(tokens, dec, geo, fbd_path: str = "", root: str | None = None,
          inline: bool = False, join_lines: bool = False) -> str:
    return PreviewRenderer(dec, geo, fbd_path, root, inline, join_lines).run(tokens)


def line_end_coverage(fbd_path: str, dec=None) -> float:
    """行尾带 A4/A5 的行占比：高则说明该文件遵循“A4/A5 才是换行”的约定。

    直接看原始字节（dec.text 里控制符是私有区占位符，不便判定）。
    """
    try:
        raw = open(fbd_path, "rb").read()
    except OSError:
        return 0.0
    lines = [ln for ln in raw.split(b"\r\n") if ln.strip()]
    if not lines:
        return 0.0
    marked = sum(1 for ln in lines
                 if len(ln) >= 2 and ln[-2] == 0xAA and ln[-1] in (0xA4, 0xA5))
    return marked / len(lines)


def trim_insets(geo: Geometry) -> tuple[float, float]:
    """成品相对「页面（含出血）」每边内缩量 = (页面 − 成品) / 2，单位 mm。

    官方不变量：版心 = 页面 − 边空（边空从**含出血的页面**边算起）；
    成品 = 页面 − 2×出血。所以页面框 → 成品框 → 版心框是三层同心矩形。
    """
    iw = ih = 0.0
    if geo.page_w and geo.trim_w:
        iw = max(0.0, round((geo.page_w - geo.trim_w) / 2, 2))
    if geo.page_h and geo.trim_h:
        ih = max(0.0, round((geo.page_h - geo.trim_h) / 2, 2))
    return iw, ih


def bleed_note(geo: Geometry) -> str:
    """页面/成品关系的如实说明：只有真的存在出血区（成品比页面小）才说“含出血”。"""
    iw, ih = trim_insets(geo)
    if geo.bleed and (iw or ih):
        return f"（含出血，成品每边内缩 {iw:g}/{ih:g}mm）"
    if geo.bleed:
        return "（BP 声明含出血，但成品＝页面，无出血区）"
    return ""


def ext_font_usage(lex) -> dict[str, int]:
    """统计全文声明的《外挂字体名》及次数（官方 HT 的 <汉字外挂字体>）。"""
    from .sizes import parse_ht
    out: dict[str, int] = {}
    for t in lex.tokens:
        if t.kind == "annot" and t.name in ("HT", "WT", "ST") and "《" in (t.params or ""):
            name = parse_ht(t.params).get("ext")
            if name:
                out[name] = out.get(name, 0) + 1
    return out


def preview_html(dec, lex, geo: Geometry, fbd_path: str = "", root: str | None = None,
                 inline: bool = False) -> str:
    defs = build_defs(lex.tokens)
    context_for_defs = load_context(fbd_path, geo.pro_path) if fbd_path else None
    if context_for_defs:
        defs = {**build_defs(context_for_defs.tokens), **defs}
    from .macros import MacroStats
    macro_stats = MacroStats()
    tokens = expand(lex.tokens, defs, stats=macro_stats)
    cov = line_end_coverage(fbd_path) if fbd_path else 0.0
    join_lines = True
    r = PreviewRenderer(dec, geo, fbd_path, root, inline, join_lines)
    body = r.run(tokens)
    r.finish_bw()
    bg_html = "".join(r.bg_parts)    # 背景层（BJ）：绝对定位、不影响正文流
    bw_html = "".join(r.bw_parts)    # 边文层（BW）：装订线/页脚装饰等
    tw = geo.text_w or 180
    th = geo.text_h or 260
    m_t, m_b = geo.m_top if geo.m_top is not None else 15, geo.m_bottom if geo.m_bottom is not None else 15
    m_l, m_r = geo.m_left if geo.m_left is not None else 15, geo.m_right if geo.m_right is not None else 15
    # 页面（含出血）直接用声明值；缺声明时按「版心 + 边空」反推
    pw = geo.page_w or round(tw + m_l + m_r, 2)
    ph = geo.page_h or round(th + m_t + m_b, 2)
    ins_w, ins_h = trim_insets(geo)
    has_trim = bool(geo.trim_w and geo.trim_h) and (ins_w > 0.05 or ins_h > 0.05)
    cols = max(1, geo.columns)
    # 默认缩放 = 1:1（按声明尺寸显示：1mm = 3.7795px）并居中；浏览器窗口
    # 宽度放不下页面实际宽度时，分页完成后自动铺满宽度（见 JS fbdlayoutdone）。
    zoom = 1.0
    # 栏线：官方只有带 `!` 时才画线（缺省为五号字正线）
    rule_style = 'dotted' if re.search(r'栏线 D(?:[（ ]|$)',geo.column_rule or '') else 'solid'
    rule = (f"column-rule:0.2mm {rule_style} #000;" if (geo.column_rule or "").startswith("栏线") else "")
    pitch = f"{geo.line_pitch_mm:g}mm" if geo.line_pitch_mm else "auto"
    wrap_info = "A4 换行、A5 换段；忽略编辑器回车，SJ 控制段首缩进"
    bw_n = len(r.bw_groups)
    preview_notes = [
        ("近似预览：按官方注解语义还原字号（含小号/磅字号）、行高（BX 行距）、字体、"
         "对齐、着重（点/线/曲线等）、彩色（CS/CSX/CSD CMYK）、方框、图片（EPS 栅格化）；"
         f"浏览器按实际字体测量断行并生成固定尺寸页面；高级书版版式仍有近似。自定义注解已宏展开（{len(defs)} 个定义）。"),
        wrap_info + (
            f"。另有 {bw_n} 组边文（装订线/页脚装饰等）已按边别绝对定位到页边："
            "左边文＝单页（奇数页）、右边文＝双页（偶数页）；下边文的单/双页两条在此并列显示。"
            if bw_n else "。"
        ),
    ]
    parity_controls = (
        '<span class="muted" style="margin-left:10px">页别：</span>'
        '<button id="pb-odd" class="paritybtn on" onclick="setParity(\'odd\')" '
        'title="装订线在左（ZBW新）">奇数页（单页）</button>'
        '<button id="pb-even" class="paritybtn" onclick="setParity(\'even\')" '
        'title="装订线在右（YBW新）">偶数页（双页）</button>'
        '<button id="pb-all" class="paritybtn" onclick="setParity(\'all\')" '
        'title="同时显示单双页边文，便于对照">全部</button>'
        if bw_n else ''
    )
    display_controls = ''.join(
        part for part in (
            '<button id="lb-bg" class="layerbtn" aria-pressed="false" onclick="setLayer(\'bg\')" '
            'title="对应书版【BYJ】：隐藏/显示本页背景内容">背景图 ✓</button>' if r.bg_parts else '',
            '<button id="lb-bw" class="layerbtn" aria-pressed="false" onclick="setLayer(\'bw\')" '
            'title="对应书版【BYW】：隐藏/显示本页边文内容（装订线等）">边文 ✓</button>' if bw_n else '',
        )
    )
    if display_controls:
        display_controls = '<span class="muted" style="margin-left:10px">显示：</span>' + display_controls
    context = r.context
    settings = context.settings if context else {}
    warnings = sorted(r.layout_warnings | r.fonts.warnings)
    if any('预览默认采用 2 栏' in note for note in geo.notes):
        warnings.append('FL 未声明栏数，预览参考本工程成品采用双栏；可在网页调整，非手册规定的缺省值')
    if macro_stats.undefined:
        warnings.append('未定义的宏：' + '、'.join(sorted(set(macro_stats.undefined))))
    if macro_stats.depth_limited:
        warnings.append('宏展开达到深度上限：' + '、'.join(sorted(set(macro_stats.depth_limited))))
    if context:
        warnings.extend(context.warnings)
    if any(t.name == 'JP' and t.params for t in tokens):
        warnings.append('JP 级数间距使用近似映射')
    for name in ('MS', 'ZS', 'BD'):
        if name in settings:
            warnings.append(f'PRO {name} 已载入；高级版式参数按基础规则近似')
    unsupported = sorted({t.name for t in tokens if t.kind == 'annot' and t.name not in
        {'HT','WT','ST','HJ','SJ','SX','KG','KH','JP','JZ','JY','ZK','ZZ','CS','CSX','CSD','YY','FK','BG','ZB','BH',
         'BP','BW','BJ','JD','XC','PS','TP','CD','DW','FL','ZD','BT','ZW','BM','CT','LL','LM','(空注解)'}})
    if unsupported:
        warnings.append('未完整实现的注解：' + '、'.join(unsupported))
    if r.bw_parts:
        warnings.append('边文暂按全文首个同组声明绘制，动态变更未逐页重放')
    if len({t.params for t in tokens if t.name == 'FL' and t.params.startswith(('(', '（'))}) > 1:
        warnings.append('局部分栏变化暂按主栏配置测量；非等宽栏和拉平参数需核对')
    page_number = None
    if settings.get('YM'):
        raw = settings['YM'][-1].replace('！','!').replace('＝','=').replace('－','-')
        d = parse_ht(raw)
        start = re.search(r'=(\d+)', raw)
        page_number = {'start':int(start.group(1)) if start else 1,
                       'center':'!' in raw, 'top':',S' in raw or '，S' in raw,
                       'decoration':'•' if '。' in d['rest'] else '—' if '-' in d['rest'] else '',
                       'font': f"{d['pt_v'] or 10.5:g}pt {font_css(d['code'])}"}
        warnings.append('YM 使用基础阿拉伯页码近似；中文数字及扩展定位尚未完整实现')
    config = {'columns':cols, 'gap':geo.column_gap if geo.column_gap is not None else 8,
              'textWidth':tw,'textHeight':th,'pageWidth':pw,'pageHeight':ph,
              'rule':f'0.2mm {rule_style} #000' if rule else '', 'pageNumber':page_number,
              'context':{'pro':context.path if context else None,'settings':settings,
                         'aliases':context.aliases if context else {}}, 'warnings':warnings}
    config['previewNotes'] = preview_notes
    config['margins'] = {'top':m_t,'bottom':m_b,'left':m_l,'right':m_r}
    config['file'] = fbd_path
    # Preview numbering policy for this corpus: paired WM inside the initial
    # directory block corresponds to an unnumbered directory in the supplied PDF.
    # This is an explicit preview policy, not an undocumented WM interpretation.
    first_fl = next((i for i,t in enumerate(tokens) if t.name=='FL' and t.params.startswith(('(', '（'))),len(tokens))
    front = tokens[:first_fl]
    if any(t.name=='ML' and t.params.startswith(('(', '（')) for t in front) and sum(t.name=='WM' for t in front)==2:
        config['unnumberedDirectoryPages'] = 1
        warnings.append('参考本工程成品：目录首页不显示、不递增印刷页码；WM 的版本语义尚未确认')
    printable_body = re.sub(r'<template>.*?</template>', '', body, flags=re.S)
    config['expectedCharacters'] = len(html.unescape(re.sub(r'<[^>]*>', '', printable_body)))
    if settings.get('MS'):
        header = settings['MS'][-1]
        style = parse_ht(header.lstrip('%X'))
        config['header'] = {'font':f"{style['pt_v'] or 10.5:g}pt {font_css(style['code'])}",
                            'bottom':header.startswith('X'),'rule':',B' not in header and '，B' not in header}
    config_json = json.dumps(config, ensure_ascii=False).replace('<', '\\u003c')
    return f"""
<div id="layout-status" hidden>正在加载字体和图片、计算行栏页坐标…</div>
<script type="application/json" id="layout-config">{config_json}</script>
<div class="zoombar">缩放：
  <select id="zoom-choice" onchange="setZoomChoice(this.value)" aria-label="缩放比例">
    <option value="25">25%</option>
    <option value="50">50%</option>
    <option value="75">75%</option>
    <option value="100" selected title="按小样声明的页面尺寸 1:1 显示">默认 100%（实际大小）</option>
    <option value="fit" title="按当前每行版式铺满可用宽度">铺满宽度</option>
  </select>
  <div class="page-nav" aria-label="页码导航">
    <button id="prev-page" type="button" aria-label="上一页" title="上一页" onclick="movePage(-1)" disabled>&#9664;</button>
    <input id="page-current" type="number" min="1" value="1" aria-label="跳转到页码"
      title="输入页码后按 Enter 跳转" onkeydown="if(event.key==='Enter')goToPage(this.value)">
    <span>/</span>
    <span id="page-count">0</span>
    <button id="next-page" type="button" aria-label="下一页" title="下一页" onclick="movePage(1)" disabled>&#9654;</button>
  </div>
  <label>栏数 <select id="column-choice" onchange="setColumns(this.value)">
    {''.join(f'<option value="{n}"'+ (' selected' if n == cols else '') + f'>{n}</option>' for n in range(1,9))}
  </select></label>
  <label>每行 <select id="perrow-choice" onchange="setPerRow(this.value)"
    title="预览窗口里每行并排显示的页数（仅影响屏幕显示，导出 PDF 仍一页一纸）">
    <option value="1">1 页</option><option value="2">2 页</option>
  </select></label>
  {parity_controls}{display_controls}
</div>
<div class="pagewrap">
 <div id="measured-pages"></div>
 <template id="page-template">
  <div class="pageframe pf-odd{' pf-trim' if has_trim else ''}" data-zoom="{zoom:.3f}"
       style="--pw:{pw:g}mm;--ph:{ph:g}mm;--tw:{tw:g}mm;--th:{th:g}mm;
       --mt:{m_t:g}mm;--mb:{m_b:g}mm;--ml:{m_l:g}mm;--mr:{m_r:g}mm">
 {bg_html}
 {bw_html}
 {'<div class="trimbox" style="inset:%gmm %gmm" title="成品 %g×%gmm（页面每边内缩 %g/%gmm）">'
  '<i class="trimtag">成品 %g×%g</i></div>'
  % (ins_h, ins_w, geo.trim_w, geo.trim_h, ins_w, ins_h, geo.trim_w, geo.trim_h)
  if has_trim else ''}
 <div class="page-surface"></div>
 <div class="page-number"></div>
 </div>
</template>
</div>
<div id="layout-source" style="width:{tw:g}mm;height:{th:g}mm;column-count:{cols};
 column-gap:{geo.column_gap if geo.column_gap is not None else 8:g}mm;line-height:0">{body}</div>
<div id="layout-prelude" style="width:{tw:g}mm">{''.join(r.prelude)}</div>
"""


def structure_html(dec, lex) -> str:
    """结构视图：逐行显示注解与控制符。

    控制符按**排版语义**呈现（不再显示带背景的代码方块）：
    A1…A3 → 圈码、AC/AD → 上下标（AC 后随圈码时为注号）、A4/A5 → 换行、A9/AA → 盒组括弧；
    只有确实未知的用户区字节才用带底色的标记，并标注代码。
    """
    CTRL_TIP = {
        "A1": "圈码定界-开（AA A1）", "A3": "圈码定界-闭（AA A3）",
        "A4": "换行符（AA A4）：书版真正的换行", "A5": "换段符（AA A5）",
        "A6": "文件结束符（AA A6）", "A8": "宏参数占位符（AA A8）",
        "A9": "盒组括弧-开（AA A9）", "AA": "盒组括弧-闭（AA AA）",
        "AC": "上标标记（AA AC）；后随圈码时作为注号",
        "AD": "下标标记（AA AD）",
    }
    lines: list[list] = []
    cur: list = []
    for t in lex.tokens:
        if t.kind == "newline":
            lines.append(cur); cur = []
        else:
            cur.append(t)
    lines.append(cur)

    out = ['<div class="structure">']
    for i, row in enumerate(lines, 1):
        cells = []
        circle = None          # 正在收集的圈码内容
        note_next = False      # 上一个控制符是注号标记
        for t in row:
            if circle is not None and t.kind != "ctrl":
                circle += t.raw
                continue
            if t.kind == "ctrl":
                c = t.raw
                tip = html.escape(CTRL_TIP.get(c, f"用户区字节 AA {c}"))
                if c == "A1":
                    circle = ""
                elif c == "A3":
                    m = re.match(r"B(\d+)", (circle or "").strip())
                    cells.append(f'<span class="txt" title="{tip}">'
                                 f'{circled(int(m.group(1))) if m else ""}</span>')
                    circle = None
                elif c == "AC":
                    note_next = True
                    cells.append(f'<sup class="mk" title="{tip}">↑</sup>')
                elif c == "AD":
                    cells.append(f'<sub class="mk" title="{tip}">↓</sub>')
                elif c in ("A4", "A5"):
                    cells.append(f'<span class="mk" title="{tip}">↵</span>')
                elif c in ("A9", "AA"):
                    cells.append(f'<span class="mk" title="{tip}">‖</span>')
                elif c == "A6":
                    cells.append(f'<span class="mk" title="{tip}">Ω</span>')
                else:
                    cells.append(f'<span class="chip unk" title="{tip}">{c}</span>')
                continue
            if t.kind == "text":
                s = t.raw
                if note_next:
                    m = re.match(r"^([①-⑳])", s)
                    if m:
                        cells.append(f'<sup class="refmark" title="注号">'
                                     f'{m.group(1)}</sup>')
                        s = s[m.end():]
                    note_next = False
                if s:
                    cells.append(f'<span class="txt">{html.escape(dec.translate(s))}</span>')
            else:
                cat = t.cat or "其他"
                tip = html.escape(f"{t.name}({t.params}) {t.desc}｜形态 {t.form}/{t.op}｜置信 {t.confidence}")
                cells.append(f'<span class="chip cat-{_cat_slug(cat)}" title="{tip}">'
                             f'{html.escape(t.name)}</span>')
        out.append(f'<div class="srow"><span class="ln">{i}</span>{"".join(cells)}</div>')
    out.append("</div>")
    return "".join(out)


def plain_html(dec, lex) -> str:
    toks = lex.tokens
    # 标出“纯参数型 〖BP(…〗 块”的 token 范围：这些是页面尺寸/边空参数，不是正文，校对时不该出现
    skip: set[int] = set()
    opens: list[int] = []
    for i, t in enumerate(toks):
        if t.kind == "annot" and t.name == "BP":
            if t.op == "open":
                opens.append(i)
            elif t.op == "close" and opens:
                a = opens.pop()
                inner = "".join(tk.raw for tk in toks[a + 1:i] if tk.kind in ("text", "ctrl"))
                if PreviewRenderer._bp_is_params(inner):
                    skip.update(range(a, i + 1))
    lines, buf = [], []
    for i, t in enumerate(toks):
        if i in skip:
            continue
        if t.kind == "newline":
            lines.append("".join(buf)); buf = []
        elif t.kind == "text":
            # 〓 保留原字符，但加浅色标记，便于理解它不是正文内容
            buf.append(html.escape(t.raw).replace(
                _BLANK, '<span class="gt" title="空位符（书版输出为空白）">〓</span>'))
        elif t.kind == "ctrl" and t.raw in ("A4", "A5"):
            buf.append("<br>")
    lines.append("".join(buf))
    return ('<div class="note">纯文本视图：去掉注解后只留文字，<b>不做换行</b>。'
            '<span class="gt">〓</span> 是小样里的<b>空位符</b>'
            '（GBK A1FE；书版输出为空白，成书 PS 中该内码 0 次出现），'
            '在“近似排版”里已按全角空白显示。</div>'
            '<div class="plain">' + "".join(
                f'<div class="prow"><span class="ln">{i}</span>{ln or "&nbsp;"}</div>'
                for i, ln in enumerate(lines, 1)) + "</div>")


def _cat_slug(cat: str) -> str:
    return {"版面": "lay", "字体": "font", "间距": "space", "版式": "fmt", "分栏": "col",
            "表格": "tbl", "着重": "emph", "装饰": "deco", "彩色": "color", "图片": "img",
            "目录": "toc", "页码": "page", "书眉": "head", "注释": "note", "标点": "punct",
            "画线": "line", "自定义": "custom", "其他": "other"}.get(cat, "other")


CSS = """
:root{
 --primary:#1677ff;--primary-hover:#4096ff;--primary-active:#0958d9;
 --success:#52c41a;--warning:#faad14;--error:#ff4d4f;
 --text:rgba(0,0,0,.88);--text-2:rgba(0,0,0,.65);--text-3:rgba(0,0,0,.45);--text-disabled:rgba(0,0,0,.25);
 --border:#d9d9d9;--split:#f0f0f0;--split-2:rgba(5,5,5,.06);
 --container:#fff;--page-bg:#f5f5f5;
 --radius-sm:4px;--radius:6px;--radius-lg:8px;
 --shadow:0 6px 16px 0 rgba(0,0,0,.08),0 3px 6px -4px rgba(0,0,0,.12),0 9px 28px 8px rgba(0,0,0,.05);
 --ease:cubic-bezier(.645,.045,.355,1);
 --mask:rgba(0,0,0,.45);
 /* 存量变量名映射：旧规则自动落到 antd 色板 */
 --bg:#f5f5f5;--fg:rgba(0,0,0,.88);--line:#d9d9d9;--accent:#1677ff;
}
button,a.hbtn,select,input{transition:color .2s var(--ease),border-color .2s var(--ease),
  background-color .2s var(--ease)}
button:focus-visible,a.hbtn:focus-visible,select:focus-visible,input:focus-visible{
  outline:2px solid rgba(5,145,255,.45);outline-offset:1px}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5714 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  background:var(--bg);color:var(--text)}
a{color:var(--accent);text-decoration:none}
header{background:var(--container);border-bottom:1px solid var(--split);padding:8px 16px;
  position:sticky;top:0;z-index:5}
header h1{margin:0;font-size:16px;font-weight:600;color:var(--text);display:inline-block}
header .hbtns{float:right;margin-top:-2px;display:flex;gap:8px;align-items:center}
header .hbtns button,a.hbtn{border:1px solid var(--border);background:var(--container);
  border-radius:var(--radius);padding:4px 15px;cursor:pointer;font-size:13px;color:var(--text)}
header .hbtns button:hover,a.hbtn:hover{border-color:var(--primary-hover);color:var(--primary-hover)}
header .hbtns button:active,a.hbtn:active{border-color:var(--primary-active);color:var(--primary-active)}
header .hbtns button.on{background:var(--primary);color:#fff;border-color:var(--primary)}
.operations-nav a.hbtn{border-color:var(--primary);color:var(--primary)}
.operations-nav a.hbtn:hover{background:var(--primary);color:#fff}
.operations-nav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
/* 打印/导出 PDF：只输出成品页框，一页框一页纸；缩放强制 1:1 */
/* 「工具栏」按钮：信息侧栏右侧，点击隐藏 header 内其它元素（自身保留以便恢复） */
#hdrbtn{border:1px solid var(--border);background:var(--container);border-radius:var(--radius);
  padding:4px 15px;cursor:pointer;font-size:13px;color:var(--text)}
#hdrbtn:hover{border-color:var(--primary-hover);color:var(--primary-hover)}
#hdrbtn.on{background:var(--primary);color:#fff;border-color:var(--primary)}
body.hide-header header > :not(.hbtns){display:none!important}
body.hide-header .hbtns > :not(#hdrbtn){display:none!important}
body.hide-header header{padding:6px 16px;border-color:transparent;background:transparent}
@media print{
 header,.tabs,.zoombar,#operations,aside#info,.backdrop,#layout-status,
 #layout-source,#layout-prelude,.page-number,#hdrbtn{display:none!important}
 body{margin:0;background:#fff}
 .wrap{display:block}
 .panel{display:block!important}
 #v2,#v3,#v4,#v5{display:none!important}
 .pagewrap{overflow:visible;background:#fff;border:0;border-radius:0;padding:0;display:block}
 #measured-pages{display:block!important}   /* 导出 PDF 一页一纸，不受"每行 2 页"显示配置影响 */
 .page-surface{overflow:hidden!important}   /* 末行墨水伸进下边空的部分在纸上裁掉，否则 Chrome 会为溢出补空白页 */
 .pageframe{zoom:1!important;margin:0!important;box-shadow:none;border-radius:0;
   break-after:auto;page-break-after:auto}
}
.wrap{display:block}
main{padding:14px 16px;min-width:0}
/* 信息侧栏改为抽屉：默认隐藏，预览可铺满整屏 */
aside#info{position:fixed;top:0;right:0;bottom:0;width:378px;max-width:92vw;background:var(--container);
  border-left:1px solid var(--split);box-shadow:var(--shadow);
  padding:0 16px 18px;overflow:auto;z-index:40;transform:translateX(104%);
  transition:transform .3s var(--ease)}
body.info-open aside#info{transform:none}
aside#info .ihead{position:sticky;top:0;background:var(--container);border-bottom:1px solid var(--split);
  padding:12px 0;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;
  font-weight:600;font-size:14px;color:var(--text);z-index:1}
aside#info .ihead button{border:1px solid var(--border);background:var(--container);border-radius:var(--radius);
  padding:3px 10px;cursor:pointer;font-size:12px;color:var(--text)}
.backdrop{position:fixed;inset:0;background:var(--mask);z-index:39;opacity:0;
  pointer-events:none;transition:opacity .3s var(--ease)}
body.info-open .backdrop{opacity:1;pointer-events:auto}
.tabs{display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid var(--split)}
.operations{width:min(760px,calc(100vw - 32px));max-height:85vh;padding:20px;
  border:0;border-radius:var(--radius-lg);color:var(--text);background:var(--container);
  box-shadow:var(--shadow);overflow:auto}
.operations::backdrop{background:var(--mask)}
.operations-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;
  font-size:16px;font-weight:600;color:var(--text)}
.operations-head button{background:var(--container);border:1px solid var(--border);border-radius:var(--radius);
  padding:4px 12px;cursor:pointer;color:var(--text)}
.operations .tabs{flex-wrap:wrap}
.operations .zoombar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;line-height:2}
body.hide-bg .pageframe .bglayer,body.hide-bw .pageframe .bwband,body.hide-bw .pageframe .bwtag{display:none}
.tabs button{border:0;background:transparent;padding:6px 12px;border-radius:var(--radius) var(--radius) 0 0;
  cursor:pointer;color:var(--text-2);margin-bottom:-1px}
.tabs button:hover{color:var(--primary)}
.tabs button.on{background:transparent;color:var(--primary);box-shadow:inset 0 -2px 0 var(--primary)}
.panel{display:none}.panel.on{display:block}
.note{background:#fffbe6;border:1px solid #ffe58f;border-radius:var(--radius);padding:8px 12px;
  margin-bottom:12px;font-size:12px;color:var(--text)}
.box{background:var(--container);border:1px solid var(--split);border-radius:var(--radius-lg);
  padding:10px 12px;margin-bottom:12px}
.box h3{margin:0 0 6px;font-size:13px;color:var(--text-2);font-weight:600}
table.kv{width:100%;border-collapse:collapse;font-size:12px}
table.kv td{padding:4px;border-bottom:1px solid var(--split-2);vertical-align:top;color:var(--text)}
table.kv td:first-child{color:var(--text-2);white-space:nowrap}
ul.warn{margin:0;padding-left:18px;font-size:12px;color:var(--text-2)}
.chip{display:inline-block;border-radius:4px;padding:0 4px;margin:0 1px;font-size:11px;line-height:17px;
      border:1px solid transparent;white-space:nowrap}
.chip.ctrl{background:#eef2f6;border-color:#cfd8e3;color:#4a5568;font-family:Consolas,monospace}
.chip.empty{background:var(--fill-3);color:var(--text-3)}
.cat-lay{background:#e7f1ff;color:#0b4a8f}.cat-font{background:#eaf7ea;color:#256029}
.cat-space{background:#fff2e0;color:#8a4b00}.cat-fmt{background:#f0eaff;color:#4b2c8a}
.cat-col{background:#e6f7f7;color:#0d5c5c}.cat-tbl{background:#fdeef2;color:#8a1c3c}
.cat-emph{background:#fff6d6;color:#7a5c00}.cat-deco{background:#f3e8ff;color:#5b2a86}
.cat-color{background:#ffe9e9;color:#8a1c1c}.cat-img{background:#e9f3ff;color:#14507f}
.cat-custom{background:#e8f5e9;color:#1b5e20}.cat-other{background:#f0f0f0;color:#555}
.structure{background:var(--container);border:1px solid var(--split);border-radius:var(--radius-lg);padding:8px;font-size:12.5px}
.srow{display:flex;flex-wrap:wrap;align-items:flex-start;gap:0;border-bottom:1px dashed var(--split);padding:2px 0}
.ln{flex:0 0 52px;color:var(--text-3);font-family:Consolas,monospace;text-align:right;padding-right:8px}
.txt{white-space:pre-wrap}
.plain{background:var(--container);border:1px solid var(--split);border-radius:var(--radius-lg);padding:10px}
.prow{display:flex;gap:8px;border-bottom:1px dashed var(--split)}
.prow .ln{flex:0 0 52px}
/* 页面在预览区内居中；用 flex + margin:auto（超宽时不会像 justify-content:center 那样裁掉左侧） */
.pagewrap{overflow:auto;display:flex}
.pageframe{margin:auto}
#measured-pages{width:100%}   /* flex 子项默认收缩为内容宽，须撑满才能让页框 margin:auto 居中 */
/* 每行 2 页：确定性两列网格；页距用 gap 取代原 18px 底边距 */
#measured-pages.perrow-2{display:grid;grid-template-columns:repeat(2,max-content);
  justify-content:center;align-items:flex-start;gap:5mm}
#measured-pages.perrow-2 .pageframe{margin:0}
.colorbar{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.colorbar .colorbtn{border:1px solid var(--border);background:var(--container);border-radius:var(--radius-sm);
  padding:2px 7px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;color:var(--text)}
.colorbar .colorbtn:hover{border-color:var(--primary-hover);color:var(--primary-hover)}
.colorbar .colorbtn::before{content:"";width:10px;height:10px;border-radius:2px;background:var(--c,#ccc);
  border:1px solid var(--split-2)}
.colorbar .colorbtn:not(.on){opacity:.45}
.colorbar .colorbtn:not(.on) .lbl{text-decoration:line-through}
.zoombar{position:sticky;top:0;z-index:20;width:100%;margin:8px 0;padding:0 12px;
  box-sizing:border-box;font-size:12px;color:var(--text-2);background:var(--bg);
  box-shadow:0 2px 4px rgba(0,0,0,.06)}
.zoombar button,.zoombar select{border:1px solid var(--border);background:var(--container);border-radius:var(--radius-sm);
  padding:2px 8px;cursor:pointer;margin-right:4px;color:var(--text)}
.zoombar button:hover,.zoombar select:hover{border-color:var(--primary-hover);color:var(--primary-hover)}
.zoombar #zoom-choice{min-width:150px}
.page-nav{display:inline-flex;align-items:center;gap:4px;margin-right:4px;color:var(--text-2);font-variant-numeric:tabular-nums}
.page-nav button{display:inline-grid;width:24px;height:24px;place-items:center;padding:0}
.page-nav button:disabled{opacity:.4;cursor:not-allowed}
.page-nav input{width:44px;height:24px;padding:1px 4px;border:1px solid var(--border);border-radius:var(--radius-sm);
  background:var(--container);color:var(--text);font:inherit;text-align:center}
.pageframe{scroll-margin-top:8px}
.zoombar button.layerbtn.on,.zoombar button.paritybtn.on{background:var(--primary);border-color:var(--primary);color:#fff}
.zoombar button:not(.on){color:var(--text-3)}
.muted{color:#8a949e}
/* 页面框：尺寸全部来自小样声明的几何（--pw/--ph 页面含出血，--tw/--th 版心，--m* 边空） */
.pageframe{background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15);position:relative;
  padding:var(--mt) var(--mr) var(--mb) var(--ml);
  width:var(--pw);min-width:calc(var(--tw) + var(--ml) + var(--mr));
  height:var(--ph);min-height:var(--ph);margin:0 auto 18px;overflow:hidden;box-sizing:border-box;}
.page-surface{position:absolute;left:var(--ml);top:var(--mt);width:var(--tw);height:var(--th);
  overflow:visible;z-index:2}   /* 末行基线装行后墨水按书版惯例伸进下边空，不能按版心底裁切 */
.page-number{position:absolute;left:0;bottom:1mm;width:100%;text-align:center;font:9px sans-serif;color:#88929b}
.pro-page-number{position:absolute;left:var(--ml);right:var(--mr);bottom:5mm;z-index:3}
#layout-source{position:absolute;left:-100000px;top:0;column-fill:auto;visibility:hidden;
  font-size:12pt;font-family:'FZShuSong-Z01','SimSun',serif;overflow:visible;word-break:normal;line-break:strict;}
#layout-source .zklabel{white-space:nowrap}
#layout-prelude{position:absolute;left:-100000px;top:0;visibility:hidden;line-height:0;font-size:12pt;}
.fbdtable{border-collapse:collapse;border-spacing:0;table-layout:fixed;margin:2mm 1mm;max-width:calc(100% - 2mm);box-sizing:border-box}
.fbdtable tr{break-inside:avoid;page-break-inside:avoid}
.fbdtable td{overflow-wrap:anywhere;box-sizing:border-box;white-space:normal}   /* 覆盖 .positioned-fragment 的 nowrap，单元格里允许换行 */
.fbdtable td [data-channel]{line-height:inherit!important}
.fbd-figure{display:block;max-width:calc(100% - 2mm);margin:2mm 1mm;break-inside:avoid;page-break-inside:avoid}
.fbd-figure img{display:block;max-width:100%;height:auto;margin:0}
.fbd-figure img.img{max-width:100%;margin:0}
.fbd-figure figcaption{display:block;max-width:100%;line-height:1.35}
.fbd-figcaption{display:block;max-width:100%;line-height:1.35}
.fbd-image-caption{display:block;margin:1mm 1mm 2mm;text-align:center;break-inside:avoid;page-break-inside:avoid}
.positioned-fragment{white-space:nowrap}
/* 页面(含出血) > 成品：两者不等时，页面比成品多出的那圈就是出血区，用斜纹带标出 */
.pageframe.pf-trim{background:repeating-linear-gradient(45deg,#eef2f7 0 4px,#e3e9f0 4px 8px)}
.trimbox{position:absolute;z-index:0;background:#fff;border:1px dashed #c3ced9;
  pointer-events:none}
.trimbox .trimtag{position:absolute;right:2px;bottom:0;font-size:9px;font-style:normal;
  color:#aab6c2;background:rgba(255,255,255,.85);padding:0 3px;border-radius:3px}
.textarea{width:var(--tw);min-height:var(--th);outline:1px dashed #b9c2cc;outline-offset:0;padding:2px}
.fkbox{border:1px solid #999;padding:0;margin:0;border-radius:0;}
.khspace{display:flow-root;padding:0;border:0;}
.shade-directive{display:none}
.footnote-anchor{font-size:70%;vertical-align:super;line-height:0}
.header-anchor{display:inline-block;width:.01px;height:.01px;line-height:0}
.pro-header{position:absolute;left:var(--ml);right:var(--mr);z-index:3;line-height:1.3}
.page-footnotes{position:absolute;left:var(--ml);right:var(--mr);bottom:var(--mb);z-index:3;
 background:white;border-top:1px solid #000;font-size:9pt;line-height:1.3}
/* 状态式居右 〖JY。…〗：本行左侧内容……右侧内容（书版用三连点填满中间） */
.jyline{display:flex;align-items:baseline}
.jyline .jydots{flex:1 1 1.5em;min-width:1.5em;margin:0 .4em;
  border-bottom:1px dotted currentColor;transform:translateY(-.25em)}
.jyline .jyright{margin-left:auto;white-space:nowrap}
/* 上下注解 〖SX(…〗：上半（多为图片）定义盒子，下半（文字等）叠排其上并居中 */
.sxbox{display:inline-block;position:relative;text-align:center;vertical-align:baseline}
.sxbox.sxmath{box-sizing:border-box;padding:0 .16em .75em}
.sxbox .sxup{display:block}
.sxbox .sxdn{display:block;position:absolute;left:0;right:0;z-index:1}
.bgbox{border:1px dashed #bbb;padding:2px 4px;margin:2px 0}
.imgph{display:inline-block;border:1px dashed #7a8b9c;background:#f4f8fc;color:#3d5a75;
  padding:3px 6px;margin:1mm;max-width:calc(100% - 2mm);box-sizing:border-box;font-size:11px;border-radius:4px;text-align:center;vertical-align:middle}
.imgph.eps{border-color:#8a6d1f;background:#fff8e1;color:#7a5c00}
.imgph.miss{border-color:#c9a0a0;background:#fdeef2;color:#8a1c3c}
img.img{display:inline-block;vertical-align:middle;max-width:calc(100% - 2mm);margin:1mm;box-sizing:border-box;height:auto}
img.img.bgimg{opacity:.9}
/* 层次依《书版使用指南》9.10：背景(BJ) → 边文(BW) → 正文 */
.bglayer{position:absolute;z-index:1;pointer-events:none;left:0;top:0;
  width:var(--tw);overflow:visible}
/* 显示开关：对应书版 BYJ（隐藏背景）/ BYW（隐藏边文） */
.pageframe.pf-nobg .bglayer{display:none}
.pageframe.pf-nobw .bwband,.pageframe.pf-nobw .bwtag{display:none}
.bwband{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;
  gap:2px;pointer-events:none}
.bwband.bw-left,.bwband.bw-right{flex-direction:column}
.bwband img.img{pointer-events:auto}
.bwtag{position:absolute;z-index:4;font-size:9px;line-height:1.2;color:#5b6b7c;
  background:rgba(255,255,255,.9);border:1px solid #cfd8e3;border-radius:3px;padding:0 3px;
  white-space:nowrap;pointer-events:none}
.bwtag.bw-left,.bwtag.bw-right{writing-mode:vertical-rl;letter-spacing:.05em}
.bwtag.bw-bottom{bottom:0}.bwtag.bw-top{top:0}
/* 页别切换：一页只出现一条装订线（奇页在左、偶页在右） */
.pageframe.pf-odd .bwband.bw-even,.pageframe.pf-odd .bwtag.bw-even{display:none}
.pageframe.pf-even .bwband.bw-odd,.pageframe.pf-even .bwtag.bw-odd{display:none}
.pageframe.pf-odd .bwtag::after{content:""}
.bglayer .bgtag{font-size:9px;color:#b8860b;background:#fff8e1;border:1px solid #e0c060;
  border-radius:3px;padding:0 3px;font-style:normal;vertical-align:top}
.bgstart,.bgend{display:inline-block;width:0;height:0;overflow:hidden}
.textarea{position:relative;z-index:3}
.gt{color:#b8c4cf;cursor:help}
sup.refmark{background:none;border:0;padding:0;margin:0 @NOTE_SIDE@em;color:inherit;
  font-weight:inherit;font-size:@NOTE_PCT@%;vertical-align:@NOTE_RAISE@em;line-height:0;cursor:help}
sup.mk{background:none;color:#9aa4af;font-size:75%;vertical-align:0.3em;line-height:0;cursor:help}
sup.unk{background:none;color:#cfd8e3;font-size:60%;vertical-align:0.3em;line-height:0;cursor:help}
.chip.unk{background:#fff4f4;border-color:#e0b4b4;color:#8a1c3c;font-family:Consolas,monospace}
.eof{display:inline-block;background:#333;color:#fff;border-radius:3px;padding:0 4px;font-size:11px}
pre.stat{white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px}
pre.ast{max-height:72vh;overflow:auto;line-height:1.5}
ul.chk{margin:0;padding-left:2px;font-size:12px;list-style:none}
ul.chk li{margin:2px 0}
ul.chk li.ok{color:var(--success)}ul.chk li.warn{color:#d48806}ul.chk li.info{color:var(--text-2)}
"""
# 把注号参数填进样式（改 NOTE_PCT / NOTE_RAISE / NOTE_SIDE 即可微调）
CSS = (CSS.replace("@NOTE_PCT@", f"{NOTE_PCT:g}")
          .replace("@NOTE_RAISE@", f"{NOTE_RAISE:g}")
          .replace("@NOTE_SIDE@", f"{NOTE_SIDE:g}"))

JS = """
function tab(id,btn){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
document.getElementById(id).classList.add('on');
document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');}
function setZoom(z){document.querySelectorAll('.pageframe').forEach(f=>f.style.zoom=z);
var select=document.getElementById('zoom-choice');if(select){
 var preset=[25,50,75,100].find(p=>Math.abs(z-p/100)<0.0001);
 var current=select.querySelector('option[data-current]');
 if(preset){if(current)current.remove();select.value=String(preset);}
 else{if(!current){current=document.createElement('option');current.value='current';current.dataset.current='true';
  var fit=select.querySelector('option[value="fit"]');select.insertBefore(current,fit);}
  current.textContent='当前 '+Math.round(z*100)+'%';select.value='current';}}
}
function setZoomChoice(value){if(value==='fit'){window.fbdFitZoom=true;fitWidth();}
 else{window.fbdFitZoom=false;setZoom(Number(value)/100);}}
function updatePageNavigation(){var pages=[...document.querySelectorAll('#measured-pages .pageframe')];
 var input=document.getElementById('page-current'),count=document.getElementById('page-count');if(!input||!count||!pages.length)return;
 count.textContent=String(pages.length);input.max=String(pages.length);
 var middle=window.innerHeight/2;
 var current=pages.find(function(page){var r=page.getBoundingClientRect();return r.top<=middle&&r.bottom>=middle;});
 if(!current)current=pages.reduce(function(best,page){var r=page.getBoundingClientRect();
  var d=Math.min(Math.abs(r.top-middle),Math.abs(r.bottom-middle));return d<best.distance?{page,distance:d}:best;},{page:pages[0],distance:Infinity}).page;
 if(window.fbdPerRowMode==='2'){
  var rowTop=current.getBoundingClientRect().top;
  var row=pages.filter(function(page){return Math.abs(page.getBoundingClientRect().top-rowTop)<2;});
  current=row.find(function(page){return Number(page.dataset.page)===Number(window.fbdCurrentPage);})||row[0]||current;
 }
 var pageNumber=Number(current.dataset.page)||1;if(document.activeElement!==input)input.value=String(pageNumber);
 window.fbdCurrentPage=pageNumber;
 var rowIndex=window.fbdPerRowMode==='2'?Math.floor((pageNumber-1)/2):pageNumber-1;
 var rowCount=window.fbdPerRowMode==='2'?Math.ceil(pages.length/2):pages.length;
 document.getElementById('prev-page').disabled=rowIndex<=0;
 document.getElementById('next-page').disabled=rowIndex>=rowCount-1;
}
function goToPage(value){var pages=document.querySelectorAll('#measured-pages .pageframe');
 var input=document.getElementById('page-current'),page=Number(value);if(!pages.length||!input)return;
 if(!Number.isFinite(page)){updatePageNavigation();return;}
 page=Math.max(1,Math.min(pages.length,Math.trunc(page)));input.value=String(page);
 window.fbdCurrentPage=page;
 var targetPage=window.fbdPerRowMode==='2'?Math.floor((page-1)/2)*2+1:page;
 var target=document.querySelector('#measured-pages .pageframe[data-page="'+targetPage+'"]');
 if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
}
function movePage(delta){var input=document.getElementById('page-current');
 if(input)goToPage((Number(input.value)||1)+delta*(window.fbdPerRowMode==='2'?2:1));}
document.addEventListener('scroll',function(){requestAnimationFrame(updatePageNavigation);},true);
window.addEventListener('message',function(event){var data=event.data;
 if(event.source!==window.parent||!data||data.type!=='shuban-perrow-setting')return;
 var el=document.getElementById('layout-config'),config=el?JSON.parse(el.textContent):null;
 if(!config||data.file!==config.file)return;
 if(window.setPerRow)window.setPerRow(data.value==='2'?'2':'1',false);
});
function setParity(p){var f=document.querySelector('.pageframe');if(!f)return;
f.classList.remove('pf-odd','pf-even');if(p!=='all')f.classList.add('pf-'+p);
document.querySelectorAll('.paritybtn').forEach(b=>b.classList.remove('on'));
var el=document.getElementById('pb-'+p);if(el)el.classList.add('on');}
function setLayer(k){
var cls=k==='bg'?'pf-nobg':'pf-nobw';var off=document.body.classList.toggle(k==='bg'?'hide-bg':'hide-bw');
document.querySelectorAll('.pageframe').forEach(el=>el.classList.toggle(cls,off));
var b=document.getElementById('lb-'+k);if(b){b.classList.toggle('on',!off);
b.setAttribute('aria-pressed',String(!off));}}
function toggleOperations(){var d=document.getElementById('operations');if(d.open)d.close();else d.showModal();}
document.addEventListener('DOMContentLoaded',function(){
 var d=document.getElementById('operations'),content=document.getElementById('operations-content');
 if(d&&content){
  document.querySelectorAll('main .tabs,main .note,main .zoombar').forEach(el=>content.appendChild(el));
  d.addEventListener('click',function(e){if(e.target===d){var r=d.getBoundingClientRect();
   if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
  d.addEventListener('close',function(){var btn=document.getElementById('operationsbtn');
   if(btn)btn.setAttribute('aria-expanded','false');});
  var btn=document.getElementById('operationsbtn');
  if(btn)btn.addEventListener('click',function(){this.setAttribute('aria-expanded',String(d.open));});
 }
});
/* 悬浮按钮：切换顶部工具栏显隐 */
function toggleHeader(){var off=document.body.classList.toggle('hide-header');
 var b=document.getElementById('hdrbtn');if(b){b.classList.toggle('on',!off);
 b.setAttribute('aria-pressed',String(!off));
 b.title=off?'显示顶部工具栏':'隐藏顶部工具栏';}}
/* 颜色栏：隐藏清单同步到「下载 PDF/Word」链接（&hide=十六进制色值列表） */
function updateExportLinks(hidden){
 var q = (hidden && hidden.length) ? '&hide=' + hidden.map(encodeURIComponent).join(',') : '';
 document.querySelectorAll('a.hbtn[data-base]').forEach(function(a){
  a.href = a.getAttribute('data-base') + q;});
}
/* 信息侧栏：抽屉式，隐藏后预览铺满整屏 */
function toggleInfo(force){var open=(force===undefined)
  ?!document.body.classList.contains('info-open'):!!force;
 document.body.classList.toggle('info-open',open);
 var b=document.getElementById('infobtn');if(b)b.classList.toggle('on',open);}
/* Fit the current row layout; actual-size remains an explicit 1:1 choice. */
function fitWidth(){fitPerRow(window.fbdPerRowMode||'1');}
document.addEventListener('keydown',function(e){
 if(e.key==='Escape'){toggleInfo(false);}
 if(!e.ctrlKey)return;var f=document.querySelector('.pageframe');if(!f)return;
 var z=parseFloat(f.style.zoom||'1');
 if(e.key==='='||e.key==='+'){window.fbdFitZoom=false;setZoom(Math.min(4,z+0.1));e.preventDefault();}
 if(e.key==='-'){window.fbdFitZoom=false;setZoom(Math.max(0.1,z-0.1));e.preventDefault();}});
document.addEventListener('wheel',function(e){            /* Ctrl+滚轮缩放 */
 if(!e.ctrlKey)return;var f=document.querySelector('.pageframe');if(!f)return;
 e.preventDefault();var z=parseFloat(f.style.zoom||'1');
 window.fbdFitZoom=false;
 setZoom(Math.min(4,Math.max(0.1,z*(e.deltaY<0?1.1:1/1.1))));},{passive:false});
/* 首次加载：默认 100%（实际大小）居中；分页完成后若窗口放不下页面实际宽度则自动铺满 */
window.addEventListener('load',function(){var f=document.querySelector('.pageframe');
 if(f&&f.dataset.zoom)setZoom(parseFloat(f.dataset.zoom));});
/* Adapt the scale to the actual page count per row and its grid gap. */
function fitPerRow(mode){
 window.fbdFitZoom=true;
 var w=document.querySelector('.pagewrap'),f=document.querySelector('.pageframe');
 if(!w||!f)return;
 f.style.zoom=1;var nat=f.offsetWidth||1;               // zoom=1 下的自然页宽
 var avail=w.clientWidth-30;
 var perRow=mode==='2'?2:1,gapPx=0;
 if(perRow===2){var mp=document.getElementById('measured-pages');
  gapPx=parseFloat(getComputedStyle(mp).columnGap)||0;}
 var layoutWidth=nat*perRow+gapPx;
 if(layoutWidth>avail&&avail>80)setZoom(Math.max(.12,Math.min(2,(avail-gapPx)/(nat*perRow))));
 else setZoom(1);
}
window.addEventListener('fbdlayoutdone',function(){
 updatePageNavigation();fitPerRow(window.fbdPerRowMode||'1');});
window.addEventListener('resize',function(){if(window.fbdFitZoom)fitWidth();});
"""

with open(os.path.join(os.path.dirname(__file__), 'pagination.js'), encoding='utf-8') as _js_file:
    JS += '\n' + _js_file.read()


def ast_html(dec, lex, max_lines: int = 2500) -> str:
    """AST 树视图（P2）：节点统计 + 缩进树 + 配对告警/预期说明。"""
    from . import annotations as annot_mod
    from .ast import build, summarize, tree_text
    from .macros import MacroStats, expand
    res = build(lex.tokens, annot_mod.default())
    st = MacroStats()
    expand(lex.tokens, res.defs, stats=st)
    info = summarize(res.root)
    head = (f"节点 {info['nodes']:,}（{', '.join(f'{k}×{v}' for k, v in info['kinds'].items())}）；"
            f"最大嵌套深度 {info['max_depth']}；跨越闭合 {info['crossed']}；"
            f"自定义注解定义 {len(res.defs)} 个（{'、'.join(sorted(res.defs))}）；"
            f"宏调用 {st.calls} 次（带参 {st.calls_with_args}），成功展开 {st.expanded} 次")
    if st.undefined:
        head += f"；未定义引用 {'、'.join(sorted(set(st.undefined)))}"
    body = tree_text(res.root, max_lines=max_lines)
    extra = ""
    if res.warnings:
        extra += '<div class="note">配对告警：' + "；".join(html.escape(w) for w in res.warnings[:20]) + "</div>"
    if res.notes:
        extra += ('<div class="note">预期情况（不计告警）：'
                  + "；".join(html.escape(w) for w in res.notes[:10]) + "</div>")
    return (f'<div class="note">{html.escape(head)}</div>{extra}'
            f'<pre class="stat ast">{html.escape(body)}</pre>')


def page(dec, lex, rep, geo, fbd_path: str, title: str, rel: str = "",
         root: str | None = None, inline: bool = False) -> str:
    from urllib.parse import quote
    stats = report_mod.format_stats(rep, show_samples=True)
    warns = "".join(f"<li>{html.escape(w)}</li>" for w in rep["warnings"]) or "<li>无</li>"
    low = "".join(f"<li><b>{html.escape(k)}</b>：{html.escape(' | '.join(v))}</li>"
                  for k, v in rep["low_confidence"].items()) or "<li>无</li>"
    unknown = "".join(f"<li><code>{html.escape(u['hex'])}</code>（行 {u['line']}）："
                      f"{html.escape(u['note'])}</li>" for u in rep["unknown_bytes"]) or "<li>无</li>"
    # 页面/成品的关系如实说明：只有真的存在出血区才写“含出血”（与预览图注同源）
    _bleed_txt = bleed_note(geo)
    _ext = ext_font_usage(lex)
    _ext_txt = ('<tr><td>外挂字体</td><td>' + "、".join(
        f"{html.escape(k)} ×{v}" for k, v in sorted(_ext.items()))
        + '<span class="muted">（GBK 字符用它；系统未安装该字体时按方正字体降级显示）</span>'
        '</td></tr>') if _ext else ""
    ctrl = "".join(f"<tr><td>{html.escape(k)}</td><td>{v}</td></tr>"
                   for k, v in sorted(rep["ctrl"].items()))
    _nav = (f'<a id="dl-pdf" class="hbtn" data-base="/api/pdf?f={quote(rel)}" href="/api/pdf?f={quote(rel)}" '
            f'title="用无头浏览器把成品版式打印为 PDF（每页框一页）；颜色栏的隐藏状态会同步到导出">⬇ 下载 PDF</a>'
            f'<a id="dl-word" class="hbtn" data-base="/api/word?f={quote(rel)}" href="/api/word?f={quote(rel)}" '
            f'title="导出可编辑的内容流 Word（分栏/表格/图片/字体近似还原）；被隐藏的颜色内容不导出">⬇ 下载 Word</a>'
            ) if rel else ''
    _pw = geo.page_w or round((geo.text_w or 180)
                              + (geo.m_left if geo.m_left is not None else 15)
                              + (geo.m_right if geo.m_right is not None else 15), 2)
    _ph = geo.page_h or round((geo.text_h or 260)
                              + (geo.m_top if geo.m_top is not None else 15)
                              + (geo.m_bottom if geo.m_bottom is not None else 15), 2)
    return f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>{html.escape(title)} — fbdview</title><style>{CSS}
@page{{size:{_pw:g}mm {_ph:g}mm;margin:0}}</style></head><body class="hide-bg hide-bw">
<!-- 背景图/边文默认不显示，按钮文案固定「✓」，点击 setLayer 切换（对应书版 BYJ/BYW） -->
<header><h1>{html.escape(title)}</h1>
<div class="hbtns">
 <a class="hbtn" href="/" title="返回文件列表（网站首页）">首页</a>
 <button id="operationsbtn" onclick="toggleOperations()" aria-haspopup="dialog" aria-controls="operations" aria-expanded="false">常用操作</button>
 <button id="infobtn" onclick="toggleInfo()" title="显示/隐藏版面几何、校验、控制符、告警等信息（不影响预览宽度）">📋 信息侧栏</button>
 <button id="hdrbtn" class="on" onclick="toggleHeader()" aria-pressed="true"
   title="显示/隐藏顶部工具栏内的其它元素（本按钮保留，用于恢复）">工具栏</button>
</div></header>
<div class="backdrop" onclick="toggleInfo(false)"></div>
<dialog id="operations" class="operations" aria-labelledby="operations-title">
 <div class="operations-head"><strong id="operations-title">常用操作</strong><button onclick="document.getElementById('operations').close()">关闭 ✕</button></div>
 <div class="operations-nav">{_nav}</div>
 <div id="operations-content"></div>
</dialog>
<div class="wrap">
<aside id="info">
 <div class="ihead"><span>文件信息</span>
   <button onclick="toggleInfo(false)">关闭 ✕</button></div>
 <div class="box"><h3>文件</h3>
  <table class="kv">
   <tr><td>路径</td><td style="word-break:break-all">{html.escape(fbd_path)}</td></tr>
   <tr><td>大小</td><td>{rep['size']:,} 字节</td></tr>
   <tr><td>行数</td><td>{rep['lines']:,} 行</td></tr>
   <tr><td>注解</td><td>{rep['annot_total']:,} 处</td></tr>
   {'<tr><td>导航</td><td><a href="/">← 返回文件列表</a>　<a href="/api/report?f=' + quote(rel) + '">JSON 报告</a></td></tr>' if rel else ''}
  </table>
 </div>
 <div class="box"><h3>显示</h3>
  <table class="kv">
   <tr><td>缩放</td><td>默认按声明尺寸 1:1 显示并居中（1mm = 3.7795px，{_pw:g}mm → {round(_pw * 3.7795):g}px）；窗口宽度放不下页面时自动铺满宽度</td></tr>
   <tr><td>操作</td><td>缩放用「常用操作」里的按钮或 Ctrl+滚轮；「每行 2 页」可并排预览；「工具栏」按钮可隐藏顶部工具栏</td></tr>
  </table>
 </div>
 <div class="box"><h3>版面几何（BP + PRO）</h3>
  <table class="kv">
   <tr><td>页面</td><td>{geo.page_w or '—'} × {geo.page_h or '—'} mm{_bleed_txt}</td></tr>
   <tr><td>成品</td><td>{geo.trim_w or '—'} × {geo.trim_h or '—'} mm{
       '（页面每边内缩 %g/%g mm）' % trim_insets(geo)
       if (trim_insets(geo)[0] or trim_insets(geo)[1]) else ''}</td></tr>
   <tr><td>版心</td><td>{geo.text_w or '—'} × {geo.text_h or '—'} mm</td></tr>
   <tr><td>边空</td><td>上 {geo.m_top or '—'} / 下 {geo.m_bottom or '—'} / 左 {geo.m_left or '—'} / 右 {geo.m_right or '—'} mm</td></tr>
   <tr><td>分栏</td><td>{geo.columns} 栏{('（栏宽 %g mm）' % geo.column_w) if geo.column_w else ''}{('，栏距 %g mm' % geo.column_gap) if geo.column_gap else ''}{('，' + html.escape(geo.column_rule)) if geo.column_rule else ''}</td></tr>
   <tr><td>行高</td><td>{('行距 %g mm + 字高 %g mm = %g mm' % (geo.line_gap_mm, mm_of(geo.base_pt), geo.line_pitch_mm)) if geo.line_pitch_mm else '未定'}</td></tr>
   <tr><td>容量</td><td>{('约 %d 行/页' % geo.lines_per_page) if geo.lines_per_page else '—'}；{('约 %d 字/行' % geo.chars_per_line) if geo.chars_per_line else '—'}<span class="muted">（未计标点挤压/禁则/HJ 覆盖）</span></td></tr>
   <tr><td>基准字号</td><td>{geo.base_pt or '—'} pt{('（' + html.escape(font_name(geo.base_font[:2])) + '）') if geo.base_font else ''}</td></tr>
   {_ext_txt}<tr><td>来源</td><td>{html.escape(geo.source)}</td></tr>
  </table>
 </div>
 <div class="box"><h3>几何校验</h3>
  <ul class="chk">{''.join(
      f'<li class="{c["level"]}">{ {"ok":"✓","warn":"⚠","info":"·"}.get(c["level"],"·") } {html.escape(c["text"])}</li>'
      for c in geo.checks) or '<li>—</li>'}</ul>
  {''.join(f'<div class="note">{html.escape(n)}</div>' for n in geo.notes)}
 </div>
 <div class="box"><h3>控制符</h3><table class="kv">{ctrl}</table></div>
 <div class="box"><h3>告警（{len(rep['warnings'])}）</h3><ul class="warn">{warns}</ul></div>
 <div class="box"><h3>待确认注解</h3><ul class="warn">{low}</ul></div>
 <div class="box"><h3>未知用户区字节</h3><ul class="warn">{unknown}</ul></div>
 <div class="box"><h3>PRO</h3><div style="font-size:12px">
   {'有：' + html.escape(os.path.basename(rep['pro']['path'])) if rep['pro']['exists'] else '同名 .PRO 未找到'}</div></div>
</aside>
<main>
 <div class="tabs">
  <button class="on" onclick="tab('v1',this)">近似排版</button>
  <button onclick="tab('v2',this)">结构视图</button>
  <button onclick="tab('v5',this)">AST 树</button>
  <button onclick="tab('v3',this)">纯文本</button>
  <button onclick="tab('v4',this)">统计</button>
 </div>
 <div id="v1" class="panel on">{preview_html(dec, lex, geo, fbd_path, root, inline)}</div>
 <div id="v2" class="panel">{structure_html(dec, lex)}</div>
 <div id="v5" class="panel">{ast_html(dec, lex)}</div>
 <div id="v3" class="panel">{plain_html(dec, lex)}</div>
 <div id="v4" class="panel"><pre class="stat">{html.escape(stats)}</pre></div>
</main></div>
<script>{JS}</script></body></html>"""


_ROOT_HINT = "."
