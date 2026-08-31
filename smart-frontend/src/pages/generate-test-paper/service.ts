import type { GenerateRequest, QuestionItem, QuestionType } from './data';

// SSE 流式直连后端完整路径（不走 dev/preview proxy，避免 HPM 代理缓冲导致数据一次性吐出）
// 生产部署时通过 nginx 的 proxy_buffering off 代理到后端，不依赖 dev proxy
const API_BASE = 'http://localhost:5000/api/chujuanji';

/**
 * 构建用户提示词
 */
export function buildUserPrompt(req: GenerateRequest): string {
  const typesStr = req.question_types.join('、');
  const testPointInfo = req.test_point ? `\n- 考点：${req.test_point}` : '';

  return `请根据以下要求生成试卷题目：

【基本信息】
- 科目：${req.subject}
- 年级：${req.grade}
- 知识点：${req.knowledge_point}${testPointInfo}
- 题型：${typesStr}
- 数量：${req.quantity} 题
- 难度：${req.difficulty}/10（1为最简单，10为最难）
- 试卷类型：${req.exam_type}

请严格按照系统提示的 JSON 格式输出题目。`;
}

/**
 * 流式生成试卷题目
 */
export async function generateQuestionsStream(
  req: GenerateRequest,
  onQuestion: (question: QuestionItem) => void,
  onDone: (questions: QuestionItem[]) => void,
  onError: (error: string) => void,
) {
  try {
    const userPrompt = buildUserPrompt(req);

    const response = await fetch(`${API_BASE}/generate`, {
      credentials: 'include',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_prompt: userPrompt }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `HTTP error! status: ${response.status}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    let lastParsedIndex = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data: ')) {
          try {
            const jsonStr = trimmedLine.slice(6);
            if (!jsonStr) continue;

            const data = JSON.parse(jsonStr);

            if (data.error) {
              onError(data.error);
              return;
            }

            if (data.content) {
              fullContent += data.content;

              // 使用状态机提取当前已完整生成的所有题目
              const availableQuestions = extractCompleteQuestions(fullContent);

              // 如果提取到的题目数量大于已渲染数量，说明有新题生成完毕
              if (availableQuestions.length > lastParsedIndex) {
                for (
                  let i = lastParsedIndex;
                  i < availableQuestions.length;
                  i++
                ) {
                  onQuestion(availableQuestions[i]);
                  lastParsedIndex++;
                }
              }
            }

            if (data.done) {
              const finalQuestions = extractCompleteQuestions(fullContent);
              // 确保最后一题也被推入
              if (finalQuestions.length > lastParsedIndex) {
                for (let i = lastParsedIndex; i < finalQuestions.length; i++) {
                  onQuestion(finalQuestions[i]);
                }
              }
              onDone(finalQuestions);
              return;
            }
          } catch (e) {
            console.warn('解析 SSE 数据失败:', e, trimmedLine);
          }
        }
      }
    }

    // 兜底：如果流异常结束
    if (fullContent) {
      const questions = extractCompleteQuestions(fullContent);
      if (questions.length > 0) {
        onDone(questions);
        return;
      }
    }

    onError('生成完成但未获取到有效内容');
  } catch (error) {
    onError(error instanceof Error ? error.message : '生成失败');
  }
}

/**
 * 核心：利用状态机从残缺的 JSON 字符串中，安全提取已闭合的题目对象
 * 加入了对 LLM 常见错误（反斜杠、换行符）的自愈修复
 */
function extractCompleteQuestions(content: string): QuestionItem[] {
  const questions: QuestionItem[] = [];

  // 1. 更健壮地清理 Markdown 标记（忽略大小写，处理未闭合的块）
  let jsonStr = content.replace(/^```[a-zA-Z]*\s*/i, '');
  jsonStr = jsonStr.replace(/```\s*$/, '');

  // 2. 先尝试直接解析完整的 JSON
  try {
    const result = JSON.parse(jsonStr);
    if (result.questions && Array.isArray(result.questions)) {
      return result.questions.map((q: any, index: number) => ({
        id: q.id || `q${index + 1}`,
        type: (q.type || 'unknown') as QuestionType,
        content: q.content || '',
        options:
          Array.isArray(q.options) && q.options.length > 0
            ? q.options
            : undefined,
        answer: q.answer || '',
        analysis: q.analysis || '',
      }));
    }
  } catch {
    // JSON 不完整，继续使用状态机解析
  }

  // 3. 动态匹配 questions 数组的起始位置（兼容多种空格格式）
  const questionsMatch = jsonStr.match(/"questions"\s*:\s*\[/);
  if (!questionsMatch) return questions;

  const arrayStart = questionsMatch.index! + questionsMatch[0].length - 1;

  // 3. 状态机扫描，提取完整的题目对象
  let i = arrayStart + 1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let objStart = -1;

  while (i < jsonStr.length) {
    const ch = jsonStr[i];

    if (escapeNext) {
      escapeNext = false;
      i++;
      continue;
    }

    if (ch === '\\' && inString) {
      escapeNext = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      i++;
      continue;
    }

    if (inString) {
      i++;
      continue;
    }

    // 不在字符串内，处理结构字符
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const objStr = jsonStr.substring(objStart, i + 1);

        const parseAndPush = (strToParse: string) => {
          const obj = JSON.parse(strToParse);
          if (obj && (obj.content !== undefined || obj.title !== undefined)) {
            questions.push({
              id: obj.id || `q${questions.length + 1}`,
              type: (obj.type || 'unknown') as QuestionType,
              content: obj.content || obj.title || '',
              options:
                Array.isArray(obj.options) && obj.options.length > 0
                  ? obj.options
                  : undefined,
              answer: obj.answer || '',
              analysis: obj.analysis || '',
            });
          }
        };

        try {
          parseAndPush(objStr);
        } catch {
          // 自愈机制：修复 LLM 常见 JSON 生成错误
          try {
            const fixedStr = objStr
              .replace(/\\([^"\\/bfnrtu])/g, '\\\\$1') // 修复 LaTeX 中未转义的反斜杠
              .replace(/\n/g, '\\n') // 修复字符串内真实的换行符
              .replace(/\r/g, '') // 移除回车符
              .replace(/,\s*([}\]])/g, '$1'); // 修复尾随逗号

            parseAndPush(fixedStr);
          } catch {
            // 彻底解析失败则跳过该对象
          }
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }

    i++;
  }

  return questions;
}

/**
 * 保存试卷到数据库
 */
export async function saveExam(data: {
  title: string;
  subject: string;
  grade: string;
  exam_type: string;
  knowledge_point?: string;
  test_point?: string;
  question_types: string[];
  quantity: number;
  difficulty: number;
  questions: QuestionItem[];
}): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/exams`, {
      credentials: 'include',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `HTTP error! status: ${response.status}`,
      );
    }

    const result = await response.json();
    return { success: true, id: result.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '保存失败',
    };
  }
}

/**
 * 获取试卷列表
 */
export async function getExamList(params?: {
  skip?: number;
  limit?: number;
  subject?: string;
  grade?: string;
  exam_type?: string;
}): Promise<{ total: number; items: any[] }> {
  try {
    const queryParams = new URLSearchParams();
    if (params?.skip) queryParams.append('skip', params.skip.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.subject) queryParams.append('subject', params.subject);
    if (params?.grade) queryParams.append('grade', params.grade);
    if (params?.exam_type) queryParams.append('exam_type', params.exam_type);

    const response = await fetch(`${API_BASE}/exams?${queryParams.toString()}`, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('获取试卷列表失败:', error);
    return { total: 0, items: [] };
  }
}

/**
 * 删除试卷
 */
export async function deleteExam(
  examId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/exams/${examId}`, {
      credentials: 'include',
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '删除失败',
    };
  }
}

/**
 * 根据科目和年级获取知识点树
 */
export async function getKnowledgeTree(
  subject: string,
  grade: string,
): Promise<any[]> {
  try {
    const response = await fetch(
      `${API_BASE}/knowledge-points/by-subject?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`,
      { credentials: 'include' },
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('获取知识点树失败:', error);
    return [];
  }
}

/**
 * 根据科目和年级获取题型列表
 */
export async function getQuestionTypes(
  subject: string,
  grade: string,
): Promise<
  { id: string; name: string; type_category: string; answer_gap: number }[]
> {
  try {
    const response = await fetch(
      `${API_BASE}/question-types?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`,{ credentials: 'include' },
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('获取题型列表失败:', error);
    return [];
  }
}

/**
 * 同步生成试卷题目（用于调试）
 */
export async function generateQuestionsSync(req: GenerateRequest): Promise<{
  questions?: QuestionItem[];
  raw_content?: string;
  error?: string;
}> {
  try {
    const userPrompt = buildUserPrompt(req);

    const response = await fetch(`${API_BASE}/generate-sync`, {
      credentials: 'include',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_prompt: userPrompt }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `HTTP error! status: ${response.status}`,
      );
    }

    return await response.json();
  } catch (error) {
    return { error: error instanceof Error ? error.message : '生成失败' };
  }
}
