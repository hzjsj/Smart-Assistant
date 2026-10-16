"""Independent HT/WT/ST state, shared by flow and measured page rendering."""
from dataclasses import dataclass, replace
from .sizes import parse_ht, family_css, PT2MM, CSS_PT_SCALE


@dataclass
class Font:
    vertical: float
    horizontal: float
    code: str
    external: str | None = None
    bold: bool = False
    italic: bool = False
    han_only: bool = False


class FontState:
    def __init__(self, vertical=10.5, horizontal=None, han="SS", western="BZ", digits="BZ", aliases=None):
        horizontal = horizontal or vertical
        self.defaults = {"HT": Font(vertical, horizontal, han),
                         "WT": Font(vertical, horizontal, western),
                         "ST": Font(vertical, horizontal, digits)}
        self.fonts = {k: replace(v) for k, v in self.defaults.items()}
        self.digit_auto = False
        self.aliases = aliases or {}
        self.warnings = set()

    def apply(self, channel, params):
        if channel == "ST" and params.strip() in ("+", "-", "＋", "－"):
            self.digit_auto = params.strip() in ("+", "＋")
            return
        if not params:
            self.fonts[channel] = replace(self.defaults[channel])
        else:
            d = parse_ht(params)
            f = self.fonts[channel]
            if d["pt_v"] is not None:
                f.vertical = d["pt_v"]
            if d["pt_h"] is not None:
                f.horizontal = d["pt_h"]
            if d["code"]:
                f.code = d["code"]
            if channel != "ST":
                if d["cancel_ext"]:
                    f.external = None
                    f.bold = f.italic = False
                if d["ext"]:
                    f.external = self.aliases.get(d["ext"], d["ext"])
                    f.bold, f.italic, f.han_only = d["bold"], d["italic"], d["bang"]
            elif d["ext"]:
                self.warnings.add("ST 不支持外挂字体；请使用 HT 或 WT")
            if d["rest"]:
                self.warnings.add(f"{channel} 未识别参数：{d['rest']}")
        if channel == "WT" and self.digit_auto:
            # Built-in BZ/HZ pairing; custom WT_ST.TAB is not silently assumed.
            self.fonts["ST"].code = self.fonts["WT"].code

    def select(self, char):
        if char.isascii() and char.isdigit():
            f = replace(self.fonts["ST"])
            w = self.fonts["WT"]
            if w.external:
                f.external, f.bold, f.italic = w.external, w.bold, w.italic
            return "ST", f
        if char.isascii() or ('\u00c0' <= char <= '\u024f' and char.isalpha()):
            return "WT", self.fonts["WT"]
        f = replace(self.fonts["HT"])
        if f.han_only and not ('\u3400' <= char <= '\u9fff'):
            f.external = None
        if '\ue000' <= char <= '\uf8ff':
            f.external = None
        return "HT", f

    @staticmethod
    def css(f, gap):
        return (f"font-size:{f.vertical * CSS_PT_SCALE:g}pt;font-family:{family_css(f.code, f.external)};"
                f"font-weight:{700 if f.bold else 400};font-style:{'italic' if f.italic else 'normal'};"
                f"line-height:{f.vertical * PT2MM + gap:g}mm")
