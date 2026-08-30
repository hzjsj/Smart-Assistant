from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.sql import func
from database import Base


class Exam(Base):
    """试卷模型"""
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    title = Column(String(200), nullable=False, comment="试卷标题")
    subject = Column(String(50), nullable=False, comment="科目")
    grade = Column(String(50), nullable=False, comment="年级")
    exam_type = Column(String(50), nullable=False, comment="试卷类型")
    knowledge_point = Column(String(200), nullable=True, comment="知识点")
    test_point = Column(String(200), nullable=True, comment="考点")
    question_types = Column(String(200), nullable=True, comment="题型列表，逗号分隔")
    quantity = Column(Integer, nullable=False, comment="题目数量")
    difficulty = Column(Integer, nullable=False, comment="难度等级")
    questions_json = Column(Text, nullable=False, comment="题目内容JSON")
    user_id = Column(Integer, nullable=True, comment="创建用户ID")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")


class CourseType(Base):
    """课程类型表"""
    __tablename__ = "course_type"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dict_value = Column(String(100), unique=True, nullable=False, comment="课程编码，如 PRIMARY_Chinese")
    dict_name = Column(String(100), nullable=False, comment="课程名称，如 小学语文")
    can_listen = Column(Integer, default=0, comment="是否可试听 0-否 1-是")
    seq_no = Column(Integer, default=0, comment="排序号")
    source_id = Column(String(50), nullable=True, comment="原始数据ID")
    create_time = Column(DateTime, server_default=func.now(), comment="创建时间")
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")


class KnowledgePoint(Base):
    """知识点表"""
    __tablename__ = "knowledge_point"
    __table_args__ = (
        Index('idx_kp_course_type', 'course_type_code'),
        Index('idx_kp_parent_id', 'parent_id'),
        Index('idx_kp_level', 'level'),
        Index('idx_kp_course_level', 'course_type_code', 'level'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    point_id = Column(String(50), unique=True, nullable=False, comment="原始知识点ID")
    name = Column(String(200), nullable=False, comment="知识点名称")
    parent_id = Column(String(50), default="0", comment="父节点ID，0表示根节点")
    course_type_code = Column(String(100), nullable=False, comment="课程类型编码")
    course_type_name = Column(String(100), nullable=False, comment="课程类型名称")
    has_children = Column(Integer, default=0, comment="是否有子节点 0-否 1-是")
    level = Column(Integer, default=1, comment="层级深度 1=根")
    seq_no = Column(Integer, default=0, comment="排序号")
    enabled = Column(Integer, default=0, comment="启用状态")
    source_create_time = Column(String(50), nullable=True, comment="原始数据创建时间")
    create_time = Column(DateTime, server_default=func.now(), comment="记录创建时间")
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="记录更新时间")


class QuestionType(Base):
    """题型表"""
    __tablename__ = "question_type"
    __table_args__ = (
        Index('idx_qt_course_type', 'course_type_code'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    type_id = Column(String(50), unique=True, nullable=False, comment="原始题型ID")
    name = Column(String(100), nullable=False, comment="题型名称")
    course_type_code = Column(String(100), nullable=False, comment="课程类型编码")
    course_type_name = Column(String(100), nullable=False, comment="课程类型名称")
    type_category = Column(String(50), nullable=True, comment="题型分类 objective/subjective")
    answer_gap = Column(Integer, default=0, comment="是否有填空 0-否 1-是")
    seq_no = Column(Integer, default=0, comment="排序号")
    enabled = Column(Integer, default=0, comment="启用状态")
    create_time = Column(DateTime, server_default=func.now(), comment="记录创建时间")
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="记录更新时间")
