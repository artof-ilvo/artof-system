import { byId } from '../lib/dom.js';
import { JsonEditor } from '../components/json-editor.js';

// JSON editor page for settings, processes and addons.
const form = byId('editor-form');
const editor = new JsonEditor(byId('json-editor'), byId('line-numbers'), byId('line-numbers-container'));

byId('formatBtn').addEventListener('click', () => editor.format());
byId('back-button').addEventListener('click', () => window.history.back());
form.addEventListener('submit', (event) => {
    if (!editor.validate()) event.preventDefault();
});

editor.format();
