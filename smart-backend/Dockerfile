FROM python:3.13-slim

WORKDIR /app

# 依赖先行安装，充分利用镜像层缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY . .

EXPOSE 5000

# uvicorn 不带 --reload（容器内以稳定模式运行）；环境变量由 compose env_file 注入
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]
