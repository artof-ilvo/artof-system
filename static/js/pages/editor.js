import { byId } from '../lib/dom.js';

/** JSON text editor with line numbers, used for settings, implements, processes and addons. */
class JsonEditor {
    constructor(form) {
        this.textarea = byId('json-editor');
        this.lineNumbers = byId('line-numbers');
        this.lineNumbersContainer = byId('line-numbers-container');
        this.lineCount = 0;

        this.textarea.addEventListener('input', () => this.updateLineNumbers());
        this.textarea.addEventListener('scroll', () => this.syncScroll());
        byId('formatBtn').addEventListener('click', () => this.format());
        byId('back-button').addEventListener('click', () => window.history.back());
        form.addEventListener('submit', (event) => {
            if (!this.validate()) event.preventDefault();
        });

        this.format();
    }

    /** Parses the text; shows the error and returns null when it is not valid JSON. */
    parse() {
        try {
            return JSON.parse(this.textarea.value);
        } catch (error) {
            alert(`Invalid JSON: ${error.message}`);
            return null;
        }
    }

    validate() {
        return this.parse() !== null;
    }

    format() {
        const json = this.parse();
        if (json === null) return;
        this.textarea.value = JSON.stringify(json, null, 2);
        this.updateLineNumbers();
    }

    updateLineNumbers() {
        const count = this.textarea.value.split('\n').length;
        if (count !== this.lineCount) {
            this.lineCount = count;
            this.lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
        }
        this.syncScroll();
    }

    syncScroll() {
        this.lineNumbersContainer.scrollTop = this.textarea.scrollTop;
    }
}

new JsonEditor(byId('editor-form'));
