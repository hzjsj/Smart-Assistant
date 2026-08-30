import { request } from '@umijs/max';

/** 用户列表项（后端 users._to_dict 结构，不暴露 password_hash） */
export interface UserItem {
  id: number;
  username: string;
  name: string;
  avatar?: string;
  userid?: string;
  email?: string;
  phone?: string;
  title?: string;
  group?: string;
  access: string;
  signature?: string;
  country?: string;
  address?: string;
}

/** 用户列表查询参数 */
export interface UserListParams {
  current?: number;
  pageSize?: number;
  username?: string;
  name?: string;
}

/** 新建/更新用户的请求体（username/password 仅新建；password 更新时非空则重置） */
export interface UserWriteParams {
  username?: string;
  password?: string;
  name?: string;
  email?: string;
  phone?: string;
  title?: string;
  group?: string;
  group_name?: string;
  access?: string;
}

/** 写操作统一响应 */
export interface ApiResult<T = unknown> {
  success: boolean;
  errorMessage?: string;
  data?: T;
}

/**
 * 分页查询用户列表（仅管理员，后端 require_admin 校验）
 * 返回 ProTable 约定的 { data, total, success }
 */
export async function listUsers(params: UserListParams) {
  return request<{ data: UserItem[]; total: number; success: boolean }>(
    '/api/users',
    { method: 'GET', params },
  );
}

/** 新建用户 */
export async function createUser(body: UserWriteParams) {
  return request<ApiResult<UserItem>>('/api/users', { method: 'POST', data: body });
}

/** 更新用户 */
export async function updateUser(id: number, body: UserWriteParams) {
  return request<ApiResult<UserItem>>(`/api/users/${id}`, {
    method: 'PUT',
    data: body,
  });
}

/** 批量删除用户 */
export async function deleteUsers(ids: number[]) {
  return request<ApiResult<{ deleted: number }>>('/api/users', {
    method: 'DELETE',
    data: { ids },
  });
}
