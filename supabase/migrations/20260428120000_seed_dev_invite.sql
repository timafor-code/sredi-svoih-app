-- Seed local MVP invite code: DEV-SREDI-2026
-- public.invites.code_hash is text, so store the sha256 digest as hex.

with seed_community as (
  select id
  from public.communities
  where slug = 'sredi-svoih'
  limit 1
)
insert into public.invites (
  community_id,
  code_hash,
  role,
  max_uses,
  used_count,
  expires_at,
  status
)
select
  seed_community.id,
  encode(extensions.digest('DEV-SREDI-2026', 'sha256'), 'hex'),
  'member',
  100,
  0,
  '2036-01-01 00:00:00+00'::timestamptz,
  'active'
from seed_community
on conflict (code_hash) do update set
  community_id = excluded.community_id,
  role = excluded.role,
  max_uses = excluded.max_uses,
  used_count = 0,
  expires_at = excluded.expires_at,
  accepted_by = null,
  accepted_at = null,
  status = 'active';
