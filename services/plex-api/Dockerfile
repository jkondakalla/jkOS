FROM python:3.12-slim
WORKDIR /app
COPY services/plex-api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY jkos-deploy/jkos_auth.py .
COPY services/plex-api/ .
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
