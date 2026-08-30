import bcrypt
from sqlalchemy.orm import Session

from users.models import User


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def verify_password(plain: str, password_hash: str) -> bool:
    return bcrypt.checkpw(plain.encode(), password_hash.encode())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def get_users(
    db: Session,
    current: int = 1,
    page_size: int = 10,
    username: str | None = None,
    name: str | None = None,
) -> dict:
    """分页查询用户列表，支持用户名/姓名模糊过滤。返回 ProTable 约定的 {data, total, success}。"""
    query = db.query(User)
    if username:
        query = query.filter(User.username.contains(username))
    if name:
        query = query.filter(User.name.contains(name))
    total = query.count()
    offset = (current - 1) * page_size
    items = query.order_by(User.id.asc()).offset(offset).limit(page_size).all()
    return {"data": [_to_dict(u) for u in items], "total": total, "success": True}


def create_user(
    db: Session,
    username: str,
    password: str,
    name: str = "",
    email: str = "",
    phone: str = "",
    title: str = "",
    group_name: str = "",
    access: str = "user",
) -> User:
    # 业务 userid：现有数字 userid 最大值 +1，zfill(8) 补零
    numeric_userids = [
        int(uid) for (uid,) in db.query(User.userid).all() if uid and uid.isdigit()
    ]
    new_userid = str((max(numeric_userids) if numeric_userids else 0) + 1).zfill(8)
    user = User(
        username=username,
        password_hash=hash_password(password),
        name=name or username,
        userid=new_userid,
        email=email,
        phone=phone,
        title=title,
        group_name=group_name,
        access=access,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# 允许通过更新接口修改的字段白名单（不含 username / userid，两者创建后不可改）
UPDATABLE_FIELDS = (
    "name",
    "email",
    "phone",
    "title",
    "group_name",
    "signature",
    "country",
    "address",
    "avatar",
    "access",
)


def update_user(db: Session, user_id: int, **kwargs) -> User | None:
    user = get_user_by_id(db, user_id)
    if not user:
        return None
    if kwargs.get("password"):
        user.password_hash = hash_password(kwargs.pop("password"))
    else:
        kwargs.pop("password", None)
    for field, value in kwargs.items():
        if field in UPDATABLE_FIELDS and value is not None:
            setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


def delete_users(db: Session, user_ids: list[int]) -> int:
    count = (
        db.query(User)
        .filter(User.id.in_(user_ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return count


def _to_dict(user: User) -> dict:
    """转成前端 UserItem 结构（不暴露 password_hash；group_name → group）。"""
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "avatar": user.avatar or "",
        "userid": user.userid,
        "email": user.email or "",
        "phone": user.phone or "",
        "title": user.title or "",
        "group": user.group_name or "",
        "access": user.access,
        "signature": user.signature or "",
        "country": user.country or "",
        "address": user.address or "",
    }
