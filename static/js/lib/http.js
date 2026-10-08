// Small fetch wrappers that add the CSRF token and fail loudly on HTTP errors.

export function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content ?? '';
}

async function request(url, options) {
    const response = await fetch(url, {
        ...options,
        headers: { 'X-CSRFToken': csrfToken(), ...options.headers },
    });
    if (!response.ok) {
        throw new Error(`${options.method ?? 'GET'} ${url} failed: ${response.status} ${response.statusText}`);
    }
    return response;
}

export function get(url) {
    return request(url, { method: 'GET' });
}

export function postForm(url, formData) {
    return request(url, { method: 'POST', body: formData });
}

export async function postJSON(url, body) {
    const response = await request(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}
