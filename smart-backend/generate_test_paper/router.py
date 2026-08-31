from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from openai import OpenAI
import os
import json

from database import get_db
from auth import get_current_user
from users.models import User
from .models import Exam, CourseType, KnowledgePoint, QuestionType
from .schemas import GenerateRequest, SaveExamRequest, ExamResponse, ExamListResponse
from .crud import create_exam, get_exam, get_exam_list, delete_exam

router = APIRouter(prefix="/api/chujuanji", tags=["试卷生成"], dependencies=[Depends(get_current_user)])

# Lazy initialization of OpenAI client
_client = None


EXAM_MODEL = os.getenv("EXAM_MODEL", "qwen3.8-flash")


def get_client() -> OpenAI:
    """出题走阿里云百炼 OpenAI 兼容端点（与 chat 模块共用 BAILIAN 凭据）。"""
    global _client
    if _client is None:
        api_key = os.getenv("BAILIAN_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="BAILIAN_API_KEY 环境变量未配置，请在 .env 文件中设置"
            )
        _client = OpenAI(
            api_key=api_key,
            base_url=os.getenv(
                "BAILIAN_BASE_URL",
                "https://llm-5tl2i6iigxxczoc1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
            ),
        )
    return _client


# 固定的系统提示词
SYSTEM_PROMPT = """你是一位经验丰富的出卷老师，擅长根据要求生成高质量的试卷题目。

【输出格式要求】
请严格按照以下 JSON 格式输出，不要输出任何其他内容：

{
  "questions": [
    {
      "id": "1",
      "type": "题目类型",
      "content": "题目内容",
      "options": [
        {"label": "A", "content": "选项A内容"},
        {"label": "B", "content": "选项B内容"},
        {"label": "C", "content": "选项C内容"},
        {"label": "D", "content": "选项D内容"}
      ],
      "answer": "答案",
      "analysis": "解析内容"
    }
  ]
}

【注意事项】
1. 题目难度要符合要求的难度级别
2. 题目内容要准确、严谨、无争议
3. 解析要简洁明了，只包含关键解题步骤，不要输出思考过程
4. 选择题必须有4个选项（A、B、C、D）
5. 填空题用 _____ 表示填空处，options 留空数组 []
6. 解答题的 answer 只写最终答案
7. 数学公式请使用 LaTeX 格式，如 $x^2$、$\\frac{1}{2}$ 等
8. 确保 JSON 格式完整、可解析
9. 题目数量要与要求一致
10. 直接输出 JSON，不要有任何其他文字说明"""


def build_user_prompt(
    subject: str,
    grade: str,
    knowledge_point: str,
    test_point: Optional[str],
    question_types: List[str],
    quantity: int,
    difficulty: int,
    exam_type: str,
) -> str:
    """构建用户提示词"""
    types_str = "、".join(question_types)
    test_point_info = f"\n- 考点：{test_point}" if test_point else ""

    prompt = f"""请根据以下要求生成试卷题目：

【基本信息】
- 科目：{subject}
- 年级：{grade}
- 知识点：{knowledge_point}{test_point_info}
- 题型：{types_str}
- 数量：{quantity} 题
- 难度：{difficulty}/10（1为最简单，10为最难）
- 试卷类型：{exam_type}

请严格按照系统提示的 JSON 格式输出题目。"""

    return prompt


@router.post("/generate", operation_id="generateQuestionsApiChujuanjiGeneratePost")
async def generate_questions(req: GenerateRequest):
    """生成试卷题目（流式输出）；支持带已有题目+优化建议重新生成"""

    user_prompt = req.user_prompt
    # 重新生成：已有题目 + 优化建议追加到提示词
    if req.existing_questions or req.optimization_suggestion:
        parts = [user_prompt]
        if req.existing_questions:
            parts.append(
                "【已有题目】\n"
                + json.dumps(req.existing_questions, ensure_ascii=False)
            )
        if req.optimization_suggestion:
            parts.append(f"【优化建议】\n{req.optimization_suggestion}")
        parts.append(
            "请基于以上【已有题目】和【优化建议】重新生成优化后的题目，"
            "保持题目数量与题型不变，仍严格按照系统提示的 JSON 格式输出。"
        )
        user_prompt = "\n\n".join(parts)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    # 用同步生成器（内部是阻塞的 SDK 迭代）：Starlette 会用线程池迭代 sync 生成器，
    # 不阻塞事件循环。若写成 async def 则会在事件循环里跑阻塞迭代，堵塞整个服务。
    def generate_stream():
        try:
            completion = get_client().chat.completions.create(
                model=EXAM_MODEL,
                messages=messages,
                stream=True,
                top_p=0.8,
                temperature=0.7,
                extra_body={
                    # 深度思考：思维链走 reasoning_content 增量下发（前端渲染思考过程），
                    # 题目内容走 content（前端状态机增量解析）
                    "enable_thinking": True,
                    "enable_search": False,
                    "result_format": "message",
                }
            )

            answer_content = ""
            reasoning_content = ""

            for chunk in completion:
                if not chunk.choices:
                    continue

                delta = chunk.choices[0].delta

                # 思维链增量：单独事件下发（re 前缀，与题目 content 区分）
                reasoning = getattr(delta, "reasoning_content", None)
                if reasoning:
                    reasoning_content += reasoning
                    yield f"data: {json.dumps({'reasoning': reasoning}, ensure_ascii=False)}\n\n"

                if hasattr(delta, "content") and delta.content:
                    answer_content += delta.content
                    yield f"data: {json.dumps({'content': delta.content}, ensure_ascii=False)}\n\n"

            # 发送完成信号（附完整思考内容，供前端记录）
            yield f"data: {json.dumps({'done': True, 'full_content': answer_content, 'reasoning': reasoning_content}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/generate-sync")
def generate_questions_sync(req: GenerateRequest):
    """生成试卷题目（同步输出，用于调试）"""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": req.user_prompt}
    ]

    try:
        completion = get_client().chat.completions.create(
            model=EXAM_MODEL,
            messages=messages,
            stream=False,
            top_p=0.8,
            temperature=0.7,
        )

        answer_content = completion.choices[0].message.content

        # 直接解析 JSON（JSON Mode 返回标准 JSON）
        try:
            result = json.loads(answer_content)
            return result
        except json.JSONDecodeError:
            # 如果解析失败，返回原始内容
            return {"raw_content": answer_content, "error": "JSON 解析失败"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/exams", response_model=ExamResponse, operation_id="saveExamApiChujuanjiExamsPost")
async def save_exam(
    req: SaveExamRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """保存试卷（记录创建用户）"""
    exam = create_exam(db, req, user_id=current_user.id)
    return exam


@router.get("/exams", response_model=ExamListResponse, operation_id="listExamsApiChujuanjiExamsGet")
async def list_exams(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    subject: Optional[str] = None,
    grade: Optional[str] = None,
    exam_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """获取试卷列表"""
    items, total = get_exam_list(db, skip, limit, subject, grade, exam_type)
    return ExamListResponse(total=total, items=items)


@router.get("/exams/{exam_id}", response_model=ExamResponse, operation_id="getExamDetailApiChujuanjiExamsExamIdGet")
async def get_exam_detail(exam_id: int, db: Session = Depends(get_db)):
    """获取试卷详情"""
    exam = get_exam(db, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="试卷不存在")
    return exam


@router.delete("/exams/{exam_id}", operation_id="removeExamApiChujuanjiExamsExamIdDelete")
async def remove_exam(exam_id: int, db: Session = Depends(get_db)):
    """删除试卷"""
    success = delete_exam(db, exam_id)
    if not success:
        raise HTTPException(status_code=404, detail="试卷不存在")
    return {"message": "删除成功"}


# ==================== 知识点相关接口 ====================

# 科目与课程类型编码的映射
SUBJECT_MAPPING = {
    "语文": {"PRIMARY": "PRIMARY_Chinese", "JUNIOR": "JUNIOR_Chinese", "SENIOR": "SENIOR_Chinese"},
    "数学": {"PRIMARY": "PRIMARY_Mathematics", "JUNIOR": "JUNIOR_Mathematics", "SENIOR": "SENIOR_Mathematics"},
    "英语": {"PRIMARY": "PRIMARY_English", "JUNIOR": "JUNIOR_English", "SENIOR": "SENIOR_English"},
    "物理": {"JUNIOR": "JUNIOR_Physics", "SENIOR": "SENIOR_Physics"},
    "化学": {"JUNIOR": "JUNIOR_Chemistry", "SENIOR": "SENIOR_Chemistry"},
    "生物": {"JUNIOR": "JUNIOR_Biology", "SENIOR": "SENIOR_Biology"},
    "历史": {"JUNIOR": "JUNIOR_History", "SENIOR": "SENIOR_History"},
    "地理": {"JUNIOR": "JUNIOR_Geography"},
    "政治": {"JUNIOR": "JUNIOR_Politics", "PRIMARY": "PRIMARY_Politics"},
    "科学": {"PRIMARY": "PRIMARY_Science"},
}


def get_course_type_code(subject: str, grade: str) -> Optional[str]:
    """根据科目和年级获取课程类型编码"""
    subject_map = SUBJECT_MAPPING.get(subject)
    if not subject_map:
        return None

    # 根据年级判断学段
    if "小学" in grade:
        return subject_map.get("PRIMARY")
    elif "初中" in grade:
        return subject_map.get("JUNIOR")
    elif "高中" in grade:
        return subject_map.get("SENIOR")

    return None


@router.get("/course-types")
async def get_course_types(db: Session = Depends(get_db)):
    """获取所有课程类型"""
    courses = db.query(CourseType).order_by(CourseType.seq_no).all()
    return [
        {
            "id": c.id,
            "dict_value": c.dict_value,
            "dict_name": c.dict_name,
            "can_listen": c.can_listen,
            "seq_no": c.seq_no,
        }
        for c in courses
    ]


@router.get("/knowledge-points/by-subject", operation_id="getKnowledgePointsBySubjectApiChujuanjiKnowledgePointsBySubjectGet")
async def get_knowledge_points_by_subject(
    subject: str,
    grade: str,
    db: Session = Depends(get_db),
):
    """根据科目和年级获取知识点树结构"""
    course_type_code = get_course_type_code(subject, grade)
    if not course_type_code:
        return []

    def build_tree(parent_id: str) -> list:
        points = db.query(KnowledgePoint).filter(
            KnowledgePoint.course_type_code == course_type_code,
            KnowledgePoint.parent_id == parent_id,
        ).order_by(KnowledgePoint.seq_no).all()

        result = []
        for p in points:
            node = {
                "id": p.point_id,
                "title": p.name,
                "value": p.point_id,
                "key": p.point_id,
            }
            if p.has_children:
                node["children"] = build_tree(p.point_id)
            result.append(node)
        return result

    return build_tree("0")


@router.get("/knowledge-points")
async def get_knowledge_points(
    course_type_code: Optional[str] = None,
    parent_id: Optional[str] = None,
    level: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """获取知识点列表"""
    query = db.query(KnowledgePoint)

    if course_type_code:
        query = query.filter(KnowledgePoint.course_type_code == course_type_code)
    if parent_id is not None:
        query = query.filter(KnowledgePoint.parent_id == parent_id)
    if level is not None:
        query = query.filter(KnowledgePoint.level == level)

    points = query.order_by(KnowledgePoint.course_type_code, KnowledgePoint.level, KnowledgePoint.seq_no).all()

    return [
        {
            "id": p.id,
            "point_id": p.point_id,
            "name": p.name,
            "parent_id": p.parent_id,
            "course_type_code": p.course_type_code,
            "course_type_name": p.course_type_name,
            "has_children": p.has_children,
            "level": p.level,
            "seq_no": p.seq_no,
        }
        for p in points
    ]


@router.get("/knowledge-points/tree")
async def get_knowledge_tree(
    course_type_code: str,
    parent_id: str = "0",
    db: Session = Depends(get_db),
):
    """获取知识点树结构"""
    def build_tree(parent_id: str) -> list:
        points = db.query(KnowledgePoint).filter(
            KnowledgePoint.course_type_code == course_type_code,
            KnowledgePoint.parent_id == parent_id,
        ).order_by(KnowledgePoint.seq_no).all()

        result = []
        for p in points:
            node = {
                "id": p.point_id,
                "name": p.name,
                "parent_id": p.parent_id,
                "has_children": bool(p.has_children),
                "level": p.level,
                "seq_no": p.seq_no,
            }
            if p.has_children:
                node["children"] = build_tree(p.point_id)
            result.append(node)
        return result

    return build_tree(parent_id)


@router.get("/knowledge-points/search")
async def search_knowledge_points(
    keyword: str,
    course_type_code: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """搜索知识点"""
    query = db.query(KnowledgePoint).filter(KnowledgePoint.name.contains(keyword))

    if course_type_code:
        query = query.filter(KnowledgePoint.course_type_code == course_type_code)

    points = query.limit(50).all()

    return [
        {
            "id": p.id,
            "point_id": p.point_id,
            "name": p.name,
            "parent_id": p.parent_id,
            "course_type_code": p.course_type_code,
            "course_type_name": p.course_type_name,
            "has_children": p.has_children,
            "level": p.level,
        }
        for p in points
    ]


@router.get("/knowledge-points/stats")
async def get_knowledge_stats(db: Session = Depends(get_db)):
    """获取知识点统计信息"""
    from sqlalchemy import func

    # 课程类型数量
    course_count = db.query(func.count(CourseType.id)).scalar()

    # 知识点总量
    point_count = db.query(func.count(KnowledgePoint.id)).scalar()

    # 各课程节点数
    course_stats = db.query(
        KnowledgePoint.course_type_name,
        func.count(KnowledgePoint.id).label("count")
    ).group_by(KnowledgePoint.course_type_name).order_by(func.count(KnowledgePoint.id).desc()).all()

    # 各层级节点数
    level_stats = db.query(
        KnowledgePoint.level,
        func.count(KnowledgePoint.id).label("count")
    ).group_by(KnowledgePoint.level).order_by(KnowledgePoint.level).all()

    return {
        "course_type_count": course_count,
        "knowledge_point_count": point_count,
        "course_stats": [{"name": name, "count": count} for name, count in course_stats],
        "level_stats": [{"level": level, "count": count} for level, count in level_stats],
    }


# ==================== 题型相关接口 ====================

@router.get("/question-types", operation_id="getQuestionTypesApiChujuanjiQuestionTypesGet")
async def get_question_types(
    subject: str,
    grade: str,
    db: Session = Depends(get_db),
):
    """根据科目和年级获取题型列表"""
    course_type_code = get_course_type_code(subject, grade)
    if not course_type_code:
        return []

    types = db.query(QuestionType).filter(
        QuestionType.course_type_code == course_type_code
    ).order_by(QuestionType.seq_no).all()

    return [
        {
            "id": t.type_id,
            "name": t.name,
            "type_category": t.type_category,
            "answer_gap": t.answer_gap,
        }
        for t in types
    ]
