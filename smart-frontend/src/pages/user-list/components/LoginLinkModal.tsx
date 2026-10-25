import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Input, Modal, Space, message } from 'antd';
import { useState, type FC } from 'react';
import { type UserItem, createLoginTicket } from '@/services/user';

interface LoginLinkModalProps {
  /** 行记录，为其签发登录链接 */
  values: UserItem;
}

/**
 * 为指定用户生成一次性免密登录链接：管理员复制后发给用户，
 * 用户打开即可免密登入（10 分钟内有效，仅可使用一次）。
 */
const LoginLinkModal: FC<LoginLinkModalProps> = ({ values }) => {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [messageApi, contextHolder] = message.useMessage();

  const { mutate: run, isPending: loading } = useMutation({
    mutationFn: () => createLoginTicket(values.id),
    onSuccess: (res) => {
      if (!res.success || !res.data) {
        messageApi.error(res.errorMessage ?? '生成失败，请重试！');
        return;
      }
      setLink(`${window.location.origin}${res.data.url}`);
    },
    onError: () => {
      messageApi.error('生成失败，请重试！');
    },
  });

  const openModal = () => {
    setLink('');
    setOpen(true);
    run();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      messageApi.success('已复制，请尽快发给对应用户');
    } catch {
      messageApi.error('复制失败，请手动选择复制');
    }
  };

  return (
    <>
      {contextHolder}
      <Button type="link" size="small" onClick={openModal}>
        登录链接
      </Button>
      <Modal
        title={`登录链接：${values.username}`}
        open={open}
        onCancel={() => setOpen(false)}
        width={560}
        destroyOnHidden
        footer={[
          <Button key="regen" loading={loading} onClick={() => run()}>
            重新生成
          </Button>,
          <Button key="close" type="primary" onClick={() => setOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          message="链接 10 分钟内有效，仅可使用一次；如已泄露，请重新生成使其失效。"
          style={{ marginBottom: 16 }}
        />
        <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={link} placeholder={loading ? '正在生成…' : ''} />
          <Button type="primary" disabled={!link} onClick={copyLink}>
            复制
          </Button>
        </Space.Compact>
      </Modal>
    </>
  );
};

export default LoginLinkModal;
