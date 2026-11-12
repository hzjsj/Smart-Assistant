import type XMarkdown from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import type { ComponentProps } from 'react';

const extensions = Latex({
  katexOptions: { output: 'html', throwOnError: false, trust: false },
});

// The installed plugin marks inline math as displayMode:true and can match a
// single closing $ against an opening $$. Use paired delimiters explicitly.
for (const extension of extensions) {
  if (extension.name !== 'inlineKatex' || !('tokenizer' in extension)) continue;
  extension.tokenizer = (source: string) => {
    const delimiters = source.startsWith('$$')
      ? ['$$', '$$']
      : source.startsWith('$')
        ? ['$', '$']
        : source.startsWith('\\(')
          ? ['\\(', '\\)']
          : source.startsWith('\\[')
            ? ['\\[', '\\]']
            : null;
    if (!delimiters) return;
    const [open, close] = delimiters;
    let end = source.indexOf(close, open.length);
    while (end !== -1 && source[end - 1] === '\\' && close === '$') {
      end = source.indexOf(close, end + close.length);
    }
    if (end === -1 || end === open.length) return;
    const text = source
      .slice(open.length, end)
      .replaceAll('{align*}', '{aligned}');
    return {
      type: 'inlineKatex',
      raw: source.slice(0, end + close.length),
      text,
      displayMode: open === '$$' || open === '\\[',
      isBlock: open === '$$' || open === '\\[',
    };
  };
}

export const markdownConfig: NonNullable<
  ComponentProps<typeof XMarkdown>['config']
> = {
  extensions,
};
