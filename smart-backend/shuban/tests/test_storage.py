"""独立文档、批次提交和历史兼容的文件系统回归测试。"""
import importlib
import io
import os
import tempfile
import types
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from shuban import storage
from shuban.fbdview import render_html


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.root = self.base / "user"
        self.root.mkdir()
        self.counter = 0

    def tearDown(self):
        self.temporary.cleanup()

    def payload(self, files):
        self.counter += 1
        directory = self.base / f"incoming-{self.counter}"
        directory.mkdir()
        for name, content in files.items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        return directory

    def test_same_names_are_isolated_and_original_names_are_preserved(self):
        first, _ = storage.publish(self.root, self.payload({"试卷.fbd": b"one", "pics/1.TIF": b"image one"}))
        second, _ = storage.publish(self.root, self.payload({"试卷.fbd": b"two", "pics/1.TIF": b"image two"}))
        self.assertNotEqual(first[0]["id"], second[0]["id"])
        for document, expected in ((first[0], b"image one"), (second[0], b"image two")):
            path, _, _ = storage.resolve(self.root, document["id"])
            self.assertEqual(path.name, "试卷.fbd")
            self.assertEqual((path.parent / "pics/1.TIF").read_bytes(), expected)
        with self.assertRaises(HTTPException) as error:
            storage.resolve(self.root, "试卷.fbd")
        self.assertEqual(error.exception.status_code, 409)

    def test_companion_update_changes_only_target_and_keeps_old_snapshot(self):
        first, _ = storage.publish(self.root, self.payload({"a.fbd": b"one", "a.PRO": b"old", "img.TIF": b"old"}))
        second, _ = storage.publish(self.root, self.payload({"a.fbd": b"two", "img.TIF": b"other"}))
        old_path, _, _ = storage.resolve(self.root, first[0]["id"])
        updated, unchanged = storage.publish(self.root, self.payload({"a.pro": b"new", "img.TIF": b"new"}), first[0]["id"])
        self.assertFalse(unchanged)
        self.assertNotEqual(first[0]["version"], updated[0]["version"])
        new_path, _, _ = storage.resolve(self.root, first[0]["id"])
        self.assertEqual((new_path.parent / "a.PRO").read_bytes(), b"new")
        self.assertEqual((old_path.parent / "a.PRO").read_bytes(), b"old")
        self.assertEqual(storage.resolve(self.root, second[0]["id"])[2], second[0]["version"])

    def test_failed_publish_preserves_catalog_and_removes_uncommitted_versions(self):
        original, _ = storage.publish(self.root, self.payload({"old.fbd": b"original"}))
        before = (self.root / "catalog.json").read_bytes()
        payload = self.payload({"a.fbd": b"a", "b.fbd": b"b", "pics/1.TIF": b"asset"})
        with patch.object(storage, "_write_catalog", side_effect=PermissionError("locked")):
            with self.assertRaises(PermissionError):
                storage.publish(self.root, payload)
        self.assertEqual((self.root / "catalog.json").read_bytes(), before)
        self.assertEqual([item["id"] for item in storage.list_documents(self.root)], [original[0]["id"]])
        self.assertEqual(len(list((self.root / "documents").rglob("*.fbd"))), 1)

    def test_manual_pro_change_invalidates_version_without_touching_fbd(self):
        documents, _ = storage.publish(self.root, self.payload({"a.fbd": b"text", "a.PRO": b"old"}))
        path, metadata, before = storage.resolve(self.root, documents[0]["id"])
        fbd_stat = path.stat()
        pro = path.with_suffix(".PRO")
        timestamp = pro.stat().st_mtime_ns + 1000000000
        pro.write_bytes(b"new")
        os.utime(pro, ns=(timestamp, timestamp))
        self.assertNotEqual(before, storage.version(path.parent, metadata))
        self.assertEqual(fbd_stat.st_mtime_ns, path.stat().st_mtime_ns)
        self.assertEqual(fbd_stat.st_size, path.stat().st_size)

    def test_mid_batch_move_failure_never_publishes_partial_documents(self):
        payload = self.payload({"a.fbd": b"a", "b.fbd": b"b"})
        real_replace = os.replace
        count = 0

        def replace(source, destination):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("second document failed")
            return real_replace(source, destination)

        with patch.object(storage.os, "replace", side_effect=replace):
            with self.assertRaises(OSError):
                storage.publish(self.root, payload)
        self.assertEqual(storage.list_documents(self.root), [])
        self.assertEqual(list((self.root / "documents").rglob("*.fbd")), [])

    def test_legacy_migration_preserves_originals_and_is_idempotent(self):
        (self.root / "legacy.fbd").write_bytes(b"legacy")
        (self.root / "legacy.PRO").write_bytes(b"pro")
        (self.root / "images").mkdir()
        (self.root / "images/pic.TIF").write_bytes(b"asset")
        first = storage.list_documents(self.root)
        self.assertEqual(first, storage.list_documents(self.root))
        path, _, _ = storage.resolve(self.root, first[0]["id"])
        self.assertNotEqual(path.parent, self.root)
        self.assertEqual((path.parent / "images/pic.TIF").read_bytes(), b"asset")
        self.assertEqual((self.root / "legacy.fbd").read_bytes(), b"legacy")

    def test_word_save_is_idempotent_with_conversion_id(self):
        payload = self.payload({"Word 原名.fbd": b"one", "Word 原名.PRO": b"pro"})
        fixed = {"Word 原名.fbd": "a" * 32}
        first, _ = storage.publish(self.root, payload, fixed_ids=fixed)
        second, unchanged = storage.publish(self.root, payload, fixed_ids=fixed)
        self.assertTrue(unchanged)
        self.assertEqual(first, second)
        self.assertEqual(len(storage.list_documents(self.root)), 1)

    def test_concurrent_imports_do_not_lose_catalog_entries(self):
        payloads = [self.payload({f"{index}.fbd": str(index).encode()}) for index in range(5)]
        with ThreadPoolExecutor(max_workers=5) as executor:
            list(executor.map(lambda incoming: storage.publish(self.root, incoming), payloads))
        self.assertEqual(len(storage.list_documents(self.root)), 5)

    def test_image_cache_is_scoped_and_sees_new_nested_assets(self):
        first = self.payload({"images/1.TIF": b"one"})
        second = self.payload({"images/1.TIF": b"two"})
        self.assertEqual(render_html._image_index(str(first))["1.tif"][0], str(first / "images/1.TIF"))
        self.assertEqual(render_html._image_index(str(second))["1.tif"][0], str(second / "images/1.TIF"))
        (first / "images/2.TIF").write_bytes(b"new")
        self.assertIn("2.tif", render_html._image_index(str(first)))


class ImportApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 本测试只覆盖书版接口，不连接开发 MySQL 或改动真实用户会话。
        cls.user = SimpleNamespace(userid="alice")
        auth = types.ModuleType("auth")
        auth.get_current_user = lambda: cls.user
        models = types.ModuleType("users.models")
        models.User = SimpleNamespace
        with patch.dict("sys.modules", {"auth": auth, "users.models": models}):
            cls.router = importlib.import_module("shuban.router")
        app = FastAPI()
        app.include_router(cls.router.router)
        cls.client = TestClient(app)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.patch = patch.object(self.router, "UPLOAD_ROOT", self.root)
        self.patch.start()
        self.__class__.user = SimpleNamespace(userid="alice")

    def tearDown(self):
        self.patch.stop()
        self.temporary.cleanup()

    def upload(self, files, document_id=None):
        return self.client.post("/api/shuban/imports", files=[("files", (name, data)) for name, data in files],
                                data={"document_id": document_id} if document_id else {})

    @staticmethod
    def archive(files):
        result = io.BytesIO()
        with zipfile.ZipFile(result, "w") as package:
            for name, data in files.items():
                package.writestr(name, data)
        return result.getvalue()

    def test_zip_wrapper_and_nested_images_are_preserved(self):
        result = self.upload([("project.zip", self.archive({"folder/a.fbd": b"abc", "folder/images/a.TIF": b"image"}))])
        self.assertEqual(result.status_code, 200, result.text)
        document = result.json()["documents"][0]
        path, _, _ = storage.resolve(self.root / "alice", document["id"])
        self.assertEqual((path.parent / "images/a.TIF").read_bytes(), b"image")

    def test_bad_second_archive_does_not_publish_first(self):
        result = self.upload([("good.zip", self.archive({"a.fbd": b"good"})), ("bad.zip", b"broken")])
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.client.get("/api/shuban/files").json()["files"], [])

    def test_companion_without_owner_is_rejected(self):
        result = self.upload([("a.PRO", b"pro")])
        self.assertEqual(result.status_code, 400)

    def test_wrong_pro_does_not_update_selected_document(self):
        document = self.upload([("a.fbd", b"text")]).json()["documents"][0]
        result = self.upload([("wrong.PRO", b"pro")], document["id"])
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.client.get('/api/shuban/files').json()["files"][0]["version"], document["version"])

    def test_user_cannot_open_another_users_document(self):
        document = self.upload([("a.fbd", b"text")]).json()["documents"][0]
        self.__class__.user = SimpleNamespace(userid="bob")
        result = self.client.get(f'/api/shuban/files/{document["id"]}/report')
        self.assertEqual(result.status_code, 404)

    def test_pro_update_invalidates_analysis_and_preserves_other_document(self):
        document = self.upload([("a.fbd", b"text\xaa\xa4\xaa\xa6\xaa\xa6"), ("a.PRO", b"old")]).json()["documents"][0]
        url = f'/api/shuban/files/{document["id"]}/report'
        self.assertEqual(self.client.get(url).status_code, 200)
        before = self.router._analyze.cache_info().misses
        updated = self.upload([("a.PRO", b"new")], document["id"]).json()["documents"][0]
        self.assertNotEqual(document["version"], updated["version"])
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.router._analyze.cache_info().misses, before + 1)
        preview = self.client.get(f'/api/shuban/files/{document["id"]}/preview')
        self.assertEqual(preview.status_code, 200)
        self.assertIn('shuban-layout-state', preview.text)
        self.assertIn(document["id"], preview.text)


if __name__ == "__main__":
    unittest.main()
