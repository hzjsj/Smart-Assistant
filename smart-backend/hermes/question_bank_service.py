"""Authenticated import and immutable snapshots; no unrestricted URL proxy."""

import hashlib
import ipaddress
import json
import os
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import HermesPaper, HermesQuestionBank
from .question_schemas import (
    CreatePaperRequest, ImportQuestionBankRequest, PaperResponse,
    QuestionBankDocument, QuestionBankResponse,
)

MAX_JSON_BYTES = 5 * 1024 * 1024
ARTIFACT_HOSTS_FILE = Path(__file__).with_name("artifact_hosts.json")


def configured_artifact_hosts() -> set[str]:
    """Read administrator-owned exact hostnames without changing global config."""
    try:
        config = json.loads(ARTIFACT_HOSTS_FILE.read_text(encoding="utf-8-sig"))
        values = config["allowed_hosts"]
        if not isinstance(values, list):
            raise ValueError()
        hosts = set()
        for value in values:
            if not isinstance(value, str) or not value.strip():
                raise ValueError()
            host = value.strip().lower()
            parsed = urlsplit(f"https://{host}")
            if parsed.hostname != host or parsed.netloc != host or parsed.path or parsed.query or parsed.fragment:
                raise ValueError()
            if any(character.isspace() for character in host) or ":" in host or "*" in host:
                raise ValueError()
            hosts.add(host)
        return hosts
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(500, "Hermes 文件源站配置无效，请检查 hermes/artifact_hosts.json，allowed_hosts 必须是纯域名或 IPv4 地址数组") from exc


def allowed_artifact_hosts() -> set[str]:
    hosts = configured_artifact_hosts()
    hosts.add(urlsplit(os.getenv("HERMES_AGENT_BASE_URL", "http://127.0.0.1:8642/v1")).hostname)
    hosts.update(value.strip().lower() for value in os.getenv("HERMES_ARTIFACT_ALLOWED_HOSTS", "").split(",") if value.strip())
    endpoint = os.getenv("OSS_ENDPOINT", "").removeprefix("https://").removeprefix("http://").strip("/")
    bucket = os.getenv("OSS_BUCKET", "")
    if endpoint and bucket:
        hosts.add(f"{bucket}.{endpoint}")
    return {host.lower() for host in hosts if host}


def validate_artifact_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or not host:
            raise ValueError()
        if host not in allowed_artifact_hosts():
            raise HTTPException(400, "题库地址的源站未获允许，请使用 Hermes 文件服务或配置允许的文件源站")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address and (address.is_link_local or address.is_multicast or address.is_unspecified):
            raise ValueError()
        _ = parsed.port
        return url
    except ValueError as exc:
        raise HTTPException(400, "无效的题库下载地址") from exc


async def fetch_question_bank(url: str) -> dict:
    current = validate_artifact_url(url)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10), trust_env=False) as client:
            for _ in range(4):
                # Never forward the Hermes API key or browser cookies to file hosts.
                async with client.stream("GET", current, headers={"Accept": "application/json"}) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise HTTPException(502, "题库下载重定向缺少地址")
                        current = validate_artifact_url(urljoin(current, location))
                        continue
                    if response.is_error:
                        raise HTTPException(502, f"题库下载失败（上游 {response.status_code}）")
                    if "text/html" in response.headers.get("content-type", "").lower():
                        raise HTTPException(422, "题库地址返回了网页，请检查文件地址或访问权限")
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > MAX_JSON_BYTES:
                            raise HTTPException(413, "题库文件超过 5MB 上限")
                    value = json.loads(data.decode("utf-8-sig"))
                    if not isinstance(value, dict):
                        raise HTTPException(422, "题库 JSON 顶层必须是对象")
                    return value
            raise HTTPException(502, "题库地址重定向次数过多")
    except (httpx.RequestError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "无法读取有效的题库 JSON，请检查源文件后重试") from exc


def document_total(document: QuestionBankDocument) -> float | None:
    if any(question.score is None for question in document.questions):
        return None
    return round(sum(question.score or 0 for question in document.questions), 6)


def bank_response(bank: HermesQuestionBank) -> QuestionBankResponse:
    document = QuestionBankDocument.model_validate_json(bank.payload_json)
    return QuestionBankResponse(id=bank.id, question_count=len(document.questions), total_score=document_total(document), document=document)


def get_bank(db: Session, bank_id: str, user_id: int) -> HermesQuestionBank:
    bank = db.query(HermesQuestionBank).filter_by(id=bank_id, user_id=user_id).first()
    if not bank:
        raise HTTPException(404, "题库不存在或无权访问")
    return bank


async def import_bank(db: Session, user_id: int, request: ImportQuestionBankRequest) -> QuestionBankResponse:
    if request.url:
        candidates = db.query(HermesQuestionBank).filter_by(user_id=user_id, source_url=request.url).all()
        # MySQL commonly uses a case-insensitive text collation, but signed
        # paths/query strings are case sensitive. Verify the exact source too.
        cached = next((bank for bank in candidates if bank.source_url == request.url), None)
        if cached:
            return bank_response(cached)
        payload = await fetch_question_bank(request.url)
        for key in ("title", "subject", "grade", "exam_type", "difficulty"):
            value = getattr(request, key)
            if key not in payload and value is not None:
                payload[key] = value
        try:
            document = QuestionBankDocument.model_validate(payload)
        except ValidationError as exc:
            problems = "; ".join(f"{'.'.join(map(str, error['loc']))}: {error['msg']}" for error in exc.errors()[:5])
            raise HTTPException(422, f"题库结构不符合要求：{problems}") from exc
    else:
        document = request.document
    serialized = document.model_dump_json()
    if len(serialized.encode("utf-8")) > MAX_JSON_BYTES:
        raise HTTPException(413, "题库数据超过 5MB 上限")
    fingerprint = hashlib.sha256(serialized.encode()).hexdigest()
    bank = db.query(HermesQuestionBank).filter_by(user_id=user_id, fingerprint=fingerprint).first()
    if not bank:
        bank = HermesQuestionBank(id=uuid.uuid4().hex, user_id=user_id, fingerprint=fingerprint, source_url=request.url, payload_json=serialized)
        db.add(bank)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            bank = db.query(HermesQuestionBank).filter_by(user_id=user_id, fingerprint=fingerprint).one()
    return bank_response(bank)


def paper_response(paper: HermesPaper) -> PaperResponse:
    document = QuestionBankDocument.model_validate_json(paper.payload_json)
    return PaperResponse(id=paper.id, bank_id=paper.bank_id, title=paper.title, question_count=len(document.questions), total_score=document_total(document), include_answers=paper.include_answers, document=document)


def get_paper(db: Session, paper_id: str, user_id: int) -> HermesPaper:
    paper = db.query(HermesPaper).filter_by(id=paper_id, user_id=user_id).first()
    if not paper:
        raise HTTPException(404, "试卷不存在或无权访问")
    return paper


def create_paper(db: Session, user_id: int, request: CreatePaperRequest) -> PaperResponse:
    source = bank_response(get_bank(db, request.bank_id, user_id)).document
    by_id = {question.id: question for question in source.questions}
    if len(set(request.selected_ids)) != len(request.selected_ids) or any(key not in by_id for key in request.selected_ids):
        raise HTTPException(422, "已选题目包含重复或不属于该题库的 id")
    document = source.model_copy(update={"title": request.title, "questions": [by_id[key] for key in request.selected_ids]})
    paper = HermesPaper(id=uuid.uuid4().hex, user_id=user_id, bank_id=request.bank_id, title=request.title, include_answers=request.include_answers, payload_json=document.model_dump_json())
    db.add(paper)
    db.commit()
    return paper_response(paper)
