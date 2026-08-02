import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';

export const isMobilePdvUserAgent = (value = '') => /Android|iPhone|iPad|iPod|Mobile/i.test(String(value || ''));

const isValidTerminalId = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ''));
const hasValidPublicKey = (value) => Boolean(
  value && typeof value === 'object' && value.kty === 'EC' && value.crv === 'P-256'
  && typeof value.x === 'string' && typeof value.y === 'string'
);

export const createPdvTerminalServices = ({
  db,
  challengeTtlMs,
  createSignedToken,
  decodeSignedToken,
  ensureDatabaseReady,
  getClientIp,
  isAdminBypassPin,
  addAuditLog,
}) => {
  const issuePdvTerminalChallenge = async ({ terminalId }) => {
    const safeTerminalId = String(terminalId || '').trim();
    if (!isValidTerminalId(safeTerminalId)) return { valid: false, challenge: null };
    const result = await db.execute({
      sql: "SELECT id FROM pdv_terminals WHERE id = ? AND status = 'active' LIMIT 1",
      args: [safeTerminalId],
    });
    if (!result.rows[0]) return { valid: false, challenge: null };
    return {
      valid: true,
      challenge: createSignedToken({
        type: 'pdv_terminal_challenge', terminalId: safeTerminalId, nonce: randomUUID(), exp: Date.now() + challengeTtlMs,
      }),
    };
  };

  const verifyPdvTerminalProof = async ({ terminalId, terminalChallenge, terminalSignature, ip = '', deviceInfo = '' }) => {
    const safeTerminalId = String(terminalId || '').trim();
    if (isMobilePdvUserAgent(deviceInfo) || !isValidTerminalId(safeTerminalId) || !terminalChallenge || !terminalSignature) {
      return { valid: false, terminalId: '' };
    }
    try {
      const payload = decodeSignedToken(terminalChallenge);
      if (!payload || payload.type !== 'pdv_terminal_challenge' || payload.terminalId !== safeTerminalId
        || !Number.isFinite(Number(payload.exp)) || Number(payload.exp) < Date.now()) {
        return { valid: false, terminalId: '' };
      }
      const result = await db.execute({
        sql: "SELECT public_key_jwk, device_info FROM pdv_terminals WHERE id = ? AND status = 'active' LIMIT 1",
        args: [safeTerminalId],
      });
      if (isMobilePdvUserAgent(result.rows[0]?.device_info)) return { valid: false, terminalId: '' };
      const publicKeyJwk = JSON.parse(String(result.rows[0]?.public_key_jwk || ''));
      if (!hasValidPublicKey(publicKeyJwk)) return { valid: false, terminalId: '' };
      const valid = verifySignature(
        'sha256', Buffer.from(String(terminalChallenge)),
        { key: createPublicKey({ key: publicKeyJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
        Buffer.from(String(terminalSignature), 'base64url'),
      );
      if (!valid) return { valid: false, terminalId: '' };
      await db.execute({
        sql: 'UPDATE pdv_terminals SET last_seen_at = ?, last_ip = ? WHERE id = ?',
        args: [new Date().toISOString(), String(ip || '').slice(0, 80), safeTerminalId],
      });
      return { valid: true, terminalId: safeTerminalId };
    } catch {
      return { valid: false, terminalId: '' };
    }
  };

  const bootstrapPdvTerminal = async ({ terminalId, terminalPublicKey, ip = '', deviceInfo = '' }) => {
    const safeTerminalId = String(terminalId || '').trim();
    if (isMobilePdvUserAgent(deviceInfo) || !isValidTerminalId(safeTerminalId) || !hasValidPublicKey(terminalPublicKey)) return '';
    const current = await db.execute({ sql: 'SELECT id FROM pdv_terminals WHERE id = ? LIMIT 1', args: [safeTerminalId] });
    if (current.rows[0]) return '';
    const now = new Date().toISOString();
    await db.execute({
      sql: "INSERT INTO pdv_terminals (id, public_key_jwk, status, device_info, first_seen_at, last_seen_at, last_ip) VALUES (?, ?, 'active', ?, ?, ?, ?)",
      args: [safeTerminalId, JSON.stringify(terminalPublicKey), String(deviceInfo).slice(0, 1000), now, now, String(ip).slice(0, 80)],
    });
    return safeTerminalId;
  };

  const authorizePdvTerminal = async ({ adminPin, terminalId, terminalPublicKey }, { req = null } = {}) => {
    await ensureDatabaseReady();
    const deviceInfo = String(req?.headers?.['user-agent'] || '');
    if (isMobilePdvUserAgent(deviceInfo)) {
      const error = new Error('A autorização do terminal está disponível somente no computador da operação.');
      error.statusCode = 403;
      throw error;
    }
    if (!isAdminBypassPin(String(adminPin || ''))) {
      const error = new Error('PIN administrativo inválido.');
      error.statusCode = 403;
      throw error;
    }
    const safeTerminalId = String(terminalId || '').trim();
    if (!isValidTerminalId(safeTerminalId) || !hasValidPublicKey(terminalPublicKey)) {
      const error = new Error('Não foi possível identificar este computador.');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date().toISOString();
    const ip = req ? getClientIp(req) : '';
    const existing = await db.execute({ sql: 'SELECT id FROM pdv_terminals WHERE id = ? LIMIT 1', args: [safeTerminalId] });
    if (existing.rows[0]) {
      await db.execute({
        sql: "UPDATE pdv_terminals SET public_key_jwk = ?, status = 'active', device_info = ?, last_seen_at = ?, last_ip = ? WHERE id = ?",
        args: [JSON.stringify(terminalPublicKey), deviceInfo.slice(0, 1000), now, String(ip).slice(0, 80), safeTerminalId],
      });
    } else {
      await db.execute({
        sql: "INSERT INTO pdv_terminals (id, public_key_jwk, status, device_info, first_seen_at, last_seen_at, last_ip) VALUES (?, ?, 'active', ?, ?, ?, ?)",
        args: [safeTerminalId, JSON.stringify(terminalPublicKey), deviceInfo.slice(0, 1000), now, now, String(ip).slice(0, 80)],
      });
    }
    await addAuditLog({
      action: 'pdv_terminal_authorized',
      details: JSON.stringify({ terminalId: safeTerminalId, ip, deviceInfo: deviceInfo.slice(0, 240) }),
      origin: 'pdv', authorName: 'Super Admin',
    });
    return { authorized: true, terminalId: safeTerminalId };
  };

  return { authorizePdvTerminal, bootstrapPdvTerminal, issuePdvTerminalChallenge, verifyPdvTerminalProof };
};
