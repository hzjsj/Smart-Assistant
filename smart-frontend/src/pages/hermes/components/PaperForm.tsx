import {
  BookOutlined,
  CheckCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Slider,
  Space,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import * as React from 'react';

const { useEffect, useState } = React;

import {
  EXAM_TYPES,
  GRADES,
  SUBJECTS,
} from '../../generate-test-paper/constants';
import {
  getKnowledgeTree,
  getQuestionTypes,
} from '../../generate-test-paper/service';
import { normalizePaperTags, type PaperConfig } from '../paper';
import { useStyles } from '../style';

interface KnowledgeNode {
  title: string;
  value: string;
  key: string;
  children?: KnowledgeNode[];
}

const useKnowledgeOptions = (subject: string, grade: string) => {
  const [options, setOptions] = useState<{
    tree: KnowledgeNode[];
    questionTypes: string[];
    loading: boolean;
  }>({ tree: [], questionTypes: [], loading: true });

  useEffect(() => {
    let disposed = false;
    setOptions({ tree: [], questionTypes: [], loading: true });
    const load = async () => {
      const [treeResult, typesResult] = await Promise.allSettled([
        getKnowledgeTree(subject, grade),
        getQuestionTypes(subject, grade),
      ]);
      if (disposed) return;
      setOptions({
        tree: treeResult.status === 'fulfilled' ? treeResult.value : [],
        questionTypes:
          typesResult.status === 'fulfilled'
            ? typesResult.value.map((item) => item.name)
            : [],
        loading: false,
      });
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [subject, grade]);
  return options;
};

const getDifficulty = (value: number) => {
  if (value <= 3) return { text: '基础', color: 'success' };
  if (value <= 6) return { text: '中等', color: 'processing' };
  if (value <= 8) return { text: '较难', color: 'warning' };
  return { text: '竞赛难题', color: 'error' };
};

/** Keep form values as names while TreeSelect uses unique, matching key/value. */
const KnowledgeSelect = ({
  id,
  tree,
  loading,
  value = [],
  onChange,
}: {
  id?: string;
  tree: KnowledgeNode[];
  loading: boolean;
  value?: string[];
  onChange?: (value: string[]) => void;
}) => {
  const namesById = new Map<string, string>();
  const idsByName = new Map<string, string>();
  const convert = (nodes: KnowledgeNode[], parent = ''): KnowledgeNode[] =>
    nodes.map((node, index) => {
      const id = `${parent}/${index}:${node.key || node.value || node.title}`;
      namesById.set(id, node.title);
      if (!idsByName.has(node.title)) idsByName.set(node.title, id);
      return {
        ...node,
        key: id,
        value: id,
        children: node.children ? convert(node.children, id) : undefined,
      };
    });
  const treeData = convert(tree);
  // Preserve manual entries and saved selections while options are loading.
  for (const name of value) {
    if (idsByName.has(name)) continue;
    const id = `custom:${name}`;
    idsByName.set(name, id);
    namesById.set(id, name);
    treeData.push({ key: id, value: id, title: name });
  }
  return (
    <TreeSelect
      id={id}
      treeData={treeData}
      value={value.map((name) => idsByName.get(name) as string)}
      onChange={(ids: string[]) =>
        onChange?.(normalizePaperTags(ids.map((id) => namesById.get(id) || id)))
      }
      treeCheckable
      showCheckedStrategy={TreeSelect.SHOW_PARENT}
      placeholder="搜索或选择知识点，不选则合理安排"
      maxTagCount={3}
      showSearch={{ treeNodeFilterProp: 'title' }}
      loading={loading}
      notFoundContent={loading ? '加载中...' : '暂无数据，可手动输入知识点'}
    />
  );
};

const PaperForm = ({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: PaperConfig;
  onChange: (config: PaperConfig) => void;
  onSubmit: (config: PaperConfig) => void;
  busy: boolean;
}) => {
  const { styles } = useStyles();
  const [form] = Form.useForm<PaperConfig>();
  const [customKnowledge, setCustomKnowledge] = useState(false);
  const options = useKnowledgeOptions(value.subject, value.grade);
  const difficulty = getDifficulty(value.difficulty);

  return (
    <div className={styles.paperPage}>
      <section className={styles.paperContent} aria-label="智能命题">
        <header className={styles.paperHeading}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            智能组卷，精准命题
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            填写下方表单，帮你完成试题生成
          </Typography.Paragraph>
        </header>
        <Card className={styles.paperCard}>
          <Form<PaperConfig>
            form={form}
            layout="vertical"
            colon={false}
            initialValues={value}
            onValuesChange={(changed, values) => {
              const next = { ...values };
              if ('subject' in changed || 'grade' in changed) {
                next.knowledgePoints = [];
                next.questionTypes = [];
                form.setFieldsValue({ knowledgePoints: [], questionTypes: [] });
              }
              onChange(next);
            }}
            onFinish={(values) =>
              onSubmit({
                ...values,
                knowledgePoints: normalizePaperTags(values.knowledgePoints),
                questionTypes: normalizePaperTags(values.questionTypes),
              })
            }
          >
            <div className={styles.paperFields}>
              <Form.Item
                name="subject"
                label={
                  <Space size={6}>
                    <BookOutlined />
                    科目
                  </Space>
                }
                rules={[{ required: true, message: '请选择科目' }]}
              >
                <Select
                  options={SUBJECTS.map((item) => ({
                    label: item,
                    value: item,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="grade"
                label={
                  <Space size={6}>
                    <FileTextOutlined />
                    年级
                  </Space>
                }
                rules={[{ required: true, message: '请选择年级' }]}
              >
                <Select
                  showSearch
                  options={GRADES.map((item) => ({ label: item, value: item }))}
                />
              </Form.Item>
              <Form.Item
                name="knowledgePoints"
                label={
                  <Space size={6}>
                    <RobotOutlined />
                    知识点
                  </Space>
                }
                extra={
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    style={{ paddingInline: 0 }}
                    onClick={() => setCustomKnowledge((previous) => !previous)}
                  >
                    {customKnowledge ? '切换回列表选择' : '手动输入知识点'}
                  </Button>
                }
              >
                {customKnowledge ? (
                  <Select
                    mode="tags"
                    tokenSeparators={[',', '，']}
                    maxTagCount={3}
                    placeholder="输入知识点，按回车或逗号分隔"
                  />
                ) : (
                  <KnowledgeSelect
                    tree={options.tree}
                    loading={options.loading}
                  />
                )}
              </Form.Item>
              <Form.Item
                name="questionTypes"
                label={
                  <Space size={6}>
                    <CheckCircleOutlined />
                    题型
                  </Space>
                }
                extra="可选择或输入题型，不选则由模型合理安排"
              >
                <Select
                  mode="tags"
                  options={options.questionTypes.map((item) => ({
                    label: item,
                    value: item,
                  }))}
                  tokenSeparators={[',', '，']}
                  maxTagCount={3}
                  loading={options.loading}
                  placeholder="选择或输入题型，逗号分隔"
                  notFoundContent={
                    options.loading ? '加载中...' : '暂无选项，可直接输入题型'
                  }
                />
              </Form.Item>
              <Form.Item
                name="quantity"
                label={`数量：${value.quantity} 题`}
                rules={[
                  {
                    required: true,
                    type: 'integer',
                    min: 1,
                    max: 50,
                    message: '题目数量须为 1–50 的整数',
                  },
                ]}
              >
                <Slider min={1} max={50} />
              </Form.Item>
              <Form.Item
                name="difficulty"
                label={
                  <Space>
                    难度
                    <Tag color={difficulty.color}>
                      {value.difficulty} · {difficulty.text}
                    </Tag>
                  </Space>
                }
                rules={[
                  {
                    required: true,
                    type: 'integer',
                    min: 1,
                    max: 10,
                    message: '难度须为 1–10 的整数',
                  },
                ]}
              >
                <Slider
                  min={1}
                  max={10}
                  marks={{ 1: '1', 3: '3', 5: '5', 7: '7', 10: '10' }}
                />
              </Form.Item>
              <Form.Item
                name="examType"
                label={
                  <Space size={6}>
                    <FileTextOutlined />
                    试卷类型
                  </Space>
                }
                rules={[{ required: true, message: '请选择试卷类型' }]}
              >
                <Select
                  options={EXAM_TYPES.map((item) => ({
                    label: item,
                    value: item,
                  }))}
                />
              </Form.Item>
            </div>
            <Form.Item name="remarks" label="备注">
              <Input.TextArea
                maxLength={4000}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="请输入补充要求，如题目分值、考试时长或重点考查内容（选填）"
              />
            </Form.Item>
            {busy && (
              <Alert
                type="info"
                showIcon
                title="当前对话正在生成，请返回对话等待结束或停止生成后再提交。"
              />
            )}
            <div className={styles.paperSubmit}>
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                icon={<ThunderboltOutlined />}
                disabled={busy}
              >
                生成试卷
              </Button>
            </div>
          </Form>
        </Card>
      </section>
    </div>
  );
};

export default PaperForm;
