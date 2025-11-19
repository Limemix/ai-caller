class Logger {
    constructor(enabled = true) {
        this.enabled = enabled;

        this.logLevels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3
        };

        this.currentLevel = this.logLevels.INFO;
    }

    setLevel(level) {
        this.currentLevel = this.logLevels[level] || this.logLevels.INFO;
    }

    error(message, ...args) {
        if (!this.enabled) return;
        if (this.currentLevel >= this.logLevels.ERROR) {
            console.error(`❌ ${new Date().toISOString()} [ERROR] ${message}`, ...args);
        }
    }

    warn(message, ...args) {
        if (!this.enabled) return;
        if (this.currentLevel >= this.logLevels.WARN) {
            console.warn(`⚠️ ${new Date().toISOString()} [WARN] ${message}`, ...args);
        }
    }

    info(message, ...args) {
        if (!this.enabled) return;
        if (this.currentLevel >= this.logLevels.INFO) {
            console.log(`✅ ${new Date().toISOString()} [INFO] ${message}`, ...args);
        }
    }

    debug(message, ...args) {
        if (!this.enabled) return;
        if (this.currentLevel >= this.logLevels.DEBUG) {
            console.log(`🔍 ${new Date().toISOString()} [DEBUG] ${message}`, ...args);
        }
    }
}

module.exports = Logger;
