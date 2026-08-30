import { PlusOutlined } from '@ant-design/icons';
import {
  ModalForm,
  ProFormRadio,
  ProFormText,
} from '@ant-design/pro-components';
import { useMutation } from '@tanstack/react-query';
import { Button, message } from 'antd';
import type { FC } from 'react';
import { type UserWriteParams, createUser } from '@/services/user';

interface CreateFormProps {
  reload?: () => void;
}

const CreateForm: FC<CreateFormProps> = (props) => {
  const { reload } = props;

  const [messageApi, contextHolder] = message.useMessage();

  const { mutateAsync: run, isPending: loading } = useMutation({
    mutationFn: createUser,
    onSuccess: (res) => {
      if (!res.success) {
        messageApi.error(res.errorMessage ?? '创建失败，请重试！');
        return;
      }
      messageApi.success('新建用户成功');
      reload?.();
    },
    onError: () => {
      messageApi.error('创建失败，请重试！');
    },
  });

  return (
    <>
      {contextHolder}
      <ModalForm<UserWriteParams>
        title="新建用户"
        trigger={
          <Button type="primary" icon={<PlusOutlined />}>
            新建
          </Button>
        }
        width="480px"
        modalProps={{ okButtonProps: { loading } }}
        onFinish={async (value) => {
          await run(value);
          return true;
        }}
      >
        <ProFormText
          name="username"
          label="用户名"
          width="md"
          rules={[{ required: true, message: '用户名为必填项' }]}
        />
        <ProFormText.Password
          name="password"
          label="初始密码"
          width="md"
          rules={[{ required: true, message: '初始密码为必填项' }]}
        />
        <ProFormText name="name" label="姓名" width="md" placeholder="缺省时使用用户名" />
        <ProFormRadio.Group
          name="access"
          label="角色"
          initialValue="user"
          options={[
            { value: 'user', label: '普通用户' },
            { value: 'admin', label: '管理员' },
          ]}
        />
      </ModalForm>
    </>
  );
};

export default CreateForm;
