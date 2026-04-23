export type UserRole = 'merchant' | 'explorer' | string;

export interface AuthUser {
  _id?: string;
  id?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  buddyMode?: boolean;
  businessId?: string | { _id?: string; id?: string; name?: string };
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  requiresOtp?: boolean;
  email?: string;
  message?: string;
}

export interface Business {
  _id: string;
  name: string;
  category?: string;
  description?: string;
  avgPrice?: number;
}

export interface BuddyGroup {
  _id: string;
  activity?: string;
  description?: string;
  scheduledAt?: string;
  members?: Array<{ _id?: string; id?: string; name?: string }>;
}

export interface ChatMessage {
  _id?: string;
  userName?: string;
  message?: string;
  createdAt?: string;
}
