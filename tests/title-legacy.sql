-- Disposable integration fixture only, inserted before the forward title migration.
insert into public.conversations(id,workspace_id,title,created_at,updated_at)
values('99999999-9999-4999-8999-999999999999','33333333-3333-4333-8333-333333333333','New conversation','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z');
