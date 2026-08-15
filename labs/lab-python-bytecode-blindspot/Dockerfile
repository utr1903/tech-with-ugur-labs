FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ship the package with a precompiled __pycache__ whose bytecode
# diverges from the benign source — exactly the scenario under test.
RUN python build_pyc.py

CMD ["python", "run_scanners.py"]
