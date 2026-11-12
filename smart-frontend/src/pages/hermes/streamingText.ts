const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });

/** Keep a completed display formula in one update; expose inline math as source. */
export function nextTextEnd(
  text: string,
  cursor: number,
  step: number,
  finished: boolean,
): number {
  let end = cursor;
  let count = 0;
  for (const part of segmenter.segment(text.slice(cursor))) {
    end += part.segment.length;
    if (++count >= step) break;
  }

  // Formula delimiters inside code fences must remain ordinary code.
  const protectedBlocks =
    /(```|~~~)[\s\S]*?(?:\1|$)|(?<!\\)\$\$[\s\S]*?(?:(?<!\\)\$\$|$)|\\\[[\s\S]*?(?:\\\]|$)/g;
  for (const match of text.matchAll(protectedBlocks)) {
    const start = match.index;
    const close = start + match[0].length;
    if (match[0].startsWith('```') || match[0].startsWith('~~~')) {
      if (cursor >= start && cursor < close) return end;
      continue;
    }
    if (cursor >= start && cursor < close) {
      const closed = match[0].startsWith('$$')
        ? match[0].length >= 4 && match[0].endsWith('$$')
        : match[0].endsWith('\\]');
      return closed ? close : finished ? end : cursor;
    }
    if (end > start && cursor < start) return start;
  }

  return end;
}
