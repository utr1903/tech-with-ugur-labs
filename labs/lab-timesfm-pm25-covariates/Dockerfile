FROM python:3.12-slim

WORKDIR /app

# CPU-only torch: the default index would pull ~2.5 GB of CUDA libraries
# that this lab never touches.
COPY requirements.txt .
RUN pip install --no-cache-dir \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt

COPY . .

CMD ["python", "main.py", "run"]
