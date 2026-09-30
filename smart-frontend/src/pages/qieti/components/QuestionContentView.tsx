import { Image, Typography } from 'antd';
import { useStyles } from '../cut/styles';
import {
  normalizeMathDelimiters,
  stripOptionPrefix,
} from '../utils/questionUtils';
import MathText from './MathText';

const { Text } = Typography;

interface QuestionContentViewProps {
  mergedImage?: string;
  stemText?: string;
  figures?: string[];
  optionTexts?: string[];
  subquestionTexts?: string[];
  /** 隐藏「题干内容」分节标签，题干文本直接显示 */
  hideStemLabel?: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      type="secondary"
      style={{ fontSize: 12, display: 'block', marginTop: 4 }}
    >
      {children}
    </Text>
  );
}

/** 题目结构化内容渲染：题干图片/题干/插图/选项/小题（KaTeX 公式感知） */
export default function QuestionContentView({
  mergedImage,
  stemText,
  figures,
  optionTexts,
  subquestionTexts,
  hideStemLabel = false,
}: QuestionContentViewProps) {
  const { styles } = useStyles();

  if (
    !mergedImage &&
    !stemText &&
    !figures?.length &&
    !optionTexts?.length &&
    !subquestionTexts?.length
  ) {
    return <Text type="secondary">暂无可渲染题目内容</Text>;
  }

  return (
    <div>
      {mergedImage ? (
        <>
          <SectionLabel>题干图片</SectionLabel>
          <Image
            className={styles.mathImage}
            src={mergedImage}
            alt="题干图片"
          />
        </>
      ) : null}

      {stemText ? (
        <>
          {hideStemLabel ? null : <SectionLabel>题干内容</SectionLabel>}
          <MathText text={stemText} />
        </>
      ) : null}

      {figures?.length ? (
        <>
          <SectionLabel>插图</SectionLabel>
          <Image.PreviewGroup>
            {figures.map((url) => (
              <Image
                key={`fig-${url}`}
                className={styles.mathImage}
                src={url}
                alt="插图"
              />
            ))}
          </Image.PreviewGroup>
        </>
      ) : null}

      {optionTexts?.length ? (
        <>
          <SectionLabel>选项</SectionLabel>
          {optionTexts.map((text, idx) => (
            <div key={`opt-${text}`}>
              {String.fromCharCode(65 + idx)}.{' '}
              <MathText
                text={stripOptionPrefix(normalizeMathDelimiters(text))}
              />
            </div>
          ))}
        </>
      ) : null}

      {subquestionTexts?.length ? (
        <>
          <SectionLabel>小题</SectionLabel>
          {subquestionTexts.map((text, idx) => (
            <div key={`sub-${text}`}>
              {idx + 1}. <MathText text={text} />
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
