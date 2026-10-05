-- Facturas SaaS: admin_id = 6 — julio, septiembre y octubre 2026.
-- Idempotente (no duplica si ya existe el periodo).
-- due_date = día 1 + due_days (misma regla que el cron en saas-time.js).

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
    m.period_month,
    2026,
    s.fee_amount,
    s.currency,
    1.0000,
    CONCAT('2026-', LPAD(m.period_month, 2, '0'), '-01'),
    CONCAT(
        '2026-',
        LPAD(m.period_month, 2, '0'),
        '-',
        LPAD(1 + IFNULL(s.due_days, 0), 2, '0')
    ),
    'PENDING'
FROM saas_subscriptions s
CROSS JOIN (
    SELECT 7 AS period_month
    UNION ALL SELECT 9
    UNION ALL SELECT 10
) m
WHERE s.admin_id = 6
  AND NOT EXISTS (
      SELECT 1
      FROM saas_invoices i
      WHERE i.admin_id = s.admin_id
        AND i.period_year = 2026
        AND i.period_month = m.period_month
  );

SELECT id, admin_id, period_month, period_year, fee_amount, currency,
       issue_date, due_date, status
FROM saas_invoices
WHERE admin_id = 6 AND period_year = 2026 AND period_month IN (7, 9, 10)
ORDER BY period_month;
