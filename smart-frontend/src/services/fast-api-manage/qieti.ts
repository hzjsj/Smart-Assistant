// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Cut 切题识别：URL 先过 SSRF 校验，再调用 EduTutor。响应结构 {questions_data}。 POST /api/qieti/cut */
export async function cutApiQietiCutPost(
  body: API.CutRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/qieti/cut", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** List Records 分页查询上传记录（id 倒序，与原 createdAt 倒序等价）。 GET /api/qieti/records */
export async function listRecordsApiQietiRecordsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listRecordsApiQietiRecordsGetParams,
  options?: { [key: string]: any }
) {
  return request<API.RecordsResponse>("/api/qieti/records", {
    method: "GET",
    params: {
      // limit has a default value: 50
      limit: "50",
      ...params,
    },
    ...(options || {}),
  });
}

/** Get Snapshot 读取最新题库快照。 GET /api/qieti/snapshot */
export async function getSnapshotApiQietiSnapshotGet(options?: {
  [key: string]: any;
}) {
  return request<API.SnapshotGetResponse>("/api/qieti/snapshot", {
    method: "GET",
    ...(options || {}),
  });
}

/** Save Snapshot 保存题库快照（单行覆盖，snapshot_key='latest'）。 POST /api/qieti/snapshot */
export async function saveSnapshotApiQietiSnapshotPost(
  body: API.SnapshotPayload,
  options?: { [key: string]: any }
) {
  return request<API.SnapshotSaveResponse>("/api/qieti/snapshot", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Upload 上传切题图片到 OSS，并写入上传记录。响应结构与参考项目 /api/upload/single 一致。 POST /api/qieti/upload */
export async function uploadApiQietiUploadPost(
  body: API.BodyUploadApiQietiUploadPost,
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

  return request<any>("/api/qieti/upload", {
    method: "POST",
    data: formData,
    requestType: "form",
    ...(options || {}),
  });
}
