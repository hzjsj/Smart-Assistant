import { PageContainer } from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import { Alert, Spin } from 'antd';
import type Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { Group, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import questions from './questions.json';
import { useStyles } from './styles';

/**
 * test/qieti 原型预览页（仅用于对照参考，不参与业务）。
 * 代码照搬 test/qieti/index.tsx，差异仅两处：
 * 1. 缩放系数由硬编码的 668/1701 改为「画布实测宽度 / 背景图原始宽度」，
 *    避免换屏后矩形与底图错位；
 * 2. 内联样式改为 createStyles（数值不变）。
 */

type RectangleProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  id: string;
  questionNumber: number;
};

/** 序号样式常量（同原型） */
const LABEL_STYLE = {
  width: 40,
  height: 20,
  padding: 6,
  borderRadius: [0, 0, 4, 4] as [number, number, number, number],
  fontSize: 12,
  fontWeight: 500,
  fontFamily: 'Arial',
  colors: {
    selected: { bg: '#004fff', text: '#fff' },
    normal: { bg: 'rgba(0, 79, 255, 0.2)', text: 'rgba(0, 79, 255, 0.5)' },
  },
};

/**
 * 原型的底图来自 http://imgcdn.hw0551.com/test/3.png（1701×2386），
 * 该域名 HTTPS 证书无效（ERR_CERT_COMMON_NAME_INVALID），故下载到 public/ 本地引用
 */
const BACKGROUND_IMAGE = { url: '/qieti-prototype-bg.png' };
const MIN_SIZE = 5;

/** 矩形组件（同原型 Rectangle） */
const Rectangle = ({
  shapeProps,
  isSelected,
  onSelect,
  onChange,
  allQuestions,
  selectedId,
}: {
  shapeProps: RectangleProps;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (attrs: RectangleProps) => void;
  allQuestions: RectangleProps[];
  selectedId: string | null;
}) => {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.attachTo(shapeRef.current);
    } else if (trRef.current) {
      trRef.current.detach();
    }
  }, [isSelected]);

  const handleDrag = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ ...shapeProps, x: e.target.x(), y: e.target.y() });
  };

  const handleTransform = (node: Konva.Rect | null, resetScale = false) => {
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    if (resetScale) {
      node.scaleX(1);
      node.scaleY(1);
    }
    onChange({
      ...shapeProps,
      x: node.x(),
      y: node.y(),
      width: Math.max(MIN_SIZE, node.width() * scaleX),
      height: Math.max(MIN_SIZE, node.height() * scaleY),
    });
  };

  // 当前矩形被选中，或同题号矩形被选中时高亮
  const shouldHighlight =
    isSelected ||
    allQuestions.some(
      (q) =>
        q.id === selectedId && q.questionNumber === shapeProps.questionNumber,
    );
  const currentLabelStyle = isSelected
    ? LABEL_STYLE.colors.selected
    : LABEL_STYLE.colors.normal;
  const rectFill = shouldHighlight ? 'rgba(0, 79, 255, 0.1)' : shapeProps.fill;

  return (
    <>
      <Rect
        onClick={onSelect}
        onTap={onSelect}
        ref={shapeRef}
        {...shapeProps}
        fill={rectFill}
        draggable
        onDragMove={handleDrag}
        onDragEnd={handleDrag}
        onTransform={() => handleTransform(shapeRef.current)}
        onTransformEnd={() => handleTransform(shapeRef.current, true)}
      />

      {/* 序号标签 */}
      <Group
        x={shapeProps.x + shapeProps.width - LABEL_STYLE.width}
        y={shapeProps.y - LABEL_STYLE.height}
        onClick={onSelect}
        onTap={onSelect}
      >
        <Rect
          width={LABEL_STYLE.width}
          height={LABEL_STYLE.height}
          cornerRadius={LABEL_STYLE.borderRadius}
          fill={currentLabelStyle.bg}
          strokeWidth={0}
        />
        <Text
          x={LABEL_STYLE.padding}
          y={LABEL_STYLE.padding}
          text={`${shapeProps.questionNumber}题`}
          fontSize={LABEL_STYLE.fontSize}
          fontStyle={String(LABEL_STYLE.fontWeight)}
          fill={currentLabelStyle.text}
          fontFamily={LABEL_STYLE.fontFamily}
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>

      {isSelected ? (
        <Transformer
          ref={trRef}
          flipEnabled={false}
          keepRatio={false}
          rotateEnabled={false}
          boundBoxFunc={(oldBox, newBox) =>
            Math.abs(newBox.width) < MIN_SIZE ||
            Math.abs(newBox.height) < MIN_SIZE
              ? oldBox
              : newBox
          }
        />
      ) : null}
    </>
  );
};

export default function QietiPrototypePreviewPage() {
  const { styles, cx } = useStyles();
  const columnRef = useRef<HTMLDivElement>(null);

  const [rectangles, setRectangles] = useState<RectangleProps[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  // 背景图原始尺寸 + 画布实测宽度 → 缩放系数 → 生成矩形（等价原型的 668/1701）
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    let cancelled = false;

    const build = (naturalWidth: number, naturalHeight: number) => {
      if (cancelled) return;
      const width = el.clientWidth;
      if (!width || !naturalWidth) return;
      const zoomScale = width / naturalWidth;
      const result: RectangleProps[] = [];
      questions.questions.forEach((question, i) => {
        question.pos_list.forEach((pos, j) => {
          result.push({
            x: pos[0] * zoomScale,
            y: pos[1] * zoomScale,
            width: (pos[2] - pos[0]) * zoomScale,
            height: (pos[5] - pos[1]) * zoomScale,
            fill: 'transparent',
            stroke: '#004fff7f',
            strokeWidth: 1,
            id: `rect${i}${j}`,
            questionNumber: i + 1,
          });
        });
      });
      setCanvasSize({
        width,
        height: width * (naturalHeight / naturalWidth),
      });
      setRectangles(result);
    };

    const img = new Image();
    img.onload = () => build(img.naturalWidth, img.naturalHeight);
    img.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    img.src = BACKGROUND_IMAGE.url;

    return () => {
      cancelled = true;
    };
  }, []);

  const selectRectangle = (id: string) => setSelectedId(id);

  const checkDeselect = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    if (e.target === e.target.getStage()) setSelectedId(null);
  };

  const updateRectangle = (index: number, newAttrs: RectangleProps) => {
    setRectangles((prev) => {
      const updated = [...prev];
      updated[index] = newAttrs;
      return updated;
    });
  };

  return (
    <PageContainer
      title="原型预览（test/qieti）"
      subTitle="对照参考用：react-konva 实现的切题原型，含矩形实时数据面板"
      extra={<Link to="/qieti/cut">切题工作台</Link>}
    >
      {failed ? (
        <Alert
          type="error"
          showIcon
          message="背景图加载失败，请检查网络后刷新"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className={styles.stage}>
        <div className={styles.canvasColumn} ref={columnRef}>
          {canvasSize ? (
            <div
              className={styles.canvasWrap}
              style={{
                height: canvasSize.height,
                backgroundImage: `url(${BACKGROUND_IMAGE.url})`,
              }}
            >
              <Stage
                width={canvasSize.width}
                height={canvasSize.height}
                onMouseDown={checkDeselect}
                onTouchStart={checkDeselect}
              >
                <Layer>
                  {rectangles.map((rect, i) => (
                    <Rectangle
                      key={rect.id}
                      shapeProps={rect}
                      isSelected={rect.id === selectedId}
                      onSelect={() => selectRectangle(rect.id)}
                      onChange={(newAttrs) => updateRectangle(i, newAttrs)}
                      allQuestions={rectangles}
                      selectedId={selectedId}
                    />
                  ))}
                </Layer>
              </Stage>
            </div>
          ) : failed ? null : (
            <Spin style={{ display: 'block', marginTop: 48 }} />
          )}
        </div>

        {/* 矩形实时数据面板（同原型） */}
        <div className={styles.dataPanel}>
          <h3>矩形实时数据</h3>
          {rectangles.map((rect) => (
            <div
              key={rect.id}
              className={cx(
                styles.dataRow,
                rect.id === selectedId && 'selected',
              )}
            >
              <strong>{rect.questionNumber}题:</strong>
              <span>
                {' '}
                x={rect.x.toFixed(1)}, y={rect.y.toFixed(1)},{' '}
              </span>
              <span>
                宽={rect.width.toFixed(1)}, 高={rect.height.toFixed(1)},{' '}
              </span>
              <span>边框色={rect.stroke}</span>
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
