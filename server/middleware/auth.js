import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ error: 'Not authorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    req.tokenClaims = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const optionalProtect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = await User.findById(decoded.id).select('-password');
  } catch (_) {}
  next();
};

export const merchantOnly = (req, res, next) => {


  const hasClaims = req.tokenClaims && (req.tokenClaims.role !== undefined || req.tokenClaims.merchant !== undefined);
  const hasMerchantClaim = req.tokenClaims?.merchant === true || req.tokenClaims?.role === 'merchant';
  if (req.user?.role !== 'merchant' || hasClaims && !hasMerchantClaim) {
    return res.status(403).json({ error: 'Merchant access required' });
  }
  next();
};