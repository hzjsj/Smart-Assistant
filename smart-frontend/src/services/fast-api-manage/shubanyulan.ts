// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** List Files GET /api/shuban/files */
export async function listFilesApiShubanFilesGet(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/shuban/files", {
    method: "GET",
    ...(options || {}),
  });
}

/** Get Ast GET /api/shuban/files/${param0}/ast */
export async function getAstApiShubanFilesFilenameAstGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getAstApiShubanFilesFilenameAstGetParams,
  options?: { [key: string]: any }
) {
  const { filename: param0, ...queryParams } = params;
  return request<any>(`/api/shuban/files/${param0}/ast`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Get Preview GET /api/shuban/files/${param0}/preview */
export async function getPreviewApiShubanFilesFilenamePreviewGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getPreviewApiShubanFilesFilenamePreviewGetParams,
  options?: { [key: string]: any }
) {
  const { filename: param0, ...queryParams } = params;
  return request<string>(`/api/shuban/files/${param0}/preview`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Get Report GET /api/shuban/files/${param0}/report */
export async function getReportApiShubanFilesFilenameReportGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getReportApiShubanFilesFilenameReportGetParams,
  options?: { [key: string]: any }
) {
  const { filename: param0, ...queryParams } = params;
  return request<any>(`/api/shuban/files/${param0}/report`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Get Text GET /api/shuban/files/${param0}/text */
export async function getTextApiShubanFilesFilenameTextGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getTextApiShubanFilesFilenameTextGetParams,
  options?: { [key: string]: any }
) {
  const { filename: param0, ...queryParams } = params;
  return request<any>(`/api/shuban/files/${param0}/text`, {
    method: "GET",
    params: {
      ...queryParams,
    },
    ...(options || {}),
  });
}

/** Get Tokens GET /api/shuban/files/${param0}/tokens */
export async function getTokensApiShubanFilesFilenameTokensGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getTokensApiShubanFilesFilenameTokensGetParams,
  options?: { [key: string]: any }
) {
  const { filename: param0, ...queryParams } = params;
  return request<any>(`/api/shuban/files/${param0}/tokens`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Export Word GET /api/shuban/files/${param0}/word */
export async function exportWordApiShubanFilesFilenameWordGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.exportWordApiShubanFilesFilenameWordGetParams,
  options?: { [key: string]: any }
) {
  const { filename: param0, ...queryParams } = params;
  return request<any>(`/api/shuban/files/${param0}/word`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Import Files POST /api/shuban/imports */
export async function importFilesApiShubanImportsPost(
  body: API.BodyImportFilesApiShubanImportsPost,
  files?: File[],
  options?: { [key: string]: any }
) {
  const formData = new FormData();

  if (files) {
    files.forEach((f) => formData.append("files", f || ""));
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

  return request<any>("/api/shuban/imports", {
    method: "POST",
    data: formData,
    requestType: "form",
    ...(options || {}),
  });
}

/** Upload File POST /api/shuban/upload */
export async function uploadFileApiShubanUploadPost(
  body: API.BodyUploadFileApiShubanUploadPost,
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

  return request<any>("/api/shuban/upload", {
    method: "POST",
    data: formData,
    requestType: "form",
    ...(options || {}),
  });
}

/** Convert Word File POST /api/shuban/word-conversions */
export async function convertWordFileApiShubanWordConversionsPost(
  body: API.BodyConvertWordFileApiShubanWordConversionsPost,
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

  return request<any>("/api/shuban/word-conversions", {
    method: "POST",
    data: formData,
    requestType: "form",
    ...(options || {}),
  });
}

/** Download Word Conversion GET /api/shuban/word-conversions/${param0}/download */
export async function downloadWordConversionApiShubanWordConversionsConversionIdDownloadGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.downloadWordConversionApiShubanWordConversionsConversionIdDownloadGetParams,
  options?: { [key: string]: any }
) {
  const { conversion_id: param0, ...queryParams } = params;
  return request<any>(`/api/shuban/word-conversions/${param0}/download`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Get Word Conversion Preview GET /api/shuban/word-conversions/${param0}/preview */
export async function getWordConversionPreviewApiShubanWordConversionsConversionIdPreviewGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getWordConversionPreviewApiShubanWordConversionsConversionIdPreviewGetParams,
  options?: { [key: string]: any }
) {
  const { conversion_id: param0, ...queryParams } = params;
  return request<string>(`/api/shuban/word-conversions/${param0}/preview`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Save Word Conversion POST /api/shuban/word-conversions/${param0}/save */
export async function saveWordConversionApiShubanWordConversionsConversionIdSavePost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.saveWordConversionApiShubanWordConversionsConversionIdSavePostParams,
  options?: { [key: string]: any }
) {
  const { conversion_id: param0, ...queryParams } = params;
  return request<any>(`/api/shuban/word-conversions/${param0}/save`, {
    method: "POST",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Get Word Templates GET /api/shuban/word-templates */
export async function getWordTemplatesApiShubanWordTemplatesGet(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/shuban/word-templates", {
    method: "GET",
    ...(options || {}),
  });
}
