const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const RULE_HOSTS = /^https:\/\/(raw\.githubusercontent\.com|ghfast\.top)\//;

// Load the same imports as the extension's classic service worker.
// Bundled config files are read from disk. Remote rule hosts are unreachable unless the
// sandbox provides rulesFetch, so API fetch mocks and call counts are unaffected.
module.exports = sandbox => {
  const context = vm.isContext(sandbox) ? sandbox : vm.createContext(sandbox);
  const apiFetch = context.fetch;
  context.fetch = async (url, init) => {
    const href = String(url);
    const bundled = /^chrome-extension:\/\/[^/]+\/(config\/.+)$/.exec(href);
    if (bundled) return {ok: true, status: 200, text: async () => fs.readFileSync(path.join(root, bundled[1]), 'utf8')};
    if (RULE_HOSTS.test(href)) {
      if (context.rulesFetch) return context.rulesFetch(href, init);
      throw new TypeError('Failed to fetch');
    }
    return apiFetch(url, init);
  };
  const run = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
  context.importScripts = (...files) => files.forEach(run);
  run('background.js');
  return context;
};
