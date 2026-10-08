// JSON WebSocket that reconnects with exponential backoff.
// Replaces the unmaintained reconnecting-websocket 1.0.0 library.

export class LiveSocket {
    /**
     * @param {string} path  Server path, e.g. "/ws/status/".
     * @param {(data: any) => void} onMessage  Called with every parsed JSON message.
     */
    constructor(path, onMessage, { minDelayMs = 500, maxDelayMs = 10000 } = {}) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.url = `${protocol}//${window.location.host}${path}`;
        this.onMessage = onMessage;
        this.minDelayMs = minDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.delayMs = minDelayMs;
        this.closed = false;
        this.socket = null;
        this.connect();
    }

    connect() {
        this.socket = new WebSocket(this.url);

        this.socket.addEventListener('open', () => {
            this.delayMs = this.minDelayMs;
        });

        this.socket.addEventListener('message', (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (error) {
                console.error(`Invalid JSON from ${this.url}`, error);
                return;
            }
            this.onMessage(data);
        });

        this.socket.addEventListener('close', () => {
            if (this.closed) return;
            setTimeout(() => this.connect(), this.delayMs);
            this.delayMs = Math.min(this.delayMs * 2, this.maxDelayMs);
        });
    }

    /** Sends an object as JSON. Messages sent while disconnected are dropped. */
    send(data) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        }
    }

    close() {
        this.closed = true;
        this.socket?.close();
    }
}
