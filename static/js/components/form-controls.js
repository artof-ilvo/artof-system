// Behaviour for the reusable form components in templates/components/,
// wired up through data attributes instead of one inline script per instance.

/**
 * `<div data-stepper>` with `<button data-step="-1|1">` and a number input:
 * the buttons change the input by its `step`, clamped to `min`/`max`,
 * and fire a `change` event like a user edit would.
 */
function initStepper(container) {
    const input = container.querySelector('input[type="number"]');
    const decimals = Number(input.dataset.decimals ?? 0);

    for (const button of container.querySelectorAll('[data-step]')) {
        button.addEventListener('click', () => {
            const step = Number(input.step) || 1;
            let value = (parseFloat(input.value) || 0) + Number(button.dataset.step) * step;
            if (input.min !== '') value = Math.max(value, Number(input.min));
            if (input.max !== '') value = Math.min(value, Number(input.max));
            input.value = value.toFixed(decimals);
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
}

/** `<input type="range" data-label="id">` shows its value in the element with that id. */
function initRangeLabel(input) {
    const label = document.getElementById(input.dataset.label);
    input.addEventListener('input', () => { label.textContent = input.value; });
}

/** `<input data-autosubmit>` submits its form when changed. */
function initAutoSubmit(input) {
    input.addEventListener('change', () => input.form.requestSubmit());
}

/**
 * Forms with `data-busy` that navigate away (full page submit) show a spinner on the
 * button that submitted them until the next page loads.
 */
function initBusyForms(root) {
    root.addEventListener('submit', (event) => {
        const form = event.target;
        if (event.defaultPrevented || !form.matches('form[data-busy]')) return;
        const button = event.submitter ?? form.querySelector('[type="submit"]');
        if (!button) return;
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm';
        spinner.dataset.busySpinner = '';
        button.prepend(spinner);
        button.classList.add('is-busy');
    });
    // Coming back with the browser's back button restores the page as it was: drop the spinners.
    window.addEventListener('pageshow', () => {
        root.querySelectorAll('[data-busy-spinner]').forEach((spinner) => {
            spinner.parentElement.classList.remove('is-busy');
            spinner.remove();
        });
    });
}

export function initFormControls(root = document) {
    root.querySelectorAll('[data-stepper]').forEach(initStepper);
    root.querySelectorAll('input[type="range"][data-label]').forEach(initRangeLabel);
    root.querySelectorAll('[data-autosubmit]').forEach(initAutoSubmit);
    initBusyForms(root);
}
