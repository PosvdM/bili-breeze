// Rules (the prompt and default thresholds) are data files in config/<channel>/ of the GitHub repository.
// The extension bundles config/stable/ as the fallback and checks the repository once a day.
const PROMPT_LIMIT = 4000;
const RULE_FILES = {prompt: 'prompt.md', thresholds: 'thresholds.json'};
// Order matters: the proxy is used only when GitHub cannot be reached.
const RULE_SOURCES = [
  {host: 'raw.githubusercontent.com', base: 'https://raw.githubusercontent.com/PosvdM/bili-breeze/main/config/'},
  {host: 'ghfast.top', base: 'https://ghfast.top/https://raw.githubusercontent.com/PosvdM/bili-breeze/main/config/'}
];
const RULE_CHANNELS = ['stable', 'beta'];
const RULE_REFRESH = 86400000;
// After a failed check, wait before retrying so an unreachable host is not polled on every worker start.
const RULE_RETRY = 3600000;
const RULE_TIMEOUT = 5000;
const THRESHOLD_RANGES = {adThreshold: [1, 100], cautiousThreshold: [1, 100], ratioThreshold: [1, 100], ratioWindow: [2, 100]};

function parseRule(name, text) {
  if (name === 'prompt') {
    const prompt = String(text).trim();
    return prompt && prompt.length <= PROMPT_LIMIT ? prompt : null;
  }
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const thresholds = {};
  for (const [key, [min, max]] of Object.entries(THRESHOLD_RANGES)) {
    if (!Number.isInteger(data[key]) || data[key] < min || data[key] > max) return null;
    thresholds[key] = data[key];
  }
  return thresholds;
}
let bundledRules;
function loadBundledRules() {
  bundledRules ||= Promise.all(Object.entries(RULE_FILES).map(async ([name, file]) => {
    const response = await fetch(chrome.runtime.getURL('config/stable/' + file));
    const value = parseRule(name, await response.text());
    if (value === null) throw new Error('内置规则文件无效：' + file);
    return [name, value];
  })).then(Object.fromEntries);
  return bundledRules;
}
// A file missing from the beta channel falls back to stable. A 404 is an answer from the host,
// so it moves on to the next channel; network errors and other failures move on to the next host.
async function fetchRule(name, channels) {
  for (const source of RULE_SOURCES) {
    try {
      for (const channel of channels) {
        const response = await fetch(source.base + channel + '/' + RULE_FILES[name], {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(RULE_TIMEOUT)});
        if (response.status === 404) continue;
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const value = parseRule(name, await response.text());
        if (value === null) throw new Error('格式无效');
        return {value, host: source.host, channel};
      }
      return null;
    } catch {}
  }
  return null;
}
// remoteRules holds the cached files: {prompt: {value, host, channel}, thresholds: {...}}.
// ruleCheck holds {channel, checkedAt, attemptedAt, error}. It changes on every check, so it is kept
// apart from remoteRules, whose changes make pages re-evaluate their items.
async function readRules() {
  const [bundled, stored] = await Promise.all([loadBundledRules(), chrome.storage.local.get({ruleChannel: 'stable', remoteRules: null, ruleCheck: null})]);
  const channel = RULE_CHANNELS.includes(stored.ruleChannel) ? stored.ruleChannel : 'stable';
  const accepted = channel === 'beta' ? ['beta', 'stable'] : ['stable'];
  const check = stored.ruleCheck?.channel === channel ? stored.ruleCheck : null;
  const rules = {channel, checkedAt: check?.checkedAt || 0, error: check?.error || '', files: {}};
  for (const name of Object.keys(RULE_FILES)) {
    const saved = stored.remoteRules?.[name];
    // A cached file from the other channel is ignored after switching, and is re-validated on read.
    const usable = saved && accepted.includes(saved.channel) && parseRule(name, name === 'prompt' ? saved.value : JSON.stringify(saved.value)) !== null;
    rules.files[name] = usable ? saved : {value: bundled[name], host: '', channel: 'stable'};
  }
  rules.stale = !check || Date.now() - rules.checkedAt >= RULE_REFRESH && Date.now() - (check.attemptedAt || 0) >= RULE_RETRY;
  return rules;
}
let ruleRefresh = null;
function refreshRules(force = false) {
  ruleRefresh ||= (async () => {
    const current = await readRules();
    if (!force && !current.stale) return current;
    const channels = current.channel === 'beta' ? ['beta', 'stable'] : ['stable'];
    const names = Object.keys(RULE_FILES);
    const results = await Promise.all(names.map(name => fetchRule(name, channels)));
    const files = {};
    for (const [index, name] of names.entries()) {
      // Each file updates on its own; a failed file keeps the cached copy, or the bundled one.
      if (results[index]) files[name] = results[index];
      else if (current.files[name].host) files[name] = current.files[name];
    }
    const failures = results.filter(result => !result).length;
    const now = Date.now();
    const {remoteRules = null} = await chrome.storage.local.get({remoteRules: null});
    if (JSON.stringify(remoteRules || {}) !== JSON.stringify(files)) await chrome.storage.local.set({remoteRules: files});
    await chrome.storage.local.set({ruleCheck: {channel: current.channel, checkedAt: failures ? current.checkedAt : now, attemptedAt: now,
      error: !failures ? '' : (failures === names.length ? '无法获取远程规则' : '部分规则无法获取') + '，正在使用缓存或内置版本'}});
    const next = await readRules();
    await dropDefaultOverrides(next);
    return next;
  })().finally(() => { ruleRefresh = null; });
  return ruleRefresh;
}
// A stored value that equals the current default follows future defaults again.
async function dropDefaultOverrides(rules) {
  const keys = Object.keys(THRESHOLD_RANGES);
  const stored = await chrome.storage.local.get({...Object.fromEntries(keys.map(key => [key, null])), rulesPrompt: ''});
  const remove = keys.filter(key => stored[key] !== null && Number(stored[key]) === rules.files.thresholds.value[key]);
  if (String(stored.rulesPrompt).trim() === rules.files.prompt.value) remove.push('rulesPrompt');
  if (remove.length) await chrome.storage.local.remove(remove);
}
