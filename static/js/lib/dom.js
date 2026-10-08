// DOM helpers shared by all pages (replaces jQuery).

export const byId = (id) => document.getElementById(id);

/** Reads data that the template rendered with Django's `json_script` filter. */
export function readJSON(id) {
    return JSON.parse(byId(id).textContent);
}

export function show(element, visible = true) {
    element.style.display = visible ? '' : 'none';
}

/** Toggles a Bootstrap button between its outline (off) and solid (on) look. */
export function setButtonActive(button, active, variant = 'secondary') {
    button.classList.toggle(`btn-${variant}`, active);
    button.classList.toggle(`btn-outline-${variant}`, !active);
}

export function hideCollapse(element) {
    bootstrap.Collapse.getOrCreateInstance(element, { toggle: false }).hide();
}

/** Value of the checked radio button in a group, or undefined. */
export function checkedValue(name, root = document) {
    return root.querySelector(`input[name="${CSS.escape(name)}"]:checked`)?.value;
}

/** Within `root`, opening one `.collapse` closes the others that are open. */
export function makeCollapsesExclusive(root = document) {
    root.addEventListener('show.bs.collapse', (event) => {
        for (const open of root.querySelectorAll('.collapse.show')) {
            // Only close siblings, not a parent of the collapse that is opening.
            if (open !== event.target && !open.contains(event.target)) {
                hideCollapse(open);
            }
        }
    });
}

/** Hides table rows whose text does not contain the search input's value. */
export function bindTableSearch(input, table) {
    input.addEventListener('input', () => {
        const filter = input.value.toLowerCase();
        for (const row of table.tBodies[0].rows) {
            show(row, row.textContent.toLowerCase().includes(filter));
        }
    });
}

/** Marks a button as busy (disabled, with a spinner) until `promise` settles; returns the promise. */
export async function withBusy(button, promise) {
    const wasDisabled = button.disabled;
    const spinner = document.createElement('span');
    spinner.className = 'spinner-border spinner-border-sm';
    spinner.setAttribute('aria-hidden', 'true');
    button.prepend(spinner);
    button.classList.add('is-busy');
    button.disabled = true;
    try {
        return await promise;
    } finally {
        spinner.remove();
        button.classList.remove('is-busy');
        button.disabled = wasDisabled;
    }
}

/** Keeps `element` sized so that it fills the window below the elements above it. */
export function fillWindowHeight(element, bottomMarginPx = 30) {
    const resize = () => {
        const top = element.getBoundingClientRect().top + window.scrollY;
        element.style.height = `${Math.max(window.innerHeight - top - bottomMarginPx, 200)}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return resize;
}
