const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
// The key fixes the extension ID, so a newer ZIP replaces the installed copy and keeps its data.
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
assert(manifest.key,'manifest key is required for a stable extension ID');
const digest=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16);
const id=[...digest].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
assert.equal(id,'gphdadcpkkdikgdmjgmeappmdcfmdojf','extension ID must not change between releases');
assert.equal(JSON.parse(fs.readFileSync('package.json','utf8')).version,manifest.version,'package and manifest versions match');
console.log('PASS manifest: stable extension ID, matching versions');
