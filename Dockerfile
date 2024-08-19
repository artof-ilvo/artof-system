# Use an official Python runtime as a parent image
FROM python:3.11

# Set environment variables
ENV ILVO_PATH=/var/lib/ilvo
ENV DEBUG=0
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DJANGO_SETTINGS_MODULE=ilvo.settings

# Set the working directory in the container
WORKDIR /app

ENV PORT=80

# Install dependencies
COPY requirements.txt /app/
# --no-cache-dir: don't cache the pip downloaded packages
RUN pip install -r requirements.txt 
RUN pip install gunicorn uvicorn websockets

# Copy the current directory contents into the container at /app/
COPY . /app/

# Expose port 8000 to allow communication to/from server
EXPOSE $PORT

# Run the Django server
CMD ["gunicorn", "-c", "gunicorn_conf.py" , "ilvo.asgi:application"]
