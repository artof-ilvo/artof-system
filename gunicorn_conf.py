from os import getenv

# gunicorn_conf.py
bind = "0.0.0.0:%s" % getenv("PORT")
workers = 1
worker_class = "uvicorn.workers.UvicornWorker"