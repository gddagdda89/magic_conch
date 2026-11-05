const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function validateRelease(source, previous) {
    const metadata = source.match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==/m);
    assert.ok(metadata, 'Missing userscript metadata');
    function field(name) {
        const matches = [...metadata[1].matchAll(new RegExp('^// @' + name + '\\s+(.+)$', 'gm'))];
        assert.equal(matches.length, 1, 'Expected one @' + name);
        return matches[0][1].trim();
}
const version = field('version');
assert.match(version, /^\d+\.\d+\.\d+$/, 'Use a three-part version');
assert.equal(field('name'), '神奇海螺');
assert.equal(field('author'), 'gddagdda89');
const installationUrl = 'https://gh-proxy.org/https://raw.githubusercontent.com/gddagdda89/magic_conch/refs/heads/main/pc.user.js';
assert.equal(field('updateURL'), installationUrl);
assert.equal(field('downloadURL'), installationUrl);
const matches = [...metadata[1].matchAll(/^\/\/ @match\s+(.+)$/gm)].map(match => match[1].trim()).sort();
assert.deepEqual(matches, ['https://jnftc.jnbank.com.cn/*', 'https://pc.kmelearning.com/*']);
assert.equal(field('grant'), 'none');
assert.ok(source.includes('【神奇海螺 v' + version + '】'), 'Startup version differs from metadata');
assert.ok(source.includes('>v' + version + '</span>'), 'HUD version differs from metadata');
assert.ok(source.trimEnd().endsWith('})();'), 'Incomplete script');
if (previous) {
    assert.match(previous, /^\d+\.\d+\.\d+$/);
    const currentParts = version.split('.').map(Number);
    const previousParts = previous.split('.').map(Number);
    const difference = currentParts.map((value, index) => value - previousParts[index]).find(value => value !== 0) || 0;
    assert.ok(difference > 0, 'Changed content requires a newer version than ' + previous);
}
return version;
}

module.exports = { validateRelease };
if (require.main === module) {
    const source = fs.readFileSync(path.join(__dirname, 'pc.js'), 'utf8');
    const userScriptSource = fs.readFileSync(path.join(__dirname, 'pc.user.js'), 'utf8');
    assert.equal(source, userScriptSource, 'pc.user.js must match pc.js');
    const previous = process.argv.find(value => value.startsWith('--previous-version='))?.split('=')[1];
    console.log('Release metadata, installation URL, and script completeness verified: v' + validateRelease(source, previous));
}
