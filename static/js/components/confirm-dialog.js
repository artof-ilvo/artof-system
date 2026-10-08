// Asks for confirmation before forms with `data-confirm="Question?"` are submitted,
// using the #confirm-dialog modal in the base templates.

export function initConfirmDialogs(root = document) {
    const dialog = document.getElementById('confirm-dialog');
    const message = dialog.querySelector('[data-confirm-message]');
    const confirmButton = dialog.querySelector('[data-confirm-accept]');
    const modal = bootstrap.Modal.getOrCreateInstance(dialog);
    let pendingForm = null;
    // The submit button, which may carry the form's value (name="name" value="...").
    let pendingSubmitter = null;

    root.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.confirm || form.dataset.confirmed) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        pendingForm = form;
        pendingSubmitter = event.submitter;
        message.textContent = form.dataset.confirm;
        confirmButton.textContent = form.dataset.confirmLabel ?? 'Delete';
        modal.show();
    }, true);

    confirmButton.addEventListener('click', () => {
        if (!pendingForm) return;
        const form = pendingForm;
        pendingForm = null;
        modal.hide();
        form.dataset.confirmed = 'true';
        form.requestSubmit(pendingSubmitter);
    });

    dialog.addEventListener('hidden.bs.modal', () => { pendingForm = null; });
}
