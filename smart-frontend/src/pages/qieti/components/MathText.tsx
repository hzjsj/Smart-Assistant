import { BlockMath, InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { normalizeMathDelimiters } from '../utils/questionUtils';

interface MathTextProps {
  text: string;
}

interface Segment {
  kind: 'block' | 'inline' | 'text';
  /** 在原文本中的起始位置，用作稳定的 React key */
  start: number;
  expr?: string;
  value?: string;
}

/** 把含 $...$ / $$...$$ 的文本切分为数学段与普通文本段 */
function splitSegments(input: string): Segment[] {
  const text = normalizeMathDelimiters(input);
  const segments: Segment[] = [];
  // 优先匹配 $$...$$，再匹配 $...$
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      segments.push({
        kind: 'text',
        value: text.slice(lastIndex, match.index),
        start: lastIndex,
      });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: 'block', expr: match[1], start: match.index });
    } else {
      segments.push({ kind: 'inline', expr: match[2], start: match.index });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({
      kind: 'text',
      value: text.slice(lastIndex),
      start: lastIndex,
    });
  }
  return segments;
}

/** 数学公式感知的文本渲染：$..$ 行内公式、$$..$$ 块级公式（KaTeX） */
export default function MathText({ text }: MathTextProps) {
  if (!text) return null;
  const segments = splitSegments(text);
  return (
    <span>
      {segments.map((seg) => {
        if (seg.kind === 'block')
          return <BlockMath key={`blk-${seg.start}`} math={seg.expr ?? ''} />;
        if (seg.kind === 'inline')
          return <InlineMath key={`inl-${seg.start}`} math={seg.expr ?? ''} />;
        return <span key={`txt-${seg.start}`}>{seg.value}</span>;
      })}
    </span>
  );
}
