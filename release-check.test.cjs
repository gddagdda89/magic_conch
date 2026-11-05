const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { validateRelease } = require('./release-check.cjs');
const source = fs.readFileSync(path.join(__dirname, 'pc.js'), 'utf8');

test('发布检查拒绝相同版本或回退版本的新内容', () => {
    const version = validateRelease(source);
    assert.throws(() => validateRelease(source, version), /requires a newer version/);
    assert.throws(() => validateRelease(source, '9999.0.0'), /requires a newer version/);
});
test('发布检查拒绝指向其他仓库的安装地址', () => {
    assert.throws(() => validateRelease(source.replaceAll('/magic_conch/', '/wrong-repository/')));
});
test('发布检查拒绝 HUD 版本不一致和截断脚本', () => {
    assert.throws(() => validateRelease(source.replace(/>v\d+\.\d+\.\d+<\/span>/, '>v0.0.0</span>')), /HUD version/);
    assert.throws(() => validateRelease(source.trimEnd().slice(0, -5)), /Incomplete script/);
});
