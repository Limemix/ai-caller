const crypto = require('crypto');
const Logger = require('../utils/Logger');

class SIPAuth {
    constructor(config) {
        this.config = config.sip;
        this.authParams = null;
        this.logger = new Logger();
    }

    parseAuthChallenge(lines) {
        let realm = '';
        let nonce = '';
        let qop = '';
        let algorithm = 'MD5';

        for (const line of lines) {
            // Ищем и WWW-Authenticate И Proxy-Authenticate
            if (line.startsWith('WWW-Authenticate:') || line.startsWith('Proxy-Authenticate:')) {
                const realmMatch = line.match(/realm="([^"]+)"/);
                if (realmMatch) realm = realmMatch[1];

                const nonceMatch = line.match(/nonce="([^"]+)"/);
                if (nonceMatch) nonce = nonceMatch[1];

                const qopMatch = line.match(/qop="([^"]+)"/);
                if (qopMatch) qop = qopMatch[1];

                const algoMatch = line.match(/algorithm=([^,\s]+)/);
                if (algoMatch) algorithm = algoMatch[1];
            }
        }

        if (realm && nonce) {
            this.authParams = { realm, nonce, qop, algorithm };
            this.logger.debug('✅ Параметры аутентификации:', this.authParams);
            return this.authParams;
        }

        this.logger.error('❌ Не найдены realm или nonce в заголовке аутентификации');
        return null;
    }

    generateAuthHeader() {
        if (!this.authParams) {
            throw new Error('Auth parameters not set');
        }

        const uri = `sip:${this.config.server}`;
        const method = 'REGISTER';

        const ha1 = this.md5(
            `${this.config.username}:${this.authParams.realm}:${this.config.password}`
        );

        const ha2 = this.md5(`${method}:${uri}`);

        let response;
        let authHeader;

        if (this.authParams.qop && this.authParams.qop.includes('auth')) {
            const cnonce = this.generateCnonce();
            const nc = '00000001';

            response = this.md5(
                `${ha1}:${this.authParams.nonce}:${nc}:${cnonce}:auth:${ha2}`
            );

            authHeader = `Digest username="${this.config.username}",realm="${this.authParams.realm}",nonce="${this.authParams.nonce}",uri="${uri}",response="${response}",cnonce="${cnonce}",qop=auth,nc=${nc},algorithm=${this.authParams.algorithm || 'MD5'}`;

        } else {
            response = this.md5(
                `${ha1}:${this.authParams.nonce}:${ha2}`
            );

            authHeader = `Digest username="${this.config.username}",realm="${this.authParams.realm}",nonce="${this.authParams.nonce}",uri="${uri}",response="${response}",algorithm=${this.authParams.algorithm || 'MD5'}`;
        }

        return authHeader;
    }

    generateAuthHeaderForInvite(targetNumber, cseq, authParams) {
        const uri = `sip:${targetNumber}@${this.config.server}`;
        const method = 'INVITE';

        const ha1 = this.md5(
            `${this.config.username}:${authParams.realm}:${this.config.password}`
        );

        const ha2 = this.md5(`${method}:${uri}`);

        let response;
        let authHeader;

        if (authParams.qop && authParams.qop.includes('auth')) {
            const cnonce = this.generateCnonce();
            const nc = '00000001';

            response = this.md5(
                `${ha1}:${authParams.nonce}:${nc}:${cnonce}:auth:${ha2}`
            );

            authHeader = `Digest username="${this.config.username}",realm="${authParams.realm}",nonce="${authParams.nonce}",uri="${uri}",response="${response}",cnonce="${cnonce}",qop=auth,nc=${nc},algorithm=${authParams.algorithm || 'MD5'}`;

        } else {
            response = this.md5(
                `${ha1}:${authParams.nonce}:${ha2}`
            );

            authHeader = `Digest username="${this.config.username}",realm="${authParams.realm}",nonce="${authParams.nonce}",uri="${uri}",response="${response}",algorithm=${authParams.algorithm || 'MD5'}`;
        }

        this.logger.debug('🔐 Auth для INVITE:', {
            username: this.config.username,
            realm: authParams.realm,
            uri: uri,
            method: method,
            qop: authParams.qop
        });

        return authHeader;
    }

    generateCnonce() {
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
    }

    md5(data) {
        return crypto.createHash('md5').update(data).digest('hex');
    }
}

module.exports = SIPAuth;