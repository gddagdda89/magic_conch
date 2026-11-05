    function getStorageItem(keyName, legacyKey) {
        try {
            return sessionStorage.getItem(keyName) ?? (legacyKey ? sessionStorage.getItem(legacyKey) : null);
        } catch (_) {
            return null;
        }
    }

    function setStorageItem(keyName, value) {
        try {
            sessionStorage.setItem(keyName, value);
        } catch (_) {}
    }

    function removeStorageItem(keyName, legacyKey) {
        try {
            sessionStorage.removeItem(keyName);
            if (legacyKey) sessionStorage.removeItem(legacyKey);
        } catch (_) {}
    }

    function getLocalItem(keyName, fallback) {
        try {
            if (typeof localStorage === 'undefined') return fallback;
            const v = localStorage.getItem(keyName);
            return v !== null ? v : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function setLocalItem(keyName, value) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(keyName, value);
            }
        } catch (_) {}
    }

    function removeLocalItem(keyName) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem(keyName);
            }
        } catch (_) {}
    }
