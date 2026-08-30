import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useMutation } from '@tanstack/react-query';
import { Button, Popconfirm, Tag, message } from 'antd';
import { useRef, useState } from 'react';
import {
  type UserItem,
  deleteUsers,
  listUsers,
} from '@/services/user';
import CreateForm from './components/CreateForm';
import UpdateForm from './components/UpdateForm';

/** 角色 → 标签样式 */
const ACCESS_TAG: Record<string, { color: string; text: string }> = {
  admin: { color: 'gold', text: '管理员' },
  user: { color: 'blue', text: '普通用户' },
};

const UserList: React.FC = () => {
  const actionRef = useRef<ActionType | null>(null);
  const [selectedRows, setSelectedRows] = useState<UserItem[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  const reload = () => actionRef.current?.reloadAndRest?.();

  const { mutate: delRun, isPending: deleting } = useMutation({
    mutationFn: deleteUsers,
    onSuccess: (res) => {
      if (!res.success) {
        messageApi.error(res.errorMessage ?? '删除失败，请重试！');
        return;
      }
      messageApi.success('删除成功');
      setSelectedRows([]);
      reload();
    },
    onError: () => {
      messageApi.error('删除失败，请重试！');
    },
  });

  const handleRemove = (rows: UserItem[]) => {
    if (!rows?.length) {
      messageApi.warning('请选择要删除的用户');
      return;
    }
    delRun(rows.map((row) => row.id));
  };

  const columns: ProColumns<UserItem>[] = [
    {
      title: '用户名',
      dataIndex: 'username',
      copyable: true,
    },
    {
      title: '姓名',
      dataIndex: 'name',
    },
    {
      title: '用户ID',
      dataIndex: 'userid',
      search: false,
      copyable: true,
    },
    {
      title: '角色',
      dataIndex: 'access',
      width: 100,
      valueEnum: {
        admin: { text: '管理员' },
        user: { text: '普通用户' },
      },
      render: (_, record) => {
        const tag = ACCESS_TAG[record.access];
        return tag ? <Tag color={tag.color}>{tag.text}</Tag> : record.access;
      },
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      search: false,
      copyable: true,
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      search: false,
    },
    {
      title: '职位',
      dataIndex: 'title',
      search: false,
    },
    {
      title: '组织',
      dataIndex: 'group',
      search: false,
      ellipsis: true,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      render: (_, record) => [
        <UpdateForm
          key="edit"
          values={record}
          onOk={reload}
          trigger={<Button type="link" size="small">编辑</Button>}
        />,
        <Popconfirm
          key="delete"
          title={`确认删除用户 ${record.username}？`}
          onConfirm={() => handleRemove([record])}
        >
          <Button type="link" size="small" danger>
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer>
      {contextHolder}
      <ProTable<UserItem>
        headerTitle="用户列表"
        actionRef={actionRef}
        rowKey="id"
        search={{ labelWidth: 'auto' }}
        toolBarRender={() => [
          <CreateForm key="create" reload={reload} />,
        ]}
        request={async (params) => {
          // ProTable 的 params 自带 current/pageSize，其余为搜索字段
          const { current, pageSize, username, name } = params;
          return listUsers({ current, pageSize, username, name });
        }}
        columns={columns}
        rowSelection={{
          onChange: (_, rows) => setSelectedRows(rows),
        }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      />
      {selectedRows.length > 0 && (
        <Button
          danger
          style={{ marginTop: 16 }}
          loading={deleting}
          onClick={() => handleRemove(selectedRows)}
        >
          批量删除（已选 {selectedRows.length} 项）
        </Button>
      )}
    </PageContainer>
  );
};

export default UserList;
