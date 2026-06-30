FROM python:3.12-slim
WORKDIR /app
COPY services/recipe-api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY jkos-deploy/jkos_auth.py .
COPY services/recipe-api/ .
EXPOSE 8002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
