#Requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$AllowProductionWithOwnerCommand,
  [string]$PsqlPath = $env:AUTH_INVENTORY_PSQL_PATH
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DatabaseUrl = $env:AUTH_INVENTORY_DATABASE_URL
$RunAck = $env:AUTH_INVENTORY_RUN_ACK
$ExpectedAck = "LOCAL_ONLY_COUNTS_ONLY"

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw "Missing AUTH_INVENTORY_DATABASE_URL. Set it only in the owner's local shell; never commit it."
}

if ($RunAck -ne $ExpectedAck) {
  throw "Missing AUTH_INVENTORY_RUN_ACK=$ExpectedAck. This owner-run script is intentionally fail-closed."
}

$looksLikeHostedSupabase =
  $DatabaseUrl -match "(?i)(supabase\.co|pooler\.supabase\.com|\.supabase\.)"

if ($looksLikeHostedSupabase -and -not $AllowProductionWithOwnerCommand) {
  throw "Connection string looks hosted/Supabase-managed. Do not run against production unless the owner gives a separate explicit command, then pass -AllowProductionWithOwnerCommand."
}

if ([string]::IsNullOrWhiteSpace($PsqlPath)) {
  $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
  if ($null -eq $psqlCommand) {
    throw "psql was not found on PATH. Install PostgreSQL client tools or set AUTH_INVENTORY_PSQL_PATH."
  }

  $PsqlPath = $psqlCommand.Source
} elseif (-not (Test-Path -LiteralPath $PsqlPath)) {
  throw "AUTH_INVENTORY_PSQL_PATH does not point to an existing file."
}

Write-Warning "OWNER-RUN AUTH INVENTORY ONLY. Default intent is local/dev use."
Write-Warning "Do not run against production unless the project owner gave a separate explicit command."
Write-Warning "This script prints aggregate counts and mismatch summaries only. It must not be modified to dump auth rows, provider payloads, tokens, or password data."
Write-Output ""
Write-Output "section | metric | value"
Write-Output "--------|--------|------"

$sql = @'
\set ON_ERROR_STOP on
set default_transaction_read_only = on;

with identity_flags as (
  select
    u.id as user_id,
    coalesce(bool_or(lower(i.provider) = 'google'), false) as has_google_identity,
    coalesce(bool_or(lower(i.provider) = 'apple'), false) as has_apple_identity,
    coalesce(bool_or(lower(i.provider) in ('email', 'phone')), false) as has_password_identity,
    count(*) filter (where lower(i.provider) not in ('email', 'phone')) as oauth_identity_count,
    count(distinct lower(i.provider)) filter (where lower(i.provider) not in ('email', 'phone')) as oauth_provider_count
  from auth.users u
  left join auth.identities i on i.user_id = u.id
  group by u.id
),
auth_user_flags as (
  select
    u.id as user_id,
    lower(nullif(btrim(u.email), '')) as normalized_auth_email,
    nullif(btrim(u.email), '') is not null
      and position('@' in btrim(u.email)) > 1 as has_usable_email,
    nullif(btrim(u.encrypted_password), '') is not null as has_encrypted_password,
    i.has_password_identity,
    i.has_google_identity,
    i.has_apple_identity,
    i.oauth_identity_count,
    i.oauth_provider_count,
    (
      nullif(btrim(u.encrypted_password), '') is not null
      or i.has_password_identity
    ) as is_password_capable
  from auth.users u
  join identity_flags i on i.user_id = u.id
),
profile_flags as (
  select
    p.id as user_id,
    p.community_id,
    lower(nullif(btrim(p.email), '')) as normalized_profile_email
  from public.profiles p
),
membership_flags as (
  select
    cm.user_id,
    count(*) as membership_count,
    count(*) filter (where cm.status = 'active') as active_membership_count
  from public.community_memberships cm
  group by cm.user_id
),
auth_email_duplicates as (
  select normalized_auth_email, count(*) as user_count
  from auth_user_flags
  where has_usable_email
  group by normalized_auth_email
  having count(*) > 1
),
profile_email_duplicates as (
  select normalized_profile_email, count(*) as profile_count
  from profile_flags
  where normalized_profile_email is not null
  group by normalized_profile_email
  having count(*) > 1
),
metrics as (
  select 'auth_counts' as section, 'total_supabase_auth_users' as metric, count(*)::text as value
  from auth_user_flags

  union all
  select 'auth_counts', 'password_capable_users', count(*)::text
  from auth_user_flags
  where is_password_capable

  union all
  select 'auth_counts', 'encrypted_password_users', count(*)::text
  from auth_user_flags
  where has_encrypted_password

  union all
  select 'auth_counts', 'email_or_phone_identity_users', count(*)::text
  from auth_user_flags
  where has_password_identity

  union all
  select 'auth_counts', 'users_with_no_usable_email', count(*)::text
  from auth_user_flags
  where not has_usable_email

  union all
  select 'oauth_counts', 'google_oauth_only_users', count(*)::text
  from auth_user_flags
  where not is_password_capable
    and has_google_identity
    and oauth_provider_count = 1

  union all
  select 'oauth_counts', 'apple_oauth_only_users', count(*)::text
  from auth_user_flags
  where not is_password_capable
    and has_apple_identity
    and oauth_provider_count = 1

  union all
  select 'oauth_counts', 'mixed_password_and_oauth_users', count(*)::text
  from auth_user_flags
  where is_password_capable
    and oauth_identity_count > 0

  union all
  select 'oauth_counts', 'other_or_multi_oauth_without_password_users', count(*)::text
  from auth_user_flags
  where not is_password_capable
    and oauth_identity_count > 0
    and not (has_google_identity and oauth_provider_count = 1)
    and not (has_apple_identity and oauth_provider_count = 1)

  union all
  select 'mapping_signal', 'auth_users_missing_profile_uuid_match', count(*)::text
  from auth_user_flags a
  left join profile_flags p on p.user_id = a.user_id
  where p.user_id is null

  union all
  select 'mapping_signal', 'auth_users_with_usable_email_missing_profile_uuid_match', count(*)::text
  from auth_user_flags a
  left join profile_flags p on p.user_id = a.user_id
  where a.has_usable_email
    and p.user_id is null

  union all
  select 'mapping_signal', 'profiles_without_auth_user_match', count(*)::text
  from profile_flags p
  left join auth_user_flags a on a.user_id = p.user_id
  where a.user_id is null

  union all
  select 'mapping_signal', 'auth_profile_email_mismatch_users', count(*)::text
  from auth_user_flags a
  join profile_flags p on p.user_id = a.user_id
  where a.normalized_auth_email is not null
    and p.normalized_profile_email is not null
    and a.normalized_auth_email <> p.normalized_profile_email

  union all
  select 'mapping_signal', 'duplicate_auth_usable_email_groups', count(*)::text
  from auth_email_duplicates

  union all
  select 'mapping_signal', 'duplicate_auth_usable_email_users', coalesce(sum(user_count), 0)::text
  from auth_email_duplicates

  union all
  select 'mapping_signal', 'duplicate_profile_usable_email_groups', count(*)::text
  from profile_email_duplicates

  union all
  select 'mapping_signal', 'duplicate_profile_usable_email_profiles', coalesce(sum(profile_count), 0)::text
  from profile_email_duplicates

  union all
  select 'profile_membership_mismatch', 'auth_users_with_profile_but_no_membership', count(*)::text
  from auth_user_flags a
  join profile_flags p on p.user_id = a.user_id
  left join membership_flags m on m.user_id = a.user_id
  where coalesce(m.membership_count, 0) = 0

  union all
  select 'profile_membership_mismatch', 'auth_users_with_profile_but_no_active_membership', count(*)::text
  from auth_user_flags a
  join profile_flags p on p.user_id = a.user_id
  left join membership_flags m on m.user_id = a.user_id
  where coalesce(m.active_membership_count, 0) = 0

  union all
  select 'profile_membership_mismatch', 'membership_rows_without_auth_user', count(*)::text
  from public.community_memberships cm
  left join auth_user_flags a on a.user_id = cm.user_id
  where a.user_id is null

  union all
  select 'profile_membership_mismatch', 'membership_rows_without_profile', count(*)::text
  from public.community_memberships cm
  left join profile_flags p on p.user_id = cm.user_id
  where p.user_id is null

  union all
  select 'profile_membership_mismatch', 'profiles_with_community_id_but_no_matching_membership', count(*)::text
  from profile_flags p
  where p.community_id is not null
    and not exists (
      select 1
      from public.community_memberships cm
      where cm.user_id = p.user_id
        and cm.community_id = p.community_id
    )

  union all
  select 'profile_membership_mismatch', 'profiles_with_community_id_but_no_active_matching_membership', count(*)::text
  from profile_flags p
  where p.community_id is not null
    and not exists (
      select 1
      from public.community_memberships cm
      where cm.user_id = p.user_id
        and cm.community_id = p.community_id
        and cm.status = 'active'
    )

  union all
  select 'limitations', 'future_api_app_users_not_checked', 'true'

  union all
  select 'limitations', 'raw_auth_rows_dumped', 'false'
)
select section, metric, value
from metrics
order by
  case section
    when 'auth_counts' then 1
    when 'oauth_counts' then 2
    when 'mapping_signal' then 3
    when 'profile_membership_mismatch' then 4
    when 'limitations' then 5
    else 99
  end,
  metric;
'@

$sql | & $PsqlPath `
  "--set=ON_ERROR_STOP=1" `
  "--quiet" `
  "--no-align" `
  "--tuples-only" `
  "--field-separator= | " `
  "--pset=footer=off" `
  $DatabaseUrl

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
