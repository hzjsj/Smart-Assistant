// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Passthrough 其余任意路径透传 MinerU Cloud API（归一化去掉多余的 api/v4 前缀）。 GET /api/mineru/proxy/${param0} */
export async function passthroughApiMineruProxyPathDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.passthroughApiMineruProxyPathDeleteParams,
  options?: { [key: string]: any }
) {
  const { path: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Passthrough 其余任意路径透传 MinerU Cloud API（归一化去掉多余的 api/v4 前缀）。 PUT /api/mineru/proxy/${param0} */
export async function passthroughApiMineruProxyPathDelete2(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.passthroughApiMineruProxyPathDeleteParams,
  options?: { [key: string]: any }
) {
  const { path: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/${param0}`, {
    method: "PUT",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Passthrough 其余任意路径透传 MinerU Cloud API（归一化去掉多余的 api/v4 前缀）。 POST /api/mineru/proxy/${param0} */
export async function passthroughApiMineruProxyPathDelete3(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.passthroughApiMineruProxyPathDeleteParams,
  options?: { [key: string]: any }
) {
  const { path: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/${param0}`, {
    method: "POST",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Passthrough 其余任意路径透传 MinerU Cloud API（归一化去掉多余的 api/v4 前缀）。 DELETE /api/mineru/proxy/${param0} */
export async function passthroughApiMineruProxyPathDelete4(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.passthroughApiMineruProxyPathDeleteParams,
  options?: { [key: string]: any }
) {
  const { path: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/${param0}`, {
    method: "DELETE",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Passthrough 其余任意路径透传 MinerU Cloud API（归一化去掉多余的 api/v4 前缀）。 PATCH /api/mineru/proxy/${param0} */
export async function passthroughApiMineruProxyPathDelete5(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.passthroughApiMineruProxyPathDeleteParams,
  options?: { [key: string]: any }
) {
  const { path: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/${param0}`, {
    method: "PATCH",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Poll Batch ③ 轮询：按 MinerU 响应格式聚合状态，不要求 Authorization。 GET /api/mineru/proxy/extract-results/batch/${param0} */
export async function pollBatchApiMineruProxyExtractResultsBatchBatchIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.pollBatchApiMineruProxyExtractResultsBatchBatchIdGetParams,
  options?: { [key: string]: any }
) {
  const { batch_id: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/extract-results/batch/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Apply Upload Urls ① 申请批量上传链接（兼容 /api/v4/file-urls/batch）。

与 MinerU 的差异仅在 file_urls 指向本服务——Open WebUI 随后把文件 PUT 到
我们这里，得以复用自有链路（含超限拆分）。 POST /api/mineru/proxy/file-urls/batch */
export async function applyUploadUrlsApiMineruProxyFileUrlsBatchPost(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/mineru/proxy/file-urls/batch", {
    method: "POST",
    ...(options || {}),
  });
}

/** Receive Upload ② 接收预签名 URL 的文件字节（无 Authorization），复用自有上传处理。 PUT /api/mineru/proxy/upload/${param0}/${param1} */
export async function receiveUploadApiMineruProxyUploadBatchIdIndexPut(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.receiveUploadApiMineruProxyUploadBatchIdIndexPutParams,
  options?: { [key: string]: any }
) {
  const { batch_id: param0, index: param1, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/upload/${param0}/${param1}`, {
    method: "PUT",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Download Zip ④ 结果 zip：通过公开结果链接下载，不要求 Authorization。 GET /api/mineru/proxy/zip/${param0} */
export async function downloadZipApiMineruProxyZipRecordIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.downloadZipApiMineruProxyZipRecordIdGetParams,
  options?: { [key: string]: any }
) {
  const { record_id: param0, ...queryParams } = params;
  return request<any>(`/api/mineru/proxy/zip/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}
