import {
  ModalForm,
  ProFormRadio,
  ProFormText,
} from '@ant-design/pro-components';
import { useMutation } from '@tanstack/react-query';
import { Button, message } from 'antd';
import { cloneElement, type FC } from 'react';
import { type UserItem, type UserWriteParams, updateUser } from '@/services/user';

interface UpdateFormProps {
  /** 行记录，用于回填表单 */
  values: UserItem;
  /** 触发按钮（编辑） */
  trigger?: React.ReactElement;
  /** 保存成功后回调（刷新表格） */
  onOk?: () => void;
}

const UpdateForm: FC<UpdateFormProps> = (props) => {
  const { values, trigger, onOk } = props;

  const [messageApi, contextHolder] = message.useMessage();

  const { mutateAsync: run, isPending: loading } = useMutation({
    mutationFn: (params: UserWriteParams) => updateUser(values.id, params),
    onSuccess: (res) => {
      if (!res.success) {
        messageApi.error(res.errorMessage ?? '保存失败，请重试！');
        return;
      }
      messageApi.success('保存成功');
      onOk?.();
    },
    onError: () => {
      messageApi.error('保存失败，请重试！');
    },
  });

  return (
    <>
      {contextHolder}
      <ModalForm<UserWriteParams>
        title={`编辑用户：${values.username}`}
        trigger={trigger}
        width="480px"
        modalProps={{ okButtonProps: { loading }, destroyOnHidden: true }}
        initialValues={values}
        onFinish={async (value) => {
          // 前端展示字段 group 对应后端字段 group_name
          const { group, ...rest } = value;
          await run({ ...rest, group_name: group });
          return true;
        }}
      >
        <ProFormText name="name" label="姓名" width="md" />
        <ProFormText name="email" label="邮箱" width="md" />
        <ProFormText name="phone" label="手机号" width="md" />
        <ProFormText name="title" label="职位" width="md" />
        <ProFormText name="group" label="组织" width="md" />
        <ProFormRadio.Group
          name="access"
          label="角色"
          options={[
            { value: 'user', label: '普通用户' },
            { value: 'admin', label: '管理员' },
          ]}
        />
        <ProFormText.Password
          name="password"
          label="重置密码"
          width="md"
          placeholder="留空表示不修改"
        />
      </ModalForm>
    </>
  );
};

export default UpdateForm;
