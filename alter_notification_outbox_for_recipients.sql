-- Ejecutar antes de desplegar el backend que encola notificaciones.
-- Conserva registros y estados anteriores; no envía correos ni cambia saldos.
BEGIN;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(20);

UPDATE notification_outbox n SET recipient_role =
  CASE WHEN t.type <> 'TRANSFER' THEN 'owner'
       WHEN n.recipient_email = sender.email THEN 'sender'
       WHEN n.recipient_email = recipient.email THEN 'recipient'
       ELSE NULL END
FROM transactions t
JOIN wallets sw ON sw.id = t.wallet_id
JOIN users sender ON sender.id = sw.user_id
LEFT JOIN wallets rw ON rw.id = t.destination_wallet_id
LEFT JOIN users recipient ON recipient.id = rw.user_id
WHERE n.transaction_id = t.id AND n.recipient_role IS NULL;

-- Si un email histórico no coincide, abortar para revisarlo sin asignar un rol falso.
ALTER TABLE notification_outbox ALTER COLUMN recipient_role SET NOT NULL;
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_recipient_role_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_recipient_role_check
  CHECK (recipient_role IN ('owner', 'sender', 'recipient'));
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_transaction_id_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_transaction_id_type_recipient_role_key
  ON notification_outbox(transaction_id, type, recipient_role);
COMMIT;
