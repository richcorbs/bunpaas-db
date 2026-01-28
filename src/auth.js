import { query } from './db.js';

export async function authenticate(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const rows = await query(
    `SELECT tenant_id, can_read, can_write
     FROM api_tokens
     WHERE token = $1`,
    [token]
  );

  if (!rows.length) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.auth = rows[0];
  next();
}

export function requireRead(req, res, next) {
  if (!req.auth.can_read) return res.status(403).json({ error: 'Read not allowed' });
  next();
}

export function requireWrite(req, res, next) {
  if (!req.auth.can_write) return res.status(403).json({ error: 'Write not allowed' });
  next();
}

