-- RPM-CORE-012 (1/2). "O entregador está chegando" notification kind.
-- Forward-only; hosted application requires separate approval.
-- Its own file: a new enum value cannot be used in the transaction that adds it.
alter type public.notification_type add value if not exists 'COURIER_NEARBY';
