"""Seed the database with initial users.
Run: python seed.py
"""

import bcrypt
from database import engine, SessionLocal, Base
from users.models import User


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Seed users
    if db.query(User).count() == 0:
        admin = User(
            username="admin",
            password_hash=hash_password("ant.design"),
            name="Serati Ma",
            avatar="https://gw.alipayobjects.com/zos/antfincdn/XAosXuNZyF/BiazfanxmamNRoxxVxka.png",
            userid="00000001",
            email="antdesign@alipay.com",
            signature="海纳百川，有容乃大",
            title="交互专家",
            group_name="蚂蚁集团－某某某事业群－某某平台部－某某技术部－UED",
            tags='[{"key":"0","label":"很有想法的"},{"key":"1","label":"专注设计"},{"key":"2","label":"辣~"}]',
            notify_count=12,
            unread_count=11,
            country="China",
            access="admin",
            geographic='{"province":{"label":"浙江省","key":"330000"},"city":{"label":"杭州市","key":"330100"}}',
            address="西湖区工专路 77 号",
            phone="0752-268888888",
        )
        user = User(
            username="user",
            password_hash=hash_password("ant.design"),
            name="普通用户",
            avatar="https://gw.alipayobjects.com/zos/antfincdn/XAosXuNZyF/BiazfanxmamNRoxxVxka.png",
            userid="00000002",
            email="user@example.com",
            signature="",
            title="用户",
            group_name="",
            tags="[]",
            notify_count=0,
            unread_count=0,
            country="China",
            access="user",
            geographic="{}",
            address="",
            phone="",
        )
        db.add(admin)
        db.add(user)
        db.commit()
        print("Seeded 2 users (admin, user)")
    else:
        print("Users already exist, skipping")

    db.close()
    print("Done.")


if __name__ == "__main__":
    seed()
