/** JSON text editor with line numbers (`.code-editor` markup), used for settings, implements, processes and addons. */
export class JsonEditor {
    /**
     * @param {HTMLTextAreaElement} textarea
     * @param {HTMLElement} lineNumbers element that receives the numbers
     * @param {HTMLElement} gutter scroll container of the line numbers
     */
    constructor(textarea, lineNumbers, gutter) {
        this.textarea = textarea;
        this.lineNumbers = lineNumbers;
        this.gutter = gutter;
        this.lineCount = 0;

        this.textarea.addEventListener('input', () => this.updateLineNumbers());
        this.textarea.addEventListener('scroll', () => this.syncScroll());
    }

    getValue() {
        return this.textarea.value;
    }

    setValue(text) {
        this.textarea.value = text;
        this.updateLineNumbers();
    }

    /** Returns `{ value }` for valid JSON, `{ error }` otherwise. */
    tryParse() {
        try {
            return { value: JSON.parse(this.textarea.value) };
        } catch (error) {
            return { error };
        }
    }

    /** Parses the text; shows the error and returns null when it is not valid JSON. */
    parse() {
        const { value, error } = this.tryParse();
        if (error) {
            alert(`Invalid JSON: ${error.message}`);
            return null;
        }
        return value;
    }

    validate() {
        return this.parse() !== null;
    }

    format() {
        const json = this.parse();
        if (json === null) return;
        this.setValue(JSON.stringify(json, null, 2));
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
        this.gutter.scrollTop = this.textarea.scrollTop;
    }
}
