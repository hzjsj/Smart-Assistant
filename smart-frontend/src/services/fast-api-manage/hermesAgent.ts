// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Chat Completions POST /api/hermes/v1/chat/completions */
export async function chatCompletionsApiHermesV1ChatCompletionsPost(
  body: API.hermes_schemas_ChatCompletionRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/hermes/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Export Detail GET /api/hermes/v1/exports/${param0} */
export async function exportDetailApiHermesV1ExportsExportIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.exportDetailApiHermesV1ExportsExportIdGetParams,
  options?: { [key: string]: any }
) {
  const { export_id: param0, ...queryParams } = params;
  return request<API.ExportResponse>(`/api/hermes/v1/exports/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Download Export GET /api/hermes/v1/exports/${param0}/download */
export async function downloadExportApiHermesV1ExportsExportIdDownloadGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.downloadExportApiHermesV1ExportsExportIdDownloadGetParams,
  options?: { [key: string]: any }
) {
  const { export_id: param0, ...queryParams } = params;
  return request<any>(`/api/hermes/v1/exports/${param0}/download`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Models GET /api/hermes/v1/models */
export async function modelsApiHermesV1ModelsGet(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/hermes/v1/models", {
    method: "GET",
    ...(options || {}),
  });
}

/** Save Paper POST /api/hermes/v1/papers */
export async function savePaperApiHermesV1PapersPost(
  body: API.CreatePaperRequest,
  options?: { [key: string]: any }
) {
  return request<API.PaperResponse>("/api/hermes/v1/papers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Paper Detail GET /api/hermes/v1/papers/${param0} */
export async function paperDetailApiHermesV1PapersPaperIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.paperDetailApiHermesV1PapersPaperIdGetParams,
  options?: { [key: string]: any }
) {
  const { paper_id: param0, ...queryParams } = params;
  return request<API.PaperResponse>(`/api/hermes/v1/papers/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Export Paper POST /api/hermes/v1/papers/${param0}/exports */
export async function exportPaperApiHermesV1PapersPaperIdExportsPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.exportPaperApiHermesV1PapersPaperIdExportsPostParams,
  body: API.CreateExportRequest,
  options?: { [key: string]: any }
) {
  const { paper_id: param0, ...queryParams } = params;
  return request<API.ExportResponse>(
    `/api/hermes/v1/papers/${param0}/exports`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      params: { ...queryParams },
      data: body,
      ...(options || {}),
    }
  );
}

/** Store Paper Pdf POST /api/hermes/v1/papers/${param0}/exports/pdf */
export async function storePaperPdfApiHermesV1PapersPaperIdExportsPdfPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.storePaperPdfApiHermesV1PapersPaperIdExportsPdfPostParams,
  body: API.BodyStorePaperPdfApiHermesV1Papers_paperId_exportsPdfPost,
  file?: File,
  options?: { [key: string]: any }
) {
  const { paper_id: param0, ...queryParams } = params;
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

  return request<API.ExportResponse>(
    `/api/hermes/v1/papers/${param0}/exports/pdf`,
    {
      method: "POST",
      params: { ...queryParams },
      data: formData,
      requestType: "form",
      ...(options || {}),
    }
  );
}

/** Question Bank Detail GET /api/hermes/v1/question-banks/${param0} */
export async function questionBankDetailApiHermesV1QuestionBanksBankIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.questionBankDetailApiHermesV1QuestionBanksBankIdGetParams,
  options?: { [key: string]: any }
) {
  const { bank_id: param0, ...queryParams } = params;
  return request<API.QuestionBankResponse>(
    `/api/hermes/v1/question-banks/${param0}`,
    {
      method: "GET",
      params: { ...queryParams },
      ...(options || {}),
    }
  );
}

/** Download Question Bank GET /api/hermes/v1/question-banks/${param0}/download */
export async function downloadQuestionBankApiHermesV1QuestionBanksBankIdDownloadGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.downloadQuestionBankApiHermesV1QuestionBanksBankIdDownloadGetParams,
  options?: { [key: string]: any }
) {
  const { bank_id: param0, ...queryParams } = params;
  return request<any>(`/api/hermes/v1/question-banks/${param0}/download`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Import Question Bank POST /api/hermes/v1/question-banks/import */
export async function importQuestionBankApiHermesV1QuestionBanksImportPost(
  body: API.ImportQuestionBankRequest,
  options?: { [key: string]: any }
) {
  return request<API.QuestionBankResponse>(
    "/api/hermes/v1/question-banks/import",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      data: body,
      ...(options || {}),
    }
  );
}
