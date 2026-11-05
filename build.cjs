const fs = require('node:fs');
const path = require('node:path');

const pkgPath = path.join(__dirname, 'package.json');
const srcDir = path.join(__dirname, 'src');
const outputFile = path.join(__dirname, 'pc.js');
const userScriptOutputFile = path.join(__dirname, 'pc.user.js');

function getPackageVersion() {
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.version) return pkg.version;
        } catch (_) {}
    }
    return null;
}

function syncVersion(version) {
    if (!version || !fs.existsSync(srcDir)) return;

    // 1. 同步 package.json
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.version !== version) {
                pkg.version = version;
                fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
            }
        } catch (_) {}
    }

    // 2. 同步 01-header.js
    const headerPath = path.join(srcDir, '01-header.js');
    if (fs.existsSync(headerPath)) {
        let content = fs.readFileSync(headerPath, 'utf8');
        content = content.replace(/(^\/\/\s*@version\s+)\S+/m, `$1${version}`);
        fs.writeFileSync(headerPath, content, 'utf8');
    }

    // 3. 同步 02-config.js
    const configPath = path.join(srcDir, '02-config.js');
    if (fs.existsSync(configPath)) {
        let content = fs.readFileSync(configPath, 'utf8');
        content = content.replace(/(const\s+SCRIPT_VERSION\s*=\s*')[^']+(';)/, `$1${version}$2`);
        content = content.replace(/(【神奇海螺\s*v)[^】]+(】)/, `$1${version}$2`);
        fs.writeFileSync(configPath, content, 'utf8');
    }

    // 4. 同步 11-hud.js
    const hudPath = path.join(srcDir, '11-hud.js');
    if (fs.existsSync(hudPath)) {
        let content = fs.readFileSync(hudPath, 'utf8');
        content = content.replace(/(id="jinpei-hud-version"[^>]*>v)[^<]+(<\/span>)/, `$1${version}$2`);
        fs.writeFileSync(hudPath, content, 'utf8');
    }

    // 5. 同步 18-main.js
    const mainPath = path.join(srcDir, '18-main.js');
    if (fs.existsSync(mainPath)) {
        let content = fs.readFileSync(mainPath, 'utf8');
        content = content.replace(/(脚本初始化\s+v)[0-9.]+(\s*[，,])/g, `$1${version}$2`);
        fs.writeFileSync(mainPath, content, 'utf8');
    }
}

function build(options = {}) {
    if (!fs.existsSync(srcDir)) {
        throw new Error(`Source directory not found: ${srcDir}`);
    }

    const version = options.version || getPackageVersion();
    if (version && !options.checkOnly) {
        syncVersion(version);
    }

    const headerPath = path.join(srcDir, '01-header.js');
    if (!fs.existsSync(headerPath)) {
        throw new Error(`Header file not found: ${headerPath}`);
    }
    const header = fs.readFileSync(headerPath, 'utf8').trim();

    const bodyFiles = fs.readdirSync(srcDir)
        .filter(f => f.endsWith('.js') && f !== '01-header.js')
        .sort();

    const bodyParts = bodyFiles.map(file => {
        const fullPath = path.join(srcDir, file);
        return fs.readFileSync(fullPath, 'utf8').trim();
    });

    const body = bodyParts.join('\n\n');

    const content = `${header}\n\n(function () {\n    'use strict';\n\n${body}\n\n})();\n`;
    return content;
}

if (require.main === module) {
    const isCheck = process.argv.includes('--check');
    const versionArg = process.argv.find(a => /^\d+\.\d+\.\d+$/.test(a) || a.startsWith('--set-version='));
    const explicitVersion = versionArg ? versionArg.replace('--set-version=', '') : null;

    if (explicitVersion) {
        syncVersion(explicitVersion);
    }

    const content = build({ checkOnly: isCheck });

    if (isCheck) {
        if (!fs.existsSync(outputFile)) {
            console.error('Error: pc.js does not exist. Run "npm run build".');
            process.exit(1);
        }
        if (!fs.existsSync(userScriptOutputFile)) {
            console.error('Error: pc.user.js does not exist. Run "npm run build".');
            process.exit(1);
        }
        const existing = fs.readFileSync(outputFile, 'utf8');
        const existingUserScript = fs.readFileSync(userScriptOutputFile, 'utf8');
        const normalizedContent = content.replace(/\r\n/g, '\n');
        if (existing.replace(/\r\n/g, '\n') !== normalizedContent) {
            console.error('Error: pc.js is out of date with src/. Run "npm run build" to update.');
            process.exit(1);
        }
        if (existingUserScript.replace(/\r\n/g, '\n') !== normalizedContent) {
            console.error('Error: pc.user.js is out of date with src/. Run "npm run build" to update.');
            process.exit(1);
        }
        console.log('Build check passed: pc.js and pc.user.js match src/ modules.');
    } else {
        fs.writeFileSync(outputFile, content, 'utf8');
        fs.writeFileSync(userScriptOutputFile, content, 'utf8');
        const ver = explicitVersion || getPackageVersion() || 'unknown';
        console.log(`Successfully built ${outputFile} and ${userScriptOutputFile} (v${ver}) from ${srcDir} (${fs.readdirSync(srcDir).length} modules).`);
    }
}

module.exports = { build, syncVersion, getPackageVersion };
