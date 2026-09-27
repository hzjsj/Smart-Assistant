import {
  EyeOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@umijs/max';
import { Button, Card, Col, Empty, Row, Spin, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { QietiUploadRecord } from '../data';
import { listUploadRecords } from '../service';

const { Text } = Typography;

function formatFileSize(size: number): string {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ts: number | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN');
}

function toCutPageHref(item: QietiUploadRecord): string {
  if (!item?.uploadedUrl) return '/qieti/cut';
  const params = new URLSearchParams();
  params.set('imageUrl', item.uploadedUrl);
  params.set('fileName', item.fileName || '上传记录图片');
  return `/qieti/cut?${params.toString()}`;
}

export default function QietiRecordsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeGroup, setActiveGroup] = useState<string>('all');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['qieti-records'],
    queryFn: () => listUploadRecords(100),
  });

  const records = useMemo(() => data?.records || [], [data]);

  /** 按原始文件名分组（PDF 拆页记录形如 "xx.pdf - 第1页"） */
  const grouped = useMemo(() => {
    const map = new Map<string, QietiUploadRecord[]>();
    for (const item of records) {
      const raw = String(item.fileName || '').trim();
      const groupName = raw.includes(' - 第')
        ? raw.split(' - 第')[0]
        : raw || '未命名文件';
      if (!map.has(groupName)) map.set(groupName, []);
      map.get(groupName)?.push(item);
    }
    return Array.from(map.entries()).map(([name, items]) => ({
      name,
      count: items.length,
      items,
    }));
  }, [records]);

  const visibleRecords = useMemo(() => {
    if (activeGroup === 'all') return records;
    return grouped.find((item) => item.name === activeGroup)?.items || [];
  }, [activeGroup, grouped, records]);

  return (
    <PageContainer
      title="上传记录"
      subTitle={`共 ${records.length} 条记录`}
      extra={
        <>
          <Button
            icon={<ReloadOutlined />}
            loading={isFetching}
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['qieti-records'] })
            }
          >
            刷新
          </Button>
          <Link to="/qieti/questions">
            <Button icon={<FileSearchOutlined />}>题目列表</Button>
          </Link>
          <Button
            type="primary"
            icon={<ScissorOutlined />}
            onClick={() => navigate('/qieti/cut')}
          >
            去切题
          </Button>
        </>
      }
    >
      <Row gutter={16}>
        <Col xs={24} md={6} lg={5}>
          <Card size="small" title="目录" styles={{ body: { padding: 8 } }}>
            <Button
              block
              type={activeGroup === 'all' ? 'primary' : 'text'}
              style={{ justifyContent: 'left', marginBottom: 4 }}
              onClick={() => setActiveGroup('all')}
            >
              全部记录（{records.length}）
            </Button>
            <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {grouped.map((group) => (
                <Button
                  key={group.name}
                  block
                  type={activeGroup === group.name ? 'primary' : 'text'}
                  style={{ justifyContent: 'left', textAlign: 'left' }}
                  onClick={() => setActiveGroup(group.name)}
                  title={group.name}
                >
                  <span
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.name}（{group.count}）
                  </span>
                </Button>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} md={18} lg={19}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin tip="加载中..." />
            </div>
          ) : null}
          {!isLoading && !visibleRecords.length ? (
            <Empty description="暂无上传记录" />
          ) : null}
          {visibleRecords.map((item) => (
            <Card key={item.id} size="small" style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <Text strong ellipsis style={{ maxWidth: '60%' }}>
                  {item.fileName || '-'}
                </Text>
                <Text type="secondary">{formatTime(item.createdAt)}</Text>
              </div>
              <div
                style={{
                  margin: '8px 0',
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <Tag>{item.fileType || '-'}</Tag>
                <Tag>{formatFileSize(item.fileSize)}</Tag>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {item.uploadedUrl ? (
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    href={item.uploadedUrl}
                    target="_blank"
                  >
                    查看文件
                  </Button>
                ) : null}
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<ScissorOutlined />}
                  href={toCutPageHref(item)}
                >
                  去切题
                </Button>
              </div>
            </Card>
          ))}
        </Col>
      </Row>
    </PageContainer>
  );
}
