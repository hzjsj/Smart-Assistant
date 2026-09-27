import { InboxOutlined } from '@ant-design/icons';
import { Card, Upload } from 'antd';
import { IMAGE_MAX_SIZE, PDF_MAX_SIZE } from '../../constants';

interface UploadCardProps {
  onHandleFiles: (files: File[]) => void;
}

/** 上传卡片：拖拽/点击上传 PDF（≤50MB，单文件）或多张 PNG/JPG（每张≤10MB） */
export default function UploadCard({ onHandleFiles }: UploadCardProps) {
  return (
    <Card title="上传试题文件" size="small">
      <Upload.Dragger
        accept=".pdf,image/png,image/jpeg"
        multiple
        showUploadList={false}
        beforeUpload={(file) => {
          // 多选时每个文件回调一次；返回 false 阻止 antd 自动上传
          onHandleFiles([file]);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽上传试卷文件</p>
        <p className="ant-upload-hint">
          支持 PDF / PNG / JPG · PDF ≤ {Math.round(PDF_MAX_SIZE / 1024 / 1024)}
          MB（一次 1 个）· 图片 ≤ {Math.round(IMAGE_MAX_SIZE / 1024 / 1024)}MB
        </p>
      </Upload.Dragger>
    </Card>
  );
}
