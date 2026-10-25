"""按文档保存不可变文件版本，以原子清单发布整批导入结果。"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

FILE_EXTENSIONS = {
    ".fbd", ".pro", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".tif", ".tiff", ".bmp", ".eps", ".ps",
}
_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


@contextmanager
def _catalog_lock(root: Path):
    """线程锁与操作系统文件锁同时覆盖不同 Uvicorn worker。"""
    root.mkdir(parents=True, exist_ok=True)
    with _locks_guard:
        lock = _locks.setdefault(str(root.resolve()), threading.RLock())
    with lock, (root / ".catalog.lock").open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _read_catalog(root: Path) -> dict:
    path = root / "catalog.json"
    if not path.exists():
        return {"schemaVersion": 1, "documents": {}}
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
        if result.get("schemaVersion") != 1 or not isinstance(result.get("documents"), dict):
            raise ValueError("unsupported catalog")
        return result
    except (OSError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=500, detail="书版文件清单无法读取，请恢复清单备份") from exc


def _write_catalog(root: Path, catalog: dict) -> None:
    temporary = root / f".catalog-{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(catalog, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, root / "catalog.json")
    finally:
        temporary.unlink(missing_ok=True)


def _files(root: Path) -> list[Path]:
    result = []
    for directory, directories, names in os.walk(root):
        for name in directories:
            if (Path(directory) / name).is_symlink():
                raise HTTPException(status_code=400, detail="文档素材不能使用符号链接")
        for name in names:
            path = Path(directory) / name
            if path.suffix.lower() not in FILE_EXTENSIONS:
                continue
            if path.is_symlink() or root.resolve() not in path.resolve().parents:
                raise HTTPException(status_code=400, detail="文档素材路径超出文档目录")
            result.append(path)
    return sorted(result, key=lambda item: item.relative_to(root).as_posix().casefold())


def _digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in _files(root):
        digest.update(path.relative_to(root).as_posix().encode("utf-8") + b"\0")
        digest.update(str(path.stat().st_size).encode("ascii") + b"\0")
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def version(root: Path, metadata: dict) -> str:
    """涵盖所有配套文件的状态，也识别在磁盘上手动修改的 PRO/图片。"""
    digest = hashlib.sha256(metadata["revision"].encode("ascii"))
    for path in _files(root):
        stat = path.stat()
        digest.update(f"{path.relative_to(root).as_posix()}:{stat.st_mtime_ns}:{stat.st_size}\0".encode("utf-8"))
    return digest.hexdigest()


def _directory(root: Path, metadata: dict) -> Path:
    path = (root / metadata["storagePath"]).resolve()
    if (root / "documents").resolve() not in path.parents or not path.is_dir():
        raise HTTPException(status_code=404, detail="文档版本不存在")
    return path


def _public(root: Path, metadata: dict) -> dict:
    directory = _directory(root, metadata)
    path = directory / metadata["name"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="FBD 文件不存在")
    return {
        "id": metadata["id"], "name": metadata["name"], "size": path.stat().st_size,
        "updatedAt": metadata["updatedAt"], "version": version(directory, metadata),
    }


def list_documents(root: Path) -> list[dict]:
    migrate_legacy(root)
    return [_public(root, metadata) for metadata in _read_catalog(root)["documents"].values()]


def resolve(root: Path, key: str) -> tuple[Path, dict, str]:
    migrate_legacy(root)
    documents = _read_catalog(root)["documents"]
    metadata = documents.get(key)
    if metadata is None:
        matches = [item for item in documents.values() if item["name"].casefold() == key.casefold()]
        if len(matches) > 1:
            raise HTTPException(status_code=409, detail="存在多个同名文档，请从文件清单按文档 ID 打开")
        if not matches:
            raise HTTPException(status_code=404, detail="FBD 文件不存在")
        metadata = matches[0]
    directory = _directory(root, metadata)
    return directory / metadata["name"], metadata, version(directory, metadata)


def publish(root: Path, incoming: Path, target_id: str | None = None,
            fixed_ids: dict[str, str] | None = None) -> tuple[list[dict], bool]:
    """先准备完整版本，再一次性替换清单；任何异常都不发布部分文档。"""
    inputs = _files(incoming)
    fbd_files = [path for path in inputs if path.suffix.lower() == ".fbd"]
    if any(path.parent != incoming for path in fbd_files):
        raise HTTPException(status_code=400, detail="FBD 文件必须位于导入目录根部")
    if not fbd_files and not target_id:
        raise HTTPException(status_code=400, detail="请选择 FBD 及配套文件，或指定需要补充素材的文档")
    if not inputs:
        raise HTTPException(status_code=400, detail="没有可导入的书版文件")
    if target_id and len(fbd_files) > 1:
        raise HTTPException(status_code=400, detail="更新一份文档时只能包含一个 FBD")

    with _catalog_lock(root):
        catalog = _read_catalog(root)
        documents = catalog["documents"]
        existing = documents.get(target_id) if target_id else None
        if target_id and not existing:
            raise HTTPException(status_code=404, detail="需要更新的文档不存在")
        if existing and fbd_files and fbd_files[0].name.casefold() != existing["name"].casefold():
            raise HTTPException(status_code=400, detail="更新文档的 FBD 文件名与选中文档不一致")
        if existing and any(path.suffix.lower() == ".pro" and path.stem.casefold() != Path(existing["name"]).stem.casefold()
                            for path in inputs):
            raise HTTPException(status_code=400, detail="配套 PRO 文件应与选中文档的 FBD 同名")
        stage = Path(tempfile.mkdtemp(prefix=".publish-", dir=root))
        published: list[Path] = []
        result_ids: list[str] = []
        changed = False
        try:
            for fbd in (fbd_files or [None]):
                name = existing["name"] if existing else fbd.name
                doc_id = target_id or (fixed_ids or {}).get(name) or uuid.uuid4().hex
                # 同一次 Word 转换和历史迁移可重复提交，不能生成重复记录。
                if fixed_ids and doc_id in documents:
                    result_ids.append(doc_id)
                    continue
                candidate = stage / doc_id
                if existing:
                    shutil.copytree(_directory(root, existing), candidate)
                else:
                    candidate.mkdir()
                destinations = {path.relative_to(candidate).as_posix().casefold(): path for path in _files(candidate)}
                for source in inputs:
                    if source.suffix.lower() == ".fbd" and source != fbd:
                        continue
                    if source.suffix.lower() == ".pro" and source.stem.casefold() != Path(name).stem.casefold():
                        continue
                    relative = source.relative_to(incoming)
                    destination = candidate / relative
                    # 与 Windows 一致，按忽略大小写的路径更新素材，避免 Linux 上重复。
                    previous = destinations.get(relative.as_posix().casefold())
                    if previous is not None:
                        destination = previous
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)
                    destinations[relative.as_posix().casefold()] = destination
                revision = _digest(candidate)
                if existing and revision == _digest(_directory(root, existing)):
                    result_ids.append(doc_id)
                    continue
                relative_directory = Path("documents") / doc_id / uuid.uuid4().hex
                destination = root / relative_directory
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(candidate, destination)
                published.append(destination)
                documents[doc_id] = {
                    "id": doc_id, "name": name, "revision": revision,
                    "storagePath": relative_directory.as_posix(), "updatedAt": time.time(),
                }
                result_ids.append(doc_id)
                changed = True
            # 所有版本都已准备好后再发布，读者只能看见更新前或更新后的完整清单。
            public_result = [_public(root, documents[key]) for key in result_ids]
            if changed:
                _write_catalog(root, catalog)
        except Exception:
            for path in reversed(published):
                shutil.rmtree(path, ignore_errors=True)
            raise
        finally:
            shutil.rmtree(stage, ignore_errors=True)
        return public_result, not changed


def migrate_legacy(root: Path) -> None:
    """为原用户根目录文件建立独立快照；不删除或改写历史文件。"""
    documents = _read_catalog(root)["documents"]
    legacy = [path for path in root.iterdir() if path.is_file() and path.suffix.lower() == ".fbd"]
    ids = {path.name: uuid.uuid5(uuid.NAMESPACE_URL, "shuban-legacy:" + path.name.casefold()).hex for path in legacy}
    pending = [path for path in legacy if ids[path.name] not in documents]
    if not pending:
        return
    stage = Path(tempfile.mkdtemp(prefix=".legacy-", dir=root))
    try:
        for path in pending:
            shutil.copy2(path, stage / path.name)
        for directory, directories, names in os.walk(root):
            directories[:] = [name for name in directories if name not in {"documents", "word-conversions"}
                              and not name.startswith(".") and not (Path(directory) / name).is_symlink()]
            for name in names:
                source = Path(directory) / name
                if source.is_symlink() or source.suffix.lower() not in FILE_EXTENSIONS - {".fbd"}:
                    continue
                destination = stage / source.relative_to(root)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        publish(root, stage, fixed_ids=ids)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
