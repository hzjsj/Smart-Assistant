// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Get Current User GET /api/currentUser */
export async function getCurrentUserApiCurrentUserGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getCurrentUserApiCurrentUserGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/currentUser", {
    method: "GET",
    params: { ...params },
    ...(options || {}),
  });
}

/** Login Account POST /api/login/account */
export async function loginAccountApiLoginAccountPost(
  body: API.LoginParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/login/account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Get Captcha POST /api/login/captcha */
export async function getCaptchaApiLoginCaptchaPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getCaptchaApiLoginCaptchaPostParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/login/captcha", {
    method: "POST",
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** Logout POST /api/login/outLogin */
export async function logoutApiLoginOutLoginPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.logoutApiLoginOutLoginPostParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/login/outLogin", {
    method: "POST",
    params: { ...params },
    ...(options || {}),
  });
}

/** List Users GET /api/users */
export async function listUsersApiUsersGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listUsersApiUsersGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/users", {
    method: "GET",
    params: {
      // current has a default value: 1
      current: "1",
      // pageSize has a default value: 10
      pageSize: "10",

      ...params,
    },
    ...(options || {}),
  });
}

/** Create User POST /api/users */
export async function createUserApiUsersPost(
  body: API.CreateUserRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Delete Users DELETE /api/users */
export async function deleteUsersApiUsersDelete(
  body: API.DeleteUsersRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/users", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Update User PUT /api/users/${param0} */
export async function updateUserApiUsersUserIdPut(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.updateUserApiUsersUserIdPutParams,
  body: API.UpdateUserRequest,
  options?: { [key: string]: any }
) {
  const { user_id: param0, ...queryParams } = params;
  return request<any>(`/api/users/${param0}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  });
}
