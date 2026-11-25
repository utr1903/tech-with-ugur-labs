-- Seed data for the payments database. Everything here is fake:
-- example.test emails, test-range card numbers, LAB-FAKE passwords.
\set payments_pw `printenv PAYMENTS_APP_PASSWORD`
\connect payments

CREATE TABLE customers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL,
  card_number text NOT NULL,
  card_last4  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN customers.card_number IS 'LAB-FAKE: test-range card number, not a real card';

INSERT INTO customers (name, email, card_number, card_last4)
SELECT
  'Customer ' || n,
  'customer' || n || '@example.test',
  '4000-0000-0000-' || lpad(n::text, 4, '0'),
  lpad(n::text, 4, '0')
FROM generate_series(1, 500) AS n;

CREATE ROLE payments_app LOGIN PASSWORD :'payments_pw';
CREATE ROLE report_reader LOGIN PASSWORD 'LAB-FAKE-report-pw';
CREATE ROLE ci_migrator LOGIN PASSWORD 'LAB-FAKE-ci-migrator-pw';

GRANT SELECT ON customers TO payments_app, report_reader;
GRANT USAGE, CREATE ON SCHEMA public TO ci_migrator;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ci_migrator;
