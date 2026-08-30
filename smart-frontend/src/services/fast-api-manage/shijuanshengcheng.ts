// @ts-ignore
/* eslint-disable */
import { request } from "@umijs/max";

/** Get Course Types 获取所有课程类型 GET /api/chujuanji/course-types */
export async function getCourseTypesApiChujuanjiCourseTypesGet(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/chujuanji/course-types", {
    method: "GET",
    ...(options || {}),
  });
}

/** List Exams 获取试卷列表 GET /api/chujuanji/exams */
export async function listExamsApiChujuanjiExamsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listExamsApiChujuanjiExamsGetParams,
  options?: { [key: string]: any }
) {
  return request<API.ExamListResponse>("/api/chujuanji/exams", {
    method: "GET",
    params: {
      // limit has a default value: 20
      limit: "20",

      ...params,
    },
    ...(options || {}),
  });
}

/** Save Exam 保存试卷（记录创建用户） POST /api/chujuanji/exams */
export async function saveExamApiChujuanjiExamsPost(
  body: API.SaveExamRequest,
  options?: { [key: string]: any }
) {
  return request<API.ExamResponse>("/api/chujuanji/exams", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Get Exam Detail 获取试卷详情 GET /api/chujuanji/exams/${param0} */
export async function getExamDetailApiChujuanjiExamsExamIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getExamDetailApiChujuanjiExamsExamIdGetParams,
  options?: { [key: string]: any }
) {
  const { exam_id: param0, ...queryParams } = params;
  return request<API.ExamResponse>(`/api/chujuanji/exams/${param0}`, {
    method: "GET",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Remove Exam 删除试卷 DELETE /api/chujuanji/exams/${param0} */
export async function removeExamApiChujuanjiExamsExamIdDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.removeExamApiChujuanjiExamsExamIdDeleteParams,
  options?: { [key: string]: any }
) {
  const { exam_id: param0, ...queryParams } = params;
  return request<any>(`/api/chujuanji/exams/${param0}`, {
    method: "DELETE",
    params: { ...queryParams },
    ...(options || {}),
  });
}

/** Generate Questions 生成试卷题目（流式输出） POST /api/chujuanji/generate */
export async function generateQuestionsApiChujuanjiGeneratePost(
  body: API.GenerateRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chujuanji/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Generate Questions Sync 生成试卷题目（同步输出，用于调试） POST /api/chujuanji/generate-sync */
export async function generateQuestionsSyncApiChujuanjiGenerateSyncPost(
  body: API.GenerateRequest,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chujuanji/generate-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: body,
    ...(options || {}),
  });
}

/** Get Knowledge Points 获取知识点列表 GET /api/chujuanji/knowledge-points */
export async function getKnowledgePointsApiChujuanjiKnowledgePointsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getKnowledgePointsApiChujuanjiKnowledgePointsGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chujuanji/knowledge-points", {
    method: "GET",
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** Get Knowledge Points By Subject 根据科目和年级获取知识点树结构 GET /api/chujuanji/knowledge-points/by-subject */
export async function getKnowledgePointsBySubjectApiChujuanjiKnowledgePointsBySubjectGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getKnowledgePointsBySubjectApiChujuanjiKnowledgePointsBySubjectGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chujuanji/knowledge-points/by-subject", {
    method: "GET",
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** Search Knowledge Points 搜索知识点 GET /api/chujuanji/knowledge-points/search */
export async function searchKnowledgePointsApiChujuanjiKnowledgePointsSearchGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.searchKnowledgePointsApiChujuanjiKnowledgePointsSearchGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chujuanji/knowledge-points/search", {
    method: "GET",
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** Get Knowledge Stats 获取知识点统计信息 GET /api/chujuanji/knowledge-points/stats */
export async function getKnowledgeStatsApiChujuanjiKnowledgePointsStatsGet(options?: {
  [key: string]: any;
}) {
  return request<any>("/api/chujuanji/knowledge-points/stats", {
    method: "GET",
    ...(options || {}),
  });
}

/** Get Knowledge Tree 获取知识点树结构 GET /api/chujuanji/knowledge-points/tree */
export async function getKnowledgeTreeApiChujuanjiKnowledgePointsTreeGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getKnowledgeTreeApiChujuanjiKnowledgePointsTreeGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chujuanji/knowledge-points/tree", {
    method: "GET",
    params: {
      // parent_id has a default value: 0
      parent_id: "0",
      ...params,
    },
    ...(options || {}),
  });
}

/** Get Question Types 根据科目和年级获取题型列表 GET /api/chujuanji/question-types */
export async function getQuestionTypesApiChujuanjiQuestionTypesGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getQuestionTypesApiChujuanjiQuestionTypesGetParams,
  options?: { [key: string]: any }
) {
  return request<any>("/api/chujuanji/question-types", {
    method: "GET",
    params: {
      ...params,
    },
    ...(options || {}),
  });
}
