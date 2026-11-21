/** 跨页共享的深度思考面板（chat / chatbot / copilot 三页共用）。 */
import { Think } from '@ant-design/x';
import type { ComponentProps } from '@ant-design/x-markdown';
import React from 'react';

type ChatKitThinkProps = ComponentProps & {
  /** 流未完成时面板默认展开（chat / chatbot 传入，copilot 不传走默认收起） */
  defaultExpanded?: boolean;
};

/** 深度思考面板：XMarkdown 把 <think> 标签渲染为此组件，流状态驱动标题 */
export const ChatKitThink = React.memo((props: ChatKitThinkProps) => {
  const [title, setTitle] = React.useState('深度思考中...');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (props.streamStatus === 'done') {
      setTitle('思考完成');
      setLoading(false);
    }
  }, [props.streamStatus]);

  return (
    <Think
      title={title}
      loading={loading}
      defaultExpanded={props.defaultExpanded}
    >
      {props.children}
    </Think>
  );
});
