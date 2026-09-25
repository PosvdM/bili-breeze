const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');

// Load the same imports as the extension's classic service worker.
module.exports = sandbox => {
  const context = vm.isContext(sandbox) ? sandbox : vm.createContext(sandbox);
  const run = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
  context.importScripts = (...files) => files.forEach(run);
  run('background.js');
  return context;
};
