import copy
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import xml.etree.ElementTree as ET
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from auth import get_current_user
from database import get_db
from hermes import export_service
from hermes.models import HermesQuestionBank, HermesPaper, HermesExport
from hermes.question_bank_service import validate_artifact_url
from hermes.router import router

DOCUMENT = {
    "type": "question_bank", "version": 1, "id": "math-bank", "title": "数学练习", "subject": "数学", "grade": "初中一年级", "exam_type": "单元测试", "difficulty": 5,
    "questions": [
        {"id": "q1", "type": "单项选择题", "content": "求方程 $x^2-3x+2=0$ 的根。", "options": [{"label": "A", "content": "1和2"}, {"label": "B", "content": "0和3"}], "answer": "A", "analysis": "因式分解得 $(x-1)(x-2)=0$。", "score": 3, "knowledge_points": ["方程", "因式分解"], "cognitive_level": "应用", "difficulty": 5},
        {"id": "q2", "type": "填空题", "content": "计算 $2+3$。", "options": [], "answer": "5", "analysis": "相加得5。", "score": 7, "knowledge_points": ["算术"], "cognitive_level": "理解", "difficulty": 2},
    ],
}


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        for model in (HermesQuestionBank, HermesPaper, HermesExport):
            model.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.app = FastAPI()
        self.app.include_router(router)
        def db():
            with self.sessions() as session:
                yield session
        self.app.dependency_overrides[get_db] = db
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        self.client = TestClient(self.app)
        parent = Path(__file__).parent / ".artifacts"
        parent.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.assertTrue(Path(self.temp.name).resolve().is_relative_to(parent.resolve()))
        self.storage = patch.object(export_service, "STORAGE_DIR", Path(self.temp.name))
        self.storage.start()

    def tearDown(self):
        self.client.close()
        self.storage.stop()
        self.temp.cleanup()
        self.engine.dispose()

    def bank(self):
        response = self.client.post("/api/hermes/v1/question-banks/import", json={"document": DOCUMENT})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def paper(self, selected=None):
        bank = self.bank()
        response = self.client.post("/api/hermes/v1/papers", json={"bank_id": bank["id"], "selected_ids": selected or ["q2", "q1"], "title": "自选数学试卷", "include_answers": True})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_import_deduplication_and_download(self):
        first, second = self.bank(), self.bank()
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["question_count"], 2)
        self.assertEqual(first["total_score"], 10)
        downloaded = self.client.get(f"/api/hermes/v1/question-banks/{first['id']}/download")
        self.assertIn("attachment", downloaded.headers["content-disposition"])
        self.assertEqual(downloaded.json()["questions"][0]["id"], "q1")

    def test_invalid_documents_and_selections(self):
        document = copy.deepcopy(DOCUMENT)
        document["questions"][1]["id"] = "q1"
        self.assertEqual(self.client.post("/api/hermes/v1/question-banks/import", json={"document": document}).status_code, 422)
        bank = self.bank()
        for ids in ([], ["q1", "q1"], ["missing"]):
            response = self.client.post("/api/hermes/v1/papers", json={"bank_id": bank["id"], "selected_ids": ids, "title": "试卷"})
            self.assertEqual(response.status_code, 422)

    def test_paper_snapshot_preserves_selection_order_and_real_scores(self):
        paper = self.paper(["q2"])
        self.assertEqual(paper["question_count"], 1)
        self.assertEqual(paper["total_score"], 7)
        self.assertEqual([q["id"] for q in paper["document"]["questions"]], ["q2"])
        both = self.paper()
        self.assertEqual([q["id"] for q in both["document"]["questions"]], ["q2", "q1"])

    def test_missing_score_is_not_invented(self):
        document = copy.deepcopy(DOCUMENT)
        document["questions"][0].pop("score")
        response = self.client.post("/api/hermes/v1/question-banks/import", json={"document": document})
        self.assertIsNone(response.json()["total_score"])

    def test_blank_paper_title_is_rejected(self):
        bank = self.bank()
        response = self.client.post("/api/hermes/v1/papers", json={"bank_id": bank["id"], "selected_ids": ["q1"], "title": "   "})
        self.assertEqual(response.status_code, 422)

    def test_ownership_on_bank_paper_and_export(self):
        paper = self.paper()
        export = self.client.post(f"/api/hermes/v1/papers/{paper['id']}/exports", json={"format": "json"}).json()
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=2)
        for path in (f"question-banks/{paper['bank_id']}", f"question-banks/{paper['bank_id']}/download", f"papers/{paper['id']}", f"exports/{export['id']}/download"):
            self.assertEqual(self.client.get(f"/api/hermes/v1/{path}").status_code, 404)

    def test_remote_import_cache_uses_real_file_and_never_refetches_expired_link(self):
        with patch("hermes.question_bank_service.fetch_question_bank", new=AsyncMock(return_value=DOCUMENT)) as fetch:
            first = self.client.post("/api/hermes/v1/question-banks/import", json={"url": "https://files.example.com/bank.json?sig=a%2Bb"})
            second = self.client.post("/api/hermes/v1/question-banks/import", json={"url": "https://files.example.com/bank.json?sig=a%2Bb"})
            self.assertEqual(first.json()["id"], second.json()["id"])
            fetch.assert_awaited_once_with("https://files.example.com/bank.json?sig=a%2Bb")

    def test_url_allowlist_and_unsafe_schemes(self):
        with patch.dict("os.environ", {"HERMES_ARTIFACT_ALLOWED_HOSTS": "files.example.com"}):
            self.assertEqual(validate_artifact_url("https://files.example.com/a.json?sig=a%2Bb"), "https://files.example.com/a.json?sig=a%2Bb")
            for url in ("file:///etc/passwd", "https://evil.example/a.json", "https://user:pass@files.example.com/a.json", "http://169.254.169.254/latest/meta-data"):
                with self.assertRaises(Exception):
                    validate_artifact_url(url)

    def test_multiple_artifact_hosts_from_file_and_environment(self):
        config = Path(self.temp.name) / "artifact_hosts.json"
        config.write_text(json.dumps({"allowed_hosts": ["kdsa.oss-cn-shanghai.aliyuncs.com", "downloads.example.com"]}), encoding="utf-8")
        with patch("hermes.question_bank_service.ARTIFACT_HOSTS_FILE", config), patch.dict("os.environ", {"HERMES_ARTIFACT_ALLOWED_HOSTS": " files.example.com, CDN.example.com "}):
            for host in ("kdsa.oss-cn-shanghai.aliyuncs.com", "downloads.example.com", "files.example.com", "cdn.example.com"):
                url = f"https://{host}/bank.json?sig=a%2Bb"
                self.assertEqual(validate_artifact_url(url), url)
            for host in ("other.oss-cn-shanghai.aliyuncs.com", "sub.files.example.com", "files.example.com.evil.example"):
                with self.assertRaises(Exception) as caught:
                    validate_artifact_url(f"https://{host}/bank.json")
                self.assertEqual(caught.exception.status_code, 400)
            config.write_text('{"allowed_hosts": ["new.example.com"]}', encoding="utf-8")
            self.assertEqual(validate_artifact_url("https://new.example.com/bank.json"), "https://new.example.com/bank.json")
            with self.assertRaises(Exception):
                validate_artifact_url("https://downloads.example.com/bank.json")

    def test_invalid_artifact_host_configuration_fails_explicitly(self):
        config = Path(self.temp.name) / "artifact_hosts.json"
        with patch("hermes.question_bank_service.ARTIFACT_HOSTS_FILE", config):
            for value in ("invalid json", 'null', '{"allowed_hosts":"files.example.com"}', '{"allowed_hosts":["https://files.example.com"]}', '{"allowed_hosts":["*.example.com"]}', '{"allowed_hosts":["files.example.com:443"]}'):
                config.write_text(value, encoding="utf-8")
                with self.assertRaises(Exception) as caught:
                    validate_artifact_url("https://files.example.com/bank.json")
                self.assertEqual(caught.exception.status_code, 500)

    def test_docx_contains_selected_questions_and_native_math(self):
        paper = self.paper()
        response = self.client.post(f"/api/hermes/v1/papers/{paper['id']}/exports", json={"format": "docx"})
        self.assertEqual(response.status_code, 200, response.text)
        download = self.client.get(response.json()["download_url"])
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            xml = archive.read("word/document.xml").decode()
            self.assertIn("参考答案与解析", xml)
            self.assertIn("oMath", xml)
            self.assertIn("自选数学试卷", xml)
        from docx import Document
        paragraphs = Document(io.BytesIO(download.content)).paragraphs
        self.assertIn("一、填空题（本大题共1小题，每小题7分，满分7分）", [paragraph.text for paragraph in paragraphs])
        self.assertIn("二、单项选择题（本大题共1小题，每小题3分，满分3分）", [paragraph.text for paragraph in paragraphs])
        self.assertTrue(any(paragraph.text.startswith("1. 计算") for paragraph in paragraphs))

    def test_section_headings_use_real_counts_and_scores(self):
        def questions(scores):
            return [SimpleNamespace(score=score) for score in scores]
        heading = export_service.question_section_heading
        self.assertEqual(heading("选择题", questions([4] * 8), 0), "一、选择题（本大题共8小题，每小题4分，满分32分）")
        self.assertEqual(heading("填空题", questions([5] * 4), 1), "二、填空题（本大题共4小题，每小题5分，满分20分）")
        self.assertEqual(heading("计算题", questions([0.1, 0.2]), 9), "十、计算题（本大题共2小题，各小题分值不等，满分0.3分）")
        self.assertEqual(heading("解答题", questions([3, None]), 0), "一、解答题（本大题共2小题，部分小题未标注分值）")
        self.assertEqual(heading("填空题", questions([0]), 100), "一百零一、填空题（本大题共1小题，每小题0分，满分0分）")

    def test_xlsx_has_detail_and_summary_sheets_and_selected_rows(self):
        paper = self.paper(["q2"])
        response = self.client.post(f"/api/hermes/v1/papers/{paper['id']}/exports", json={"format": "xlsx"})
        self.assertEqual(response.status_code, 200, response.text)
        downloaded = self.client.get(response.json()["download_url"])
        with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            self.assertEqual([e.attrib["name"] for e in workbook.findall("{*}sheets/{*}sheet")], ["题目明细", "维度汇总"])
            sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
            self.assertEqual(len(sheet.findall("{*}sheetData/{*}row")), 2)
            self.assertIn("q2", archive.read("xl/worksheets/sheet1.xml").decode())
            self.assertNotIn("q1", archive.read("xl/worksheets/sheet1.xml").decode())

    def test_pdf_upload_is_validated_and_downloadable(self):
        import fitz
        paper = self.paper()
        pdf = fitz.open()
        pdf.new_page().insert_text((72, 72), "PDF snapshot")
        response = self.client.post(f"/api/hermes/v1/papers/{paper['id']}/exports/pdf", files={"file": ("paper.pdf", pdf.tobytes(), "application/pdf")})
        pdf.close()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(self.client.get(response.json()["download_url"]).content.startswith(b"%PDF-"))
        invalid = self.client.post(f"/api/hermes/v1/papers/{paper['id']}/exports/pdf", files={"file": ("bad.pdf", b"not pdf", "application/pdf")})
        self.assertNotEqual(invalid.status_code, 200)

    def test_unauthenticated_import_is_rejected(self):
        self.app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.client.post("/api/hermes/v1/question-banks/import", json={"document": DOCUMENT}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
