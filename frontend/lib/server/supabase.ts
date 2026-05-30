import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

export type Portfolio = {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type Position = {
  id: number;
  portfolio_id: number;
  ticker: string;
  name: string;
  quantity: number;
  avg_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  strategy: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WatchlistItem = {
  id: number;
  ticker: string;
  name: string;
  sector: string | null;
  added_at: string;
};

export type PriceAlert = {
  id: number;
  ticker: string;
  position_id: number | null;
  alert_type: string;
  direction: string;
  threshold: number;
  message: string | null;
  is_active: boolean;
  last_triggered: string | null;
  created_at: string;
};

export type PushSubscription = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};
