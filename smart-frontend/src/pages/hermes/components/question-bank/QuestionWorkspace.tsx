import { Drawer, Splitter } from 'antd';
import React, { useContext, useEffect, useLayoutEffect, useState } from 'react';
import {
  DEFAULT_WORKSPACE_SIZES,
  useWorkspaceMotion,
  workspacePercentages,
} from '../../question-bank/workspaceMotion';
import QuestionBankTitle from './QuestionBankTitle';
import { useQuestionBankStyles } from './style';
import { WorkbenchActionsContext } from './WorkbenchActionsContext';

/** The chat stays in the same Panel across open/close to preserve its live stream. */
const QuestionWorkspace: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  titleKey?: string;
  onSaveTitle?: (title: string) => void;
  panel: React.ReactNode;
  children: React.ReactNode;
}> = ({ open, onClose, title, titleKey, onSaveTitle, panel, children }) => {
  const { styles } = useQuestionBankStyles();
  const actions = useContext(WorkbenchActionsContext);
  const [wide, setWide] = useState(
    () => window.matchMedia('(min-width: 1000px)').matches,
  );
  const [sizes, setSizes] = useState<string[]>([...DEFAULT_WORKSPACE_SIZES]);
  const split = open && wide;
  const moving = useWorkspaceMotion(split, wide);
  const phase = split
    ? moving
      ? 'opening'
      : 'open'
    : moving
      ? 'closing'
      : 'closed';
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1000px)');
    const change = () => setWide(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    if (split) setSizes([...DEFAULT_WORKSPACE_SIZES]);
  }, [split]);
  return (
    <div
      className={styles.shell}
      data-open={split}
      data-workspace-open={open}
      data-workspace-phase={phase}
      style={
        {
          '--hermes-chat-size': split ? sizes[0] : '100%',
          '--hermes-bank-size': split ? sizes[1] : '0%',
          '--hermes-bank-fraction': Number.parseFloat(sizes[1]) / 100,
        } as React.CSSProperties
      }
    >
      <Splitter
        className={styles.splitter}
        data-open={split}
        data-moving={moving}
        onResize={(next) => setSizes(workspacePercentages(next))}
        onDraggerDoubleClick={() => setSizes([...DEFAULT_WORKSPACE_SIZES])}
        destroyOnHidden={false}
      >
        <Splitter.Panel
          size={split ? sizes[0] : '100%'}
          min={split && !moving ? 280 : 0}
          resizable={split && !moving}
          destroyOnHidden={false}
        >
          <div className={styles.chatPane}>
            <div
              className={styles.chatToolbar}
              aria-hidden={!open}
              inert={!open}
            >
              {/* 工作台关闭时工具栏高度为 0，导航按钮若渲染会以幽灵按钮的
                  形式露出顶部边缘（inert 不可点），误导用户悬浮——故不渲染。 */}
              {open && actions.navigation}
              {!wide && actions.close}
            </div>
            {children}
          </div>
        </Splitter.Panel>
        <Splitter.Panel
          size={split ? sizes[1] : 0}
          min={split && !moving ? 280 : 0}
          resizable={split && !moving}
          destroyOnHidden={false}
        >
          <div
            className={styles.bankReveal}
            aria-hidden={!split}
            inert={!split}
          >
            <div className={styles.workbenchToolbar}>
              <QuestionBankTitle
                key={titleKey}
                title={title}
                onSave={onSaveTitle}
              />
              {actions.close}
            </div>
            {wide ? panel : null}
          </div>
        </Splitter.Panel>
      </Splitter>
      {!wide && (
        <Drawer
          open={open}
          onClose={onClose}
          title={
            <QuestionBankTitle
              key={titleKey}
              title={title}
              onSave={onSaveTitle}
            />
          }
          size="large"
          styles={{ body: { padding: 0, display: 'flex', overflow: 'hidden' } }}
          destroyOnHidden={false}
        >
          {panel}
        </Drawer>
      )}
    </div>
  );
};

export default QuestionWorkspace;
