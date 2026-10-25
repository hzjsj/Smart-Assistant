"""PRO context with explicit provenance; unsupported global settings stay visible."""
import os
import re
from dataclasses import dataclass, field
from .bytes_io import read
from .lexer import tokenize
from .layout import parse_bx


@dataclass
class Context:
    path: str | None = None
    bx: dict = field(default_factory=dict)
    aliases: dict = field(default_factory=dict)
    settings: dict = field(default_factory=dict)
    tokens: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    headings: dict = field(default_factory=dict)


def load_context(fbd_path, pro_path=None):
    result = Context()
    candidate = pro_path or os.path.splitext(fbd_path)[0] + ".PRO"
    if not os.path.isfile(candidate) and not pro_path:
        directory = os.path.dirname(os.path.abspath(fbd_path))
        stem = os.path.splitext(os.path.basename(fbd_path))[0].casefold()
        candidate = next((os.path.join(directory, f) for f in os.listdir(directory)
                          if os.path.splitext(f)[0].casefold() == stem and f.lower().endswith('.pro')), candidate)
    if not os.path.isfile(candidate):
        result.warnings.append("未找到配套 PRO；使用小样提示及默认值")
        return result
    result.path = os.path.abspath(candidate)
    dec = read(candidate)
    result.bx = parse_bx(dec)
    result.tokens = tokenize(dec).tokens
    for t in result.tokens:
        if t.kind != "annot":
            continue
        result.settings.setdefault(t.name, []).append(t.params)
        if t.name == "KD":
            names = re.findall(r"《([^》]+)》", t.params)
            if len(names) == 2:
                result.aliases[names[0]] = names[1]
        if t.name == 'BD':
            m = re.match(r'(\d+)[,，](.+)[,，](\d+[^,，]*)$', t.params)
            if m:
                result.headings[m.group(1)] = {'fonts':m.group(2), 'lines':int(re.match(r'\d+',m.group(3)).group())}
    return result
