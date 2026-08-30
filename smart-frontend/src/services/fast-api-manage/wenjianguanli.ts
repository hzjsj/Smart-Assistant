// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** List Files GET /api/files */
export async function listFilesApiFilesGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listFilesApiFilesGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/files", {
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

/** Handle File POST /api/files */
export async function handleFileApiFilesPost(
  body: API.FileRequestBody,
  options?: { [key: string]: any }
) {
  return request<any>("/api/files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Download Md File GET /api/files/download-md/${param0} */
export async function downloadMdFileApiFilesDownloadMdMdSavedNameGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.downloadMdFileApiFilesDownloadMdMdSavedNameGetParams,
  options?: { [key: string]: any }
) {
  const { md_saved_name: param0, ...queryParams } = params;
  return request<any>(`/api/files/download-md/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Download File GET /api/files/download/${param0} */
export async function downloadFileApiFilesDownloadSavedNameGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.downloadFileApiFilesDownloadSavedNameGetParams,
  options?: { [key: string]: any }
) {
  const { saved_name: param0, ...queryParams } = params;
  return request<any>(`/api/files/download/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Get Download Url GET /api/files/file/${param0}/download */
export async function getDownloadUrl(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getDownloadUrlParams,
  options?: { [key: string]: any }
) {
  const { fileId: param0, ...queryParams } = params;
  return request<any>(`/api/files/file/${param0}/download`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Mineru Upload File POST /api/files/mineru/upload */
export async function mineruUploadFileApiFilesMineruUploadPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.mineruUploadFileApiFilesMineruUploadPostParams,
  body: API.BodyMineruUploadFileApiFilesMineruUploadPost,
  file?: File,
  options?: { [key: string]: any }
) {
  const formData = new FormData();

  if (file) {
    formData.append("file", file);
  }

  Object.keys(body).forEach((ele) => {
    const item = (body as any)[ele];

    if (item !== undefined && item !== null) {
      if (typeof item === "object" && !(item instanceof File)) {
        if (item instanceof Array) {
          item.forEach((f) => formData.append(ele, f || ""));
        } else {
          formData.append(
            ele,
            new Blob([JSON.stringify(item)], { type: "application/json" })
          );
        }
      } else {
        formData.append(ele, item);
      }
    }
  });

  return request<any>("/api/files/mineru/upload", {
    method: "POST",
    params: { ...params },
    data: formData,
    requestType: "form",
    ...(options || {}),
  });
}

/** Upload File POST /api/files/upload */
export async function uploadFileApiFilesUploadPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.uploadFileApiFilesUploadPostParams,
  body: API.BodyUploadFileApiFilesUploadPost,
  file?: File,
  options?: { [key: string]: any }
) {
  const formData = new FormData();

  if (file) {
    formData.append("file", file);
  }

  Object.keys(body).forEach((ele) => {
    const item = (body as any)[ele];

    if (item !== undefined && item !== null) {
      if (typeof item === "object" && !(item instanceof File)) {
        if (item instanceof Array) {
          item.forEach((f) => formData.append(ele, f || ""));
        } else {
          formData.append(
            ele,
            new Blob([JSON.stringify(item)], { type: "application/json" })
          );
        }
      } else {
        formData.append(ele, item);
      }
    }
  });

  return request<any>("/api/files/upload", {
    method: "POST",
    params: { ...params },
    data: formData,
    requestType: "form",
    ...(options || {}),
  });
}
