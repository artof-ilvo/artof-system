// Addon editor (system:edit_addon): form or JSON mode on the addon configuration (Name, AutoStart,
// DockerRegistry, DockerConfig) with a live view of the container and the equivalent `docker run`.
// Binds and Env stay Docker's strings ("host:container[:options]", "NAME=value") in the object.
import { byId, readJSON } from '../lib/dom.js';
import { initEditorModes } from '../components/editor-modes.js';
import { JsonEditor } from '../components/json-editor.js';

const DOCKER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;
const IMAGE_PLACEHOLDER = 'registryserver/image_name';

const form = byId('addon-form');
const formPane = byId('form-pane');
const json = new JsonEditor(byId('json-editor'), byId('line-numbers'), byId('line-numbers-container'));
const bindsList = byId('binds');
const envList = byId('env');

let addon;

// ----------------------------------------------------------------- Model

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fills in what the form needs without dropping keys it does not know (e.g. Cmd, Labels). */
function normalise(data) {
    const result = isObject(data) ? data : {};
    result.Name ??= '';
    result.AutoStart = result.AutoStart !== false;
    result.DockerRegistry = isObject(result.DockerRegistry) ? result.DockerRegistry : {};
    result.DockerConfig = isObject(result.DockerConfig) ? result.DockerConfig : {};
    const config = result.DockerConfig;
    config.Image ??= '';
    config.HostConfig = isObject(config.HostConfig) ? config.HostConfig : {};
    config.HostConfig.Binds = Array.isArray(config.HostConfig.Binds) ? config.HostConfig.Binds : [];
    config.HostConfig.RestartPolicy = isObject(config.HostConfig.RestartPolicy) ? config.HostConfig.RestartPolicy : { Name: 'no' };
    return result;
}

function parseBind(bind) {
    const [host = '', container = '', ...options] = String(bind).split(':');
    return { host, container, options: options.join(':').split(',').filter(Boolean) };
}

function formatBind({ host, container, options }) {
    return [host, container, ...(options.length ? [options.join(',')] : [])].join(':');
}

function parseEnv(entry) {
    const text = String(entry);
    const index = text.indexOf('=');
    return index < 0 ? { name: text, value: '' } : { name: text.slice(0, index), value: text.slice(index + 1) };
}

// ------------------------------------------------------------------ Form

function render() {
    const config = addon.DockerConfig;
    const host = config.HostConfig;
    byId('addon-name').value = addon.Name;
    byId('addon-autostart').checked = addon.AutoStart;
    byId('addon-image').value = config.Image;
    showSelect(byId('addon-network'), host.NetworkMode ?? 'host');
    showSelect(byId('addon-restart'), host.RestartPolicy.Name ?? 'no');
    byId('addon-retries').value = host.RestartPolicy.MaximumRetryCount ?? '';
    byId('addon-registry').value = addon.DockerRegistry.serveraddress ?? '';
    byId('addon-username').value = addon.DockerRegistry.username ?? '';
    byId('addon-password').value = addon.DockerRegistry.password ?? '';
    renderRows(bindsList, 'bind-template', host.Binds.map(parseBind), (row, bind) => {
        row.querySelector('[data-field="host"]').value = bind.host;
        row.querySelector('[data-field="container"]').value = bind.container;
        row.querySelector('[data-field="readonly"]').checked = bind.options.includes('ro');
        row.dataset.options = bind.options.filter((option) => option !== 'ro' && option !== 'rw').join(',');
    });
    renderRows(envList, 'env-template', (config.Env ?? []).map(parseEnv), (row, env) => {
        row.querySelector('[data-field="name"]').value = env.name;
        row.querySelector('[data-field="value"]').value = env.value;
    });
    updateTitle();
    updateRetries();
}

/** Selects `value`, adding it as an option when the select does not list it. */
function showSelect(select, value) {
    if (![...select.options].some((option) => option.value === value)) select.add(new Option(value, value));
    select.value = value;
}

let rowUid = 0;
function renderRows(list, templateId, items, fill) {
    const template = byId(templateId);
    list.replaceChildren(...items.map((item) => {
        const row = template.content.firstElementChild.cloneNode(true);
        for (const input of row.querySelectorAll('[data-field]')) {
            input.id = `row-${++rowUid}`;
            const label = input.parentElement.querySelector('label');
            if (label) label.htmlFor = input.id;
        }
        fill(row, item);
        return row;
    }));
}

/** Reads the rows back into Binds / Env. */
function readRows() {
    const config = addon.DockerConfig;
    config.HostConfig.Binds = [...bindsList.querySelectorAll('[data-row]')].map((row) => {
        const options = (row.dataset.options ?? '').split(',').filter(Boolean);
        if (row.querySelector('[data-field="readonly"]').checked) options.unshift('ro');
        return formatBind({
            host: row.querySelector('[data-field="host"]').value.trim(),
            container: row.querySelector('[data-field="container"]').value.trim(),
            options,
        });
    });
    const env = [...envList.querySelectorAll('[data-row]')].map((row) =>
        `${row.querySelector('[data-field="name"]').value.trim()}=${row.querySelector('[data-field="value"]').value}`);
    if (env.length) config.Env = env;
    else delete config.Env;
}

function readForm() {
    const config = addon.DockerConfig;
    const host = config.HostConfig;
    addon.Name = byId('addon-name').value.trim();
    addon.AutoStart = byId('addon-autostart').checked;
    config.Image = byId('addon-image').value.trim();
    host.NetworkMode = byId('addon-network').value;
    host.RestartPolicy.Name = byId('addon-restart').value;
    const retries = parseInt(byId('addon-retries').value, 10);
    if (host.RestartPolicy.Name === 'on-failure' && Number.isFinite(retries)) host.RestartPolicy.MaximumRetryCount = retries;
    else delete host.RestartPolicy.MaximumRetryCount;

    // Only send a login when there is one: Docker gets an (empty) login whenever the keys exist.
    const registry = addon.DockerRegistry;
    const server = byId('addon-registry').value.trim();
    if (server) registry.serveraddress = server; else delete registry.serveraddress;
    const username = byId('addon-username').value.trim();
    const password = byId('addon-password').value;
    if (username || password) {
        registry.username = username;
        registry.password = password;
    } else {
        delete registry.username;
        delete registry.password;
    }
    readRows();
}

function updateTitle() {
    byId('addon-title').textContent = addon.Name || 'New addon';
}

function updateRetries() {
    byId('addon-retries-field').hidden = byId('addon-restart').value !== 'on-failure';
}

formPane.addEventListener('input', (event) => {
    event.target.classList.remove('is-invalid');
    readForm();
    updateTitle();
    updateRetries();
    drawPreview();
});

formPane.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    remove.closest('[data-row]').remove();
    readForm();
    drawPreview();
});

function addRow(list, templateId, fill) {
    readForm();
    const rows = [...list.children];
    renderRows(list, templateId, [{}], fill);
    list.prepend(...rows);
    list.lastElementChild.querySelector('input')?.focus();
}

byId('add-bind').addEventListener('click', () => {
    addRow(bindsList, 'bind-template', (row) => { row.dataset.options = ''; });
});
byId('add-env').addEventListener('click', () => addRow(envList, 'env-template', () => {}));

/** Marks what the system manager cannot use; returns whether everything is valid. */
function validateForm() {
    readForm();
    let valid = true;
    const mark = (input, invalid) => {
        input.classList.toggle('is-invalid', invalid);
        if (invalid) valid = false;
    };
    const name = byId('addon-name');
    if (!name.readOnly) mark(name, !DOCKER_NAME.test(addon.Name));
    const image = addon.DockerConfig.Image;
    mark(byId('addon-image'), !image || /\s/.test(image) || image === IMAGE_PLACEHOLDER);
    for (const row of bindsList.querySelectorAll('[data-row]')) {
        mark(row.querySelector('[data-field="host"]'), !row.querySelector('[data-field="host"]').value.trim().startsWith('/'));
        mark(row.querySelector('[data-field="container"]'), !row.querySelector('[data-field="container"]').value.trim().startsWith('/'));
    }
    for (const row of envList.querySelectorAll('[data-row]')) {
        const input = row.querySelector('[data-field="name"]');
        mark(input, !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.value.trim()));
    }
    return valid;
}

// ---------------------------------------------------------------- Preview

function shellQuote(text) {
    return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${String(text).replaceAll("'", "'\\''")}'`;
}

function dockerRunCommand(value) {
    const config = value.DockerConfig ?? {};
    const host = config.HostConfig ?? {};
    const parts = ['docker run -d'];
    if (value.Name) parts.push(`--name ${shellQuote(value.Name)}`);
    if (host.NetworkMode) parts.push(`--network ${shellQuote(host.NetworkMode)}`);
    const restart = host.RestartPolicy?.Name;
    if (restart && restart !== 'no') {
        const retries = host.RestartPolicy.MaximumRetryCount;
        parts.push(`--restart ${restart}${restart === 'on-failure' && retries ? `:${retries}` : ''}`);
    }
    for (const bind of host.Binds ?? []) parts.push(`-v ${shellQuote(bind)}`);
    for (const env of config.Env ?? []) parts.push(`-e ${shellQuote(env)}`);
    parts.push(config.Image ? shellQuote(config.Image) : '<image>');
    if (Array.isArray(config.Cmd)) parts.push(...config.Cmd.map(shellQuote));
    return parts.join(' \\\n    ');
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Robot (host) and container side by side, with the shared folders between them. */
function drawDiagram(value) {
    const config = value.DockerConfig ?? {};
    const host = config.HostConfig ?? {};
    const diagram = byId('addon-diagram');
    diagram.replaceChildren();

    const header = element('div', 'addon-diagram-row addon-diagram-head');
    header.append(element('div', 'addon-diagram-cell', 'Robot'), element('div', 'addon-diagram-arrow'),
        element('div', 'addon-diagram-cell', `Container ${value.Name || '…'}`));
    diagram.append(header);

    const binds = (host.Binds ?? []).map(parseBind);
    if (!binds.length) diagram.append(element('div', 'addon-diagram-empty', 'No shared folders: the addon cannot read fields or settings.'));
    for (const bind of binds) {
        const row = element('div', 'addon-diagram-row');
        const arrow = element('div', 'addon-diagram-arrow', bind.options.includes('ro') ? '→ ro' : '⇄');
        arrow.title = bind.options.includes('ro') ? 'read-only in the container' : 'read and write';
        row.append(element('div', 'addon-diagram-cell font-monospace', bind.host || '?'), arrow,
            element('div', 'addon-diagram-cell font-monospace', bind.container || '?'));
        diagram.append(row);
    }

    const facts = element('div', 'addon-diagram-facts');
    const restart = host.RestartPolicy?.Name ?? 'no';
    const retries = host.RestartPolicy?.MaximumRetryCount;
    for (const [label, text] of [
        ['image', config.Image || '—'],
        ['network', host.NetworkMode ?? 'default (bridge)'],
        ['restart', restart === 'on-failure' && retries ? `${restart} (max ${retries})` : restart],
        ['env', `${(config.Env ?? []).length} variable${(config.Env ?? []).length === 1 ? '' : 's'}`],
        ['autostart', value.AutoStart === false ? 'no' : 'yes'],
    ]) {
        const fact = element('span', 'addon-fact');
        fact.append(element('span', 'addon-fact-label', label), element('span', 'font-monospace', text));
        facts.append(fact);
    }
    diagram.append(facts);
}

function drawPreview(value = addon) {
    drawDiagram(value);
    byId('addon-command').textContent = dockerRunCommand(value);
}

// ------------------------------------------------------------------- Start

addon = normalise(readJSON('addon_data'));
render();
drawPreview();

initEditorModes({
    form,
    json,
    dataInput: byId('addon-data'),
    storageKey: 'addon-editor-mode',
    rawJson: readJSON('raw_json'),
    getValue: () => {
        if (!formPane.hidden) readForm();
        return addon;
    },
    setValue: (value) => {
        addon = normalise(value);
        render();
        drawPreview();
    },
    previewJson: (value) => drawPreview(normalise(structuredClone(value))),
    validateForm,
});
