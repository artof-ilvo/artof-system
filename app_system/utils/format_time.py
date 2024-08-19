from datetime import datetime

def format_ms(duration: float):
    minutes: int = int(duration / 60000)
    hours: int = int(minutes / 60)
    minutes_after_ours: int = minutes % 60

    if hours > 0:
        return f"{hours}h {minutes_after_ours}m"
    else:
        return f"{minutes_after_ours}m"


def format_datetime(date: str):
    if date:
        d = datetime.strptime(date, "%Y-%m-%dT%H:%M:%S")
        return d.strftime("%d %B, %H:%M:%S")
    else:
        return ''
