-- ============================================================================
-- Migration: v2 ticket-model schema
-- Run against collab-postgres (docker exec -i collab-postgres psql ...)
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop old mobile-version tables (POC data — safe to discard)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS push_tokens CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Create enums (DO blocks to handle idempotency)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE po_status AS ENUM ('unacknowledged','acknowledged','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE po_line_status AS ENUM ('unacknowledged','acknowledged','exception','cancelled','shipped','rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('draft','open','accepted','closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_closed_kind AS ENUM ('superseded','withdrawn','expired','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_family AS ENUM ('write_fact','supplier_response','chase','triage','delivery_failure','recommendation');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_step_kind AS ENUM ('edit','send','decision','todo','classify');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_evidence_type AS ENUM ('email_message','email_attachment','erp_event');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ingestion_channel AS ENUM ('buyer_cc','scout_cc','supplier_direct','erp_api','scheduled_scan','ndr','csv_drop');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ingestion_outcome AS ENUM ('ticket_created','attached_as_evidence','duplicate_dropped','suppressed_open_ticket','suppressed_dismissed','triage_created');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE po_subscriber_source AS ENUM ('cc','inbox_origin','ticket_resolution');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Alter existing auth tables (add missing v2 columns)
-- ---------------------------------------------------------------------------
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS banned boolean DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS ban_reason text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS ban_expires timestamptz;

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS active_team_id text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS impersonated_by text;

-- ---------------------------------------------------------------------------
-- 4. Create new tables (in dependency order)
-- ---------------------------------------------------------------------------

-- 4a. Org resources & settings
CREATE TABLE IF NOT EXISTS org_resource (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning',
  data jsonb NOT NULL DEFAULT '{}',
  error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS org_resource_org_id_idx ON org_resource(organization_id);
CREATE INDEX IF NOT EXISTS org_resource_type_idx ON org_resource(resource_type);

CREATE TABLE IF NOT EXISTS org_settings (
  org_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  default_owner_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 4b. SOR master data
CREATE TABLE IF NOT EXISTS suppliers (
  org_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  supplier_code text NOT NULL,
  supplier_abbr text NOT NULL,
  supplier_name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (org_id, supplier_code)
);
CREATE INDEX IF NOT EXISTS suppliers_org_id_idx ON suppliers(org_id);
CREATE INDEX IF NOT EXISTS suppliers_org_supplier_code_idx ON suppliers(org_id, supplier_code);

CREATE TABLE IF NOT EXISTS parts (
  org_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  part_code text NOT NULL,
  part_name text NOT NULL,
  part_spec text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (org_id, part_code)
);
CREATE INDEX IF NOT EXISTS parts_org_id_idx ON parts(org_id);
CREATE INDEX IF NOT EXISTS parts_org_part_code_idx ON parts(org_id, part_code);

CREATE TABLE IF NOT EXISTS parts_suppliers (
  org_id text NOT NULL,
  part_code text NOT NULL,
  supplier_code text NOT NULL,
  unit_price numeric NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (org_id, part_code, supplier_code),
  CONSTRAINT parts_suppliers_part_fk FOREIGN KEY (org_id, part_code) REFERENCES parts(org_id, part_code) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT parts_suppliers_supplier_fk FOREIGN KEY (org_id, supplier_code) REFERENCES suppliers(org_id, supplier_code) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS parts_suppliers_org_id_idx ON parts_suppliers(org_id);
CREATE INDEX IF NOT EXISTS parts_suppliers_org_part_code_idx ON parts_suppliers(org_id, part_code);
CREATE INDEX IF NOT EXISTS parts_suppliers_org_supplier_code_idx ON parts_suppliers(org_id, supplier_code);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  contact_id uuid PRIMARY KEY,
  org_id text NOT NULL,
  supplier_code text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT supplier_contacts_supplier_fk FOREIGN KEY (org_id, supplier_code) REFERENCES suppliers(org_id, supplier_code) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supplier_contacts_org_id_idx ON supplier_contacts(org_id);
CREATE INDEX IF NOT EXISTS supplier_contacts_org_supplier_code_idx ON supplier_contacts(org_id, supplier_code);

-- 4c. Requisitions
CREATE TABLE IF NOT EXISTS requisitions (
  req_id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  req_code text NOT NULL,
  need_by date NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS requisitions_org_id_idx ON requisitions(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS requisitions_org_req_id_unique ON requisitions(org_id, req_id);
CREATE UNIQUE INDEX IF NOT EXISTS requisitions_org_req_code_unique ON requisitions(org_id, req_code);

CREATE TABLE IF NOT EXISTS requisition_lines (
  line_id uuid PRIMARY KEY,
  org_id text NOT NULL,
  req_id uuid NOT NULL,
  part_code text NOT NULL,
  quantity numeric NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT requisition_lines_req_fk FOREIGN KEY (org_id, req_id) REFERENCES requisitions(org_id, req_id) ON DELETE CASCADE,
  CONSTRAINT requisition_lines_part_fk FOREIGN KEY (org_id, part_code) REFERENCES parts(org_id, part_code) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS requisition_lines_org_id_idx ON requisition_lines(org_id);
CREATE INDEX IF NOT EXISTS requisition_lines_org_req_id_idx ON requisition_lines(org_id, req_id);
CREATE INDEX IF NOT EXISTS requisition_lines_org_part_code_idx ON requisition_lines(org_id, part_code);
CREATE UNIQUE INDEX IF NOT EXISTS requisition_lines_org_line_id_unique ON requisition_lines(org_id, line_id);

-- 4d. Purchase orders & lines
CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id uuid PRIMARY KEY,
  org_id text NOT NULL,
  po_code text NOT NULL,
  supplier_code text NOT NULL,
  status po_status DEFAULT 'unacknowledged' NOT NULL,
  status_reason text,
  owner_user_id text NOT NULL REFERENCES "user"(id),
  ack_requested_at timestamptz,
  version integer DEFAULT 1 NOT NULL,
  sent_at timestamptz,
  order_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT purchase_orders_supplier_fk FOREIGN KEY (org_id, supplier_code) REFERENCES suppliers(org_id, supplier_code) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS purchase_orders_org_id_idx ON purchase_orders(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_org_po_id_unique ON purchase_orders(org_id, po_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_org_po_code_unique ON purchase_orders(org_id, po_code);
CREATE INDEX IF NOT EXISTS purchase_orders_org_supplier_code_idx ON purchase_orders(org_id, supplier_code);
CREATE INDEX IF NOT EXISTS purchase_orders_org_status_idx ON purchase_orders(org_id, status);
CREATE INDEX IF NOT EXISTS purchase_orders_org_owner_idx ON purchase_orders(org_id, owner_user_id);

CREATE TABLE IF NOT EXISTS po_lines (
  line_id uuid PRIMARY KEY,
  org_id text NOT NULL,
  po_id uuid NOT NULL,
  req_line_id uuid,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  status po_line_status DEFAULT 'unacknowledged' NOT NULL,
  exception_reason text,
  promised_date date,
  asn_requested_at timestamptz,
  leadtime_confirmed_at timestamptz,
  version integer DEFAULT 1 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT po_lines_po_fk FOREIGN KEY (org_id, po_id) REFERENCES purchase_orders(org_id, po_id) ON DELETE CASCADE,
  CONSTRAINT po_lines_req_line_fk FOREIGN KEY (org_id, req_line_id) REFERENCES requisition_lines(org_id, line_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS po_lines_org_id_idx ON po_lines(org_id);
CREATE INDEX IF NOT EXISTS po_lines_org_po_id_idx ON po_lines(org_id, po_id);
CREATE INDEX IF NOT EXISTS po_lines_org_req_line_id_idx ON po_lines(org_id, req_line_id);
CREATE INDEX IF NOT EXISTS po_lines_org_status_idx ON po_lines(org_id, status);
CREATE INDEX IF NOT EXISTS po_lines_org_promised_date_idx ON po_lines(org_id, promised_date);

-- 4e. ASNs
CREATE TABLE IF NOT EXISTS asns (
  asn_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  line_id uuid NOT NULL REFERENCES po_lines(line_id) ON DELETE CASCADE,
  quantity_shipped numeric NOT NULL,
  date_shipped date NOT NULL,
  expected_delivery_date date,
  tracking_number text,
  carrier text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS asns_org_id_idx ON asns(org_id);
CREATE INDEX IF NOT EXISTS asns_org_line_id_idx ON asns(org_id, line_id);

-- 4f. PO subscribers
CREATE TABLE IF NOT EXISTS po_subscribers (
  org_id text NOT NULL,
  po_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source po_subscriber_source NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (org_id, po_id, user_id),
  CONSTRAINT po_subscribers_po_fk FOREIGN KEY (org_id, po_id) REFERENCES purchase_orders(org_id, po_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS po_subscribers_org_user_idx ON po_subscribers(org_id, user_id);

-- 4g. Ticket kinds
CREATE TABLE IF NOT EXISTS ticket_kinds (
  org_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  key text NOT NULL,
  family ticket_family NOT NULL,
  title text NOT NULL,
  is_write_bearing boolean DEFAULT true NOT NULL,
  suppression_window_hours integer,
  serialization_exempt boolean DEFAULT false NOT NULL,
  is_system boolean DEFAULT false NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  definition text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (org_id, key)
);
CREATE INDEX IF NOT EXISTS ticket_kinds_org_family_idx ON ticket_kinds(org_id, family);

-- 4h. Tickets (v2)
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  kind_key text NOT NULL,
  title text NOT NULL,
  status ticket_status DEFAULT 'draft' NOT NULL,
  has_writes boolean NOT NULL,
  po_id uuid,
  supplier_code text,
  steps jsonb DEFAULT '[]' NOT NULL,
  creation_reason text NOT NULL,
  created_by_user_id text REFERENCES "user"(id),
  resolved_by_user_id text REFERENCES "user"(id),
  resolved_at timestamptz,
  closed_kind ticket_closed_kind,
  closed_reason text,
  closed_ref_ticket_id uuid,
  resolution jsonb,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT tickets_kind_fk FOREIGN KEY (org_id, kind_key) REFERENCES ticket_kinds(org_id, key) ON UPDATE CASCADE,
  CONSTRAINT tickets_po_fk FOREIGN KEY (org_id, po_id) REFERENCES purchase_orders(org_id, po_id) ON DELETE CASCADE,
  CONSTRAINT tickets_supplier_fk FOREIGN KEY (org_id, supplier_code) REFERENCES suppliers(org_id, supplier_code) ON UPDATE CASCADE,
  CONSTRAINT tickets_closed_kind_iff_closed CHECK ((status = 'closed') = (closed_kind IS NOT NULL)),
  CONSTRAINT tickets_closed_reason_only_when_closed CHECK (status = 'closed' OR closed_reason IS NULL)
);
ALTER TABLE tickets ADD CONSTRAINT tickets_closed_ref_fk FOREIGN KEY (closed_ref_ticket_id) REFERENCES tickets(ticket_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tickets_org_status_idx ON tickets(org_id, status);
CREATE INDEX IF NOT EXISTS tickets_org_po_idx ON tickets(org_id, po_id);
CREATE INDEX IF NOT EXISTS tickets_org_kind_status_idx ON tickets(org_id, kind_key, status);
CREATE INDEX IF NOT EXISTS tickets_org_supplier_idx ON tickets(org_id, supplier_code);
CREATE INDEX IF NOT EXISTS tickets_closed_ref_idx ON tickets(closed_ref_ticket_id);
CREATE INDEX IF NOT EXISTS tickets_org_expires_at_idx ON tickets(org_id, expires_at);

-- 4i. Ticket write pos
CREATE TABLE IF NOT EXISTS ticket_write_pos (
  org_id text NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  po_id uuid NOT NULL,
  is_open boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (ticket_id, po_id),
  CONSTRAINT ticket_write_pos_po_fk FOREIGN KEY (org_id, po_id) REFERENCES purchase_orders(org_id, po_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ticket_write_pos_org_po_idx ON ticket_write_pos(org_id, po_id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_write_pos_one_open_per_po_unique ON ticket_write_pos(org_id, po_id) WHERE is_open = true;

-- 4j. Audit & outbound
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  ticket_id uuid REFERENCES tickets(ticket_id) ON DELETE SET NULL,
  table_name text NOT NULL,
  row_key text NOT NULL,
  operation text NOT NULL,
  changes jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_org_id_idx ON audit_log(org_id);
CREATE INDEX IF NOT EXISTS audit_log_org_table_idx ON audit_log(org_id, table_name);
CREATE INDEX IF NOT EXISTS audit_log_org_row_idx ON audit_log(org_id, table_name, row_key);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(org_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_ticket_idx ON audit_log(ticket_id);

-- 4k. Threads (must exist before outbound_log references it)
CREATE TABLE IF NOT EXISTS threads (
  thread_key text PRIMARY KEY,
  org_id text NOT NULL,
  run_id text,
  workflow_id text,
  status text,
  owner_email text,
  subject text,
  last_message_id text,
  thread_type text,
  suspended_step text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_org_id_idx ON threads(org_id);

CREATE TABLE IF NOT EXISTS outbound_log (
  id uuid PRIMARY KEY,
  thread_key text REFERENCES threads(thread_key) ON DELETE CASCADE,
  ticket_id uuid REFERENCES tickets(ticket_id) ON DELETE SET NULL,
  run_id text,
  kind text,
  sent_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS outbound_log_ticket_idx ON outbound_log(ticket_id);

-- 4l. Legacy / infra
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id text PRIMARY KEY,
  processed_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS po_dispatches (
  po_dispatch_id uuid PRIMARY KEY,
  org_id text NOT NULL,
  po_id uuid NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
  supplier_email text NOT NULL,
  recipient_emails jsonb,
  sender_email text,
  thread_key text NOT NULL,
  message_id text,
  provider_message_id text,
  provider_thread_id text,
  transport text,
  sent_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS po_dispatches_org_id_idx ON po_dispatches(org_id);
CREATE INDEX IF NOT EXISTS po_dispatches_po_id_idx ON po_dispatches(po_id);
CREATE INDEX IF NOT EXISTS po_dispatches_org_message_id_idx ON po_dispatches(org_id, message_id);
CREATE INDEX IF NOT EXISTS po_dispatches_org_thread_key_idx ON po_dispatches(org_id, thread_key);

-- 4m. Email ingestion
CREATE TABLE IF NOT EXISTS inboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id text REFERENCES organization(id) ON DELETE CASCADE,
  grant_id text NOT NULL,
  provider text NOT NULL,
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'connected',
  sync_status text NOT NULL DEFAULT 'idle',
  next_cursor text,
  backfill_started_at timestamptz,
  backfill_completed_at timestamptz,
  last_sync_error text,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS inboxes_user_id_idx ON inboxes(user_id);
CREATE INDEX IF NOT EXISTS inboxes_organization_id_idx ON inboxes(organization_id);
CREATE INDEX IF NOT EXISTS inboxes_organization_id_user_id_idx ON inboxes(organization_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS inboxes_grant_id_unique ON inboxes(grant_id);

CREATE TABLE IF NOT EXISTS nylas_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nylas_event_id text NOT NULL,
  event_type text NOT NULL,
  grant_id text,
  object_id text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claim_token text,
  last_error text,
  next_attempt_at timestamptz DEFAULT now() NOT NULL,
  processed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS nylas_webhook_events_event_id_unique ON nylas_webhook_events(nylas_event_id);
CREATE INDEX IF NOT EXISTS nylas_webhook_events_status_next_attempt_idx ON nylas_webhook_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS nylas_webhook_events_grant_id_idx ON nylas_webhook_events(grant_id);

CREATE TABLE IF NOT EXISTS inbox_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  nylas_message_id text NOT NULL,
  thread_id text,
  subject text,
  from_address text,
  to_addresses jsonb,
  body_html text,
  received_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_emails_inbox_nylas_msg_unique ON inbox_emails(inbox_id, nylas_message_id);
CREATE INDEX IF NOT EXISTS inbox_emails_inbox_id_received_at_idx ON inbox_emails(inbox_id, received_at DESC);

CREATE TABLE IF NOT EXISTS email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  inbox_id uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'nylas',
  provider_thread_id text NOT NULL,
  subject text,
  participants jsonb DEFAULT '[]' NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  earliest_message_at timestamptz,
  latest_message_at timestamptz,
  latest_snippet text,
  classification_status text NOT NULL DEFAULT 'unclassified',
  processing_status text NOT NULL DEFAULT 'idle',
  thread_kind text,
  is_backfill boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz DEFAULT now() NOT NULL,
  last_error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS email_threads_inbox_provider_thread_unique ON email_threads(inbox_id, provider_thread_id);
CREATE INDEX IF NOT EXISTS email_threads_org_latest_idx ON email_threads(org_id, latest_message_at DESC);
CREATE INDEX IF NOT EXISTS email_threads_org_classification_idx ON email_threads(org_id, classification_status);
CREATE INDEX IF NOT EXISTS email_threads_org_processing_idx ON email_threads(org_id, processing_status);

CREATE TABLE IF NOT EXISTS email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  provider_thread_id text NOT NULL,
  message_id_header text,
  subject text,
  snippet text,
  "from" jsonb DEFAULT '[]' NOT NULL,
  "to" jsonb DEFAULT '[]' NOT NULL,
  cc jsonb DEFAULT '[]' NOT NULL,
  bcc jsonb DEFAULT '[]' NOT NULL,
  reply_to jsonb DEFAULT '[]' NOT NULL,
  folder_ids jsonb DEFAULT '[]' NOT NULL,
  attachments jsonb DEFAULT '[]' NOT NULL,
  has_attachments boolean NOT NULL DEFAULT false,
  body_html text,
  body_text text,
  selected_payload jsonb DEFAULT '{}' NOT NULL,
  received_at timestamptz,
  source text NOT NULL,
  direction text NOT NULL DEFAULT 'unknown',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_inbox_provider_message_unique ON email_messages(inbox_id, provider_message_id);
CREATE INDEX IF NOT EXISTS email_messages_thread_id_idx ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS email_messages_org_received_at_idx ON email_messages(org_id, received_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_org_message_id_header_idx ON email_messages(org_id, message_id_header);

CREATE TABLE IF NOT EXISTS email_attachment_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  provider_attachment_id text NOT NULL,
  filename text,
  content_type text,
  size_bytes integer,
  is_inline boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  extraction_strategy text,
  extracted_markdown text,
  extraction_payload jsonb,
  extraction_error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS email_attachment_extractions_message_attachment_unique ON email_attachment_extractions(message_id, provider_attachment_id);
CREATE INDEX IF NOT EXISTS email_attachment_extractions_message_id_idx ON email_attachment_extractions(message_id);
CREATE INDEX IF NOT EXISTS email_attachment_extractions_org_status_idx ON email_attachment_extractions(org_id, status);
CREATE INDEX IF NOT EXISTS email_attachment_extractions_provider_message_idx ON email_attachment_extractions(inbox_id, provider_message_id);

CREATE TABLE IF NOT EXISTS email_discovery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  inbox_id uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  cursor_start text,
  cursor_end text,
  pages_processed integer NOT NULL DEFAULT 0,
  messages_upserted integer NOT NULL DEFAULT 0,
  threads_touched integer NOT NULL DEFAULT 0,
  pages_remaining integer,
  attempts integer NOT NULL DEFAULT 0,
  claim_token text,
  last_error text,
  next_attempt_at timestamptz DEFAULT now() NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS email_discovery_jobs_status_next_attempt_idx ON email_discovery_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS email_discovery_jobs_inbox_id_idx ON email_discovery_jobs(inbox_id);

CREATE TABLE IF NOT EXISTS email_thread_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claim_token text,
  last_error text,
  next_attempt_at timestamptz DEFAULT now() NOT NULL,
  processed_at timestamptz,
  classification_kind text,
  classification_confidence double precision,
  classification_reason text,
  classification_strategy text,
  procurement_status text,
  procurement_po_code text,
  procurement_warnings jsonb DEFAULT '[]' NOT NULL,
  classification_result jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS email_thread_jobs_status_next_attempt_idx ON email_thread_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS email_thread_jobs_thread_id_job_type_idx ON email_thread_jobs(thread_id, job_type);

-- 4n. Ticket evidence (after email_messages and email_attachment_extractions)
CREATE TABLE IF NOT EXISTS ticket_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  type ticket_evidence_type NOT NULL,
  email_message_id uuid REFERENCES email_messages(id) ON DELETE SET NULL,
  attachment_extraction_id uuid REFERENCES email_attachment_extractions(id) ON DELETE SET NULL,
  erp_payload jsonb,
  note text,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_evidence_ticket_idx ON ticket_evidence(ticket_id);
CREATE INDEX IF NOT EXISTS ticket_evidence_email_message_idx ON ticket_evidence(email_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_evidence_ticket_message_unique ON ticket_evidence(ticket_id, email_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_evidence_ticket_attachment_unique ON ticket_evidence(ticket_id, attachment_extraction_id);

-- 4o. Ingestion events
CREATE TABLE IF NOT EXISTS ingestion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  channel ingestion_channel NOT NULL,
  provider_event_id text,
  semantic_hash text NOT NULL,
  po_id uuid,
  outcome ingestion_outcome NOT NULL,
  ticket_id uuid REFERENCES tickets(ticket_id) ON DELETE SET NULL,
  payload jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ingestion_events_org_hash_idx ON ingestion_events(org_id, semantic_hash, created_at);
CREATE INDEX IF NOT EXISTS ingestion_events_org_provider_idx ON ingestion_events(org_id, provider_event_id);
CREATE INDEX IF NOT EXISTS ingestion_events_ticket_idx ON ingestion_events(ticket_id);

-- 4p. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_org_read_created_idx ON notifications(org_id, is_read, created_at DESC);

-- 4q. Buyer onboarding
CREATE TABLE IF NOT EXISTS buyer_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  invitation_id text REFERENCES invitation(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'invited',
  current_step text NOT NULL DEFAULT 'account',
  account_ready_at timestamptz,
  invitation_accepted_at timestamptz,
  email_connected_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS buyer_onboarding_user_org_idx ON buyer_onboarding(user_id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_onboarding_invitation_id_unique ON buyer_onboarding(invitation_id);
CREATE INDEX IF NOT EXISTS buyer_onboarding_org_email_idx ON buyer_onboarding(organization_id, email);

-- 4r. Nylas OAuth states
CREATE TABLE IF NOT EXISTS nylas_oauth_states (
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider text NOT NULL,
  purpose text NOT NULL DEFAULT 'onboarding',
  redirect_path text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS nylas_oauth_states_expires_at_idx ON nylas_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS nylas_oauth_states_user_org_idx ON nylas_oauth_states(user_id, organization_id);

-- 4s. API keys & SSO
CREATE TABLE IF NOT EXISTS apikey (
  id text PRIMARY KEY,
  name text,
  start text,
  enabled boolean DEFAULT true NOT NULL,
  metadata text,
  remaining integer,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id text,
  config_id text,
  reference_id text,
  prefix text,
  key text NOT NULL,
  hash text,
  refill_interval integer,
  refill_amount integer,
  last_refill_at timestamptz,
  request_count integer DEFAULT 0,
  expires_at timestamptz,
  last_request timestamptz,
  rate_limit_enabled boolean DEFAULT true,
  rate_limit_max integer,
  rate_limit_time_window integer,
  rate_limit_refill_interval integer,
  rate_limit_refill_amount integer,
  permissions text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS apikey_userId_idx ON apikey(user_id);
CREATE INDEX IF NOT EXISTS apikey_organizationId_idx ON apikey(organization_id);
CREATE INDEX IF NOT EXISTS apikey_configId_idx ON apikey(config_id);
CREATE INDEX IF NOT EXISTS apikey_referenceId_idx ON apikey(reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS apikey_key_unique ON apikey(key);
CREATE UNIQUE INDEX IF NOT EXISTS apikey_hash_unique ON apikey(hash);

CREATE TABLE IF NOT EXISTS sso_provider (
  id text PRIMARY KEY,
  issuer text NOT NULL,
  domain text NOT NULL,
  oidc_config text,
  saml_config text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider_id text NOT NULL UNIQUE,
  organization_id text REFERENCES organization(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 4t. Mobile push tokens (kept from original schema)
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- DONE. Verify: \dt then check tickets table columns.
-- ============================================================================
