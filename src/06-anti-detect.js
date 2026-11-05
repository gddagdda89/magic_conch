    // [防检测 1: 拟人随机数与时间抖动发生器 Human Jitter]
    function randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // [防检测 2: 拟人化真实坐标与鼠标事件链点击 Simulated Human Click]
    function simulateHumanClick(el) {
        if (!el) return;
        try {
            const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
            let x = 0, y = 0;
            if (rect && rect.width > 0 && rect.height > 0) {
                const rx = 0.25 + 0.5 * Math.random();
                const ry = 0.25 + 0.5 * Math.random();
                x = Math.round(rect.left + rect.width * rx);
                y = Math.round(rect.top + rect.height * ry);
            } else if (typeof window !== 'undefined') {
                x = Math.round((window.innerWidth || 1024) / 2 + (Math.random() * 40 - 20));
                y = Math.round((window.innerHeight || 768) / 2 + (Math.random() * 40 - 20));
            }

            const commonProps = {
                bubbles: true,
                cancelable: true,
                view: typeof window !== 'undefined' ? window : null,
                clientX: x,
                clientY: y,
                screenX: x + 10,
                screenY: y + 10,
            };

            if (typeof MouseEvent === 'function' && typeof el.dispatchEvent === 'function') {
                el.dispatchEvent(new MouseEvent('mouseover', commonProps));
                el.dispatchEvent(new MouseEvent('mousemove', commonProps));
                el.dispatchEvent(new MouseEvent('mousedown', { ...commonProps, buttons: 1, button: 0 }));
                el.dispatchEvent(new MouseEvent('mouseup', { ...commonProps, buttons: 0, button: 0 }));
                el.dispatchEvent(new MouseEvent('click', { ...commonProps, buttons: 0, button: 0 }));
                // 已派发一次 click，不能再调用 .click()；即使默认行为被取消也不重复点击。
                return;
            }
        } catch (_) {}

        if (typeof el.click === 'function') {
            el.click();
        }
    }

    // [防检测 3: 原生函数伪装与特征隐藏 Native Function Masquerade]
    const nativeFnToString = Function.prototype.toString;
    const hookedFunctions = new WeakMap();

    function makeNativeFunction(fn, original, name) {
        if (typeof fn !== 'function') return fn;
        const fnName = name || original?.name || fn.name || '';
        const nativeString = `function ${fnName}() { [native code] }`;
        hookedFunctions.set(fn, nativeString);
        try {
            Object.defineProperty(fn, 'name', { value: fnName, configurable: true });
            Object.defineProperty(fn, 'length', { value: original ? original.length : fn.length, configurable: true });
            const toStringFn = function toString() {
                if (this === fn || this === toStringFn) return nativeString;
                return nativeFnToString.call(this);
            };
            hookedFunctions.set(toStringFn, `function toString() { [native code] }`);
            Object.defineProperty(fn, 'toString', { value: toStringFn, writable: true, configurable: true });
        } catch (_) {}
        return fn;
    }

    try {
        const patchedToString = function toString() {
            if (hookedFunctions.has(this)) return hookedFunctions.get(this);
            return nativeFnToString.call(this);
        };
        hookedFunctions.set(patchedToString, `function toString() { [native code] }`);
        Object.defineProperty(Function.prototype, 'toString', {
            value: patchedToString,
            writable: true,
            configurable: true,
        });
    } catch (_) {}

    // [防检测 4: 跨标签 Web Locks 与存储特征脱敏隐藏]
    function enableLockStealth() {
        if (typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.query !== 'function') return;
        if (navigator.locks.query.__isStealth) return;
        const origQuery = navigator.locks.query.bind(navigator.locks);
        const stealthQuery = makeNativeFunction(async function query(options) {
            const result = await origQuery();
            if (options?.__internal) return result;
            return {
                held: (result.held || []).filter(l => !l.name?.startsWith('_kme_') && !l.name?.startsWith('jinpei_')),
                pending: (result.pending || []).filter(l => !l.name?.startsWith('_kme_') && !l.name?.startsWith('jinpei_')),
            };
        }, origQuery, 'query');
        stealthQuery.__isStealth = true;
        navigator.locks.query = stealthQuery;
    }

    function enableStorageStealth() {
        if (typeof window === 'undefined' || !window.Storage) return;
        if (Storage.prototype.key.__isStealth) return;
        const isHidden = key => typeof key === 'string' && (key.startsWith('_kme_') || key.startsWith('jinpei_'));
        const origKey = Storage.prototype.key;
        if (typeof origKey === 'function') {
            const stealthKey = makeNativeFunction(function key(index) {
                const visible = [];
                for (let i = 0; i < this.length; i++) {
                    const k = origKey.call(this, i);
                    if (k && !isHidden(k)) visible.push(k);
                }
                return visible[index] !== undefined ? visible[index] : null;
            }, origKey, 'key');
            stealthKey.__isStealth = true;
            Storage.prototype.key = stealthKey;
        }
    }

