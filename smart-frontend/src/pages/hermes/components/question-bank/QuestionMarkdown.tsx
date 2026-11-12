import XMarkdown from '@ant-design/x-markdown';
import React from 'react';
import { markdownConfig } from '../../markdown';

export const QuestionMarkdown: React.FC<{ content: string }> = ({
  content,
}) => (
  <XMarkdown
    content={content}
    config={markdownConfig}
    openLinksInNewTab
    escapeRawHtml
    streaming={{ hasNextChunk: false, enableAnimation: false, tail: false }}
  />
);
