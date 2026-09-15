export interface Env {
  DB: D1Database;
  AI: Ai;
  EMBED_MODEL: string;
  LLM_MODEL: string;
}

export type EntityType =
  | "space"
  | "page"
  | "jira_project"
  | "slack_channel"
  | "drive_file";

export type Platform = "confluence" | "jira" | "slack" | "drive";

export interface User {
  id: number;
  email: string;
  display_name: string;
  role: string;
}

export interface Document {
  id: number;
  platform: Platform;
  external_id: string;
  title: string;
  body: string;
  updated_at: string;
  version: number;
  acl_type: EntityType;
  acl_id: number;
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