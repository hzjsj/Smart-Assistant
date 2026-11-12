"""Registered through hermes.router before the existing startup create_all."""

from sqlalchemy import Boolean, Column, Integer, String, Text, UniqueConstraint

from database import Base, TimestampMixin


class HermesQuestionBank(TimestampMixin, Base):
    __tablename__ = "hermes_question_banks"
    __table_args__ = (UniqueConstraint("user_id", "fingerprint"),)

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    fingerprint = Column(String(64), nullable=False)
    source_url = Column(Text, nullable=True)
    payload_json = Column(Text, nullable=False)


class HermesPaper(TimestampMixin, Base):
    __tablename__ = "hermes_papers"

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    bank_id = Column(String(64), nullable=False, index=True)
    title = Column(String(300), nullable=False)
    include_answers = Column(Boolean, nullable=False, default=False)
    payload_json = Column(Text, nullable=False)


class HermesExport(TimestampMixin, Base):
    __tablename__ = "hermes_exports"

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    paper_id = Column(String(64), nullable=False, index=True)
    format = Column(String(12), nullable=False)
    status = Column(String(20), nullable=False)
    filename = Column(String(400), nullable=False)
    error = Column(String(500), nullable=True)
