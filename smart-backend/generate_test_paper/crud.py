from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
import json

from .models import Exam
from .schemas import SaveExamRequest


def create_exam(db: Session, req: SaveExamRequest, user_id: Optional[int] = None) -> Exam:
    """创建试卷"""
    exam = Exam(
        title=req.title,
        subject=req.subject,
        grade=req.grade,
        exam_type=req.exam_type,
        knowledge_point=req.knowledge_point,
        test_point=req.test_point,
        question_types=",".join(req.question_types),
        quantity=req.quantity,
        difficulty=req.difficulty,
        questions_json=json.dumps(req.questions, ensure_ascii=False),
        user_id=user_id,
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


def get_exam(db: Session, exam_id: int) -> Optional[Exam]:
    """获取单个试卷"""
    return db.query(Exam).filter(Exam.id == exam_id).first()


def get_exam_list(
    db: Session,
    skip: int = 0,
    limit: int = 20,
    subject: Optional[str] = None,
    grade: Optional[str] = None,
    exam_type: Optional[str] = None,
    user_id: Optional[int] = None,
) -> tuple[List[Exam], int]:
    """获取试卷列表"""
    query = db.query(Exam)

    if subject:
        query = query.filter(Exam.subject == subject)
    if grade:
        query = query.filter(Exam.grade == grade)
    if exam_type:
        query = query.filter(Exam.exam_type == exam_type)
    if user_id:
        query = query.filter(Exam.user_id == user_id)

    total = query.count()
    items = query.order_by(desc(Exam.created_at)).offset(skip).limit(limit).all()

    return items, total


def delete_exam(db: Session, exam_id: int) -> bool:
    """删除试卷"""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if exam:
        db.delete(exam)
        db.commit()
        return True
    return False
