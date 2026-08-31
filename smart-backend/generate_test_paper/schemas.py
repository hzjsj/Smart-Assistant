from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class GenerateRequest(BaseModel):
    """生成试卷请求"""
    user_prompt: str
    # 重新生成：已有题目（不含深度思考内容）+ 用户优化建议
    existing_questions: Optional[list] = None
    optimization_suggestion: Optional[str] = None


class SaveExamRequest(BaseModel):
    """保存试卷请求"""
    title: str
    subject: str
    grade: str
    exam_type: str
    knowledge_point: Optional[str] = None
    test_point: Optional[str] = None
    question_types: List[str]
    quantity: int
    difficulty: int
    questions: list


class ExamResponse(BaseModel):
    """试卷响应"""
    id: int
    title: str
    subject: str
    grade: str
    exam_type: str
    knowledge_point: Optional[str]
    test_point: Optional[str]
    question_types: Optional[str]
    quantity: int
    difficulty: int
    questions_json: str
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class ExamListResponse(BaseModel):
    """试卷列表响应"""
    total: int
    items: List[ExamResponse]
