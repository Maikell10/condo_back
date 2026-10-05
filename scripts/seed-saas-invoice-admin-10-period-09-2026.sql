-- Factura SaaS admin_id = 10, periodo servicio 09/2026
-- Regla: emitida en octubre 2026 → issue 2026-10-01, due según due_days (mes de emisión).

INSERT INTO saas_invoices (
    admin_id,
    period_month,
    period_year,
    fee_amount,
    currency,
    exchange_rate,
    issue_date,
    due_date,
    status
)
SELECT
    s.admin_id,
    9,
    2026,
    s.fee_amount,
    s.currency,
    1.0000,
    '2026-10-01',
    CONCAT(
        '2026-10-',
        LPAD(1 + IFNULL(s.due_days, 0), 2, '0')
    ),
    'PENDING'
FROM saas_subscriptions s
WHERE s.admin_id = 10
  AND NOT EXISTS (
      SELECT 1
      FROM saas_invoices i
      WHERE i.admin_id = 10
        AND i.period_year = 2026
        AND i.period_month = 9
  );

SELECT id, admin_id, period_month, period_year, issue_date, due_date, status
FROM saas_invoices
WHERE admin_id = 10 AND period_year = 2026 AND period_month = 9;
