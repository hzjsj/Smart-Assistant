import type { ShubanFile } from './data';

export function createQueryKeys(userId: string) {
  const scope = ['shuban', userId];
  const document = (file?: ShubanFile) => [...scope, 'documents', file?.id || '', file?.version || ''];
  return {
    scope,
    files: [...scope, 'files'],
    templates: [...scope, 'word-templates'],
    report: (file?: ShubanFile) => [...document(file), 'report'],
    preview: (file?: ShubanFile) => [...document(file), 'preview'],
    tokens: (file?: ShubanFile) => [...document(file), 'tokens'],
    ast: (file?: ShubanFile) => [...document(file), 'ast'],
    text: (file?: ShubanFile) => [...document(file), 'text'],
  };
}
