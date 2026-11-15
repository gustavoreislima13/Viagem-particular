import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';

export const ADMIN_EMAILS = new Set(['reisanselmo7@gmail.com']);

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  isAdminUser?: boolean;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado: token ausente.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    req.isAdminUser = Boolean(
      decodedToken.email &&
      decodedToken.email_verified &&
      ADMIN_EMAILS.has(decodedToken.email.toLowerCase())
    );
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || !req.isAdminUser) {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  next();
};
