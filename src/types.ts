export interface Env {
  DB: D1Database;
  AI: Ai;
  EMBED_MODEL: string;
  LLM_MODEL: string;
}

export type EntityType = "space" | "page";

export interface User {
  id: number;
  email: string;
  display_name: string;
  role: string;
}

export interface Page {
  id: number;
  space_id: number;
  title: string;
  body: string;
  updated_at: string;
  version: number;
}

export interface PermissionRow {
  id: number;
  user_id: number;
  entity_type: EntityType;
  entity_id: number;
  allowed: 0 | 1;
}

export interface AuditEntry {
  id: number;
  seq: number;
  prev_hash: string;
  created_at: string;
  actor_id: number;
  action: string;
  query: string;
  candidates: string;
  allowed: string;
  denied: string;
  answer: string;
  chain_hash: string;
}