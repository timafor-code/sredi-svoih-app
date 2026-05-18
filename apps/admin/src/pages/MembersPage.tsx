import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { listAdminUsers } from "../services/adminMembersService";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminBadgeTone } from "../types/admin";
import type { AdminMemberListFilters, AdminMemberListRow } from "../types/members";

type MembershipStatusFilter = NonNullable<AdminMemberListFilters["membershipStatus"]>;
type RoleFilter = NonNullable<AdminMemberListFilters["role"]>;

type MembersSummary = {
  active: number;
  noMembership: number;
  suspendedOrLeft: number;
  total: number;
};

const MEMBERS_PAGE_SIZE = 100;

const COMMUNITY_ID_ERROR =
  "Не удалось определить communityId текущей активной membership.";

const MEMBERSHIP_STATUS_FILTERS: Array<{
  label: string;
  value: MembershipStatusFilter;
}> = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные участники" },
  { value: "pending", label: "Ожидают" },
  { value: "suspended", label: "Приостановлены" },
  { value: "left", label: "Покинули" },
  { value: "no_membership", label: "Пользователи без членства" },
];

const ROLE_FILTERS: Array<{ label: string; value: RoleFilter }> = [
  { value: "all", label: "all" },
  { value: "member", label: "member" },
  { value: "event_manager", label: "event_manager" },
  { value: "admin", label: "admin" },
];

const ROLE_TONES: Record<string, AdminBadgeTone> = {
  admin: "red",
  event_manager: "gold",
  member: "blue",
};

export function MembersPage() {
  const auth = useAdminAuth();
  const communityId = auth.membership?.community_id ?? null;
  const requestSeq = useRef(0);

  const [members, setMembers] = useState<AdminMemberListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatusFilter>("all");
  const [role, setRole] = useState<RoleFilter>("all");

  const loadMembers = useCallback(async () => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;

    if (!communityId) {
      setMembers([]);
      setError(COMMUNITY_ID_ERROR);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextMembers = await listAdminUsers({
        communityId,
        search: search.trim() || null,
        membershipStatus,
        role,
        limit: MEMBERS_PAGE_SIZE,
        offset: 0,
      });

      if (requestId === requestSeq.current) {
        setMembers(nextMembers);
      }
    } catch (nextError) {
      if (requestId === requestSeq.current) {
        setMembers([]);
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Не удалось загрузить участников.",
        );
      }
    } finally {
      if (requestId === requestSeq.current) {
        setLoading(false);
      }
    }
  }, [communityId, membershipStatus, role, search]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const summary = useMemo<MembersSummary>(
    () => ({
      active: members.filter((member) => member.membershipStatus === "active").length,
      noMembership: members.filter((member) => !member.membershipId).length,
      suspendedOrLeft: members.filter(
        (member) =>
          member.membershipStatus === "suspended" || member.membershipStatus === "left",
      ).length,
      total: members.length,
    }),
    [members],
  );

  return (
    <div className="page-stack page-stack--members">
      <section className="page-header">
        <Badge tone="red">admin</Badge>
        <h1>Участники</h1>
        <p>Пользователи приложения и члены общины из Supabase.</p>
      </section>

      <div className="members-summary-grid" aria-label="Метрики участников">
        <MembersSummaryCard label="Всего в списке" tone="blue" value={summary.total} />
        <MembersSummaryCard
          label="Активные участники"
          tone="green"
          value={summary.active}
        />
        <MembersSummaryCard
          label="Пользователи без членства"
          tone="muted"
          value={summary.noMembership}
        />
        <MembersSummaryCard
          label="Приостановлены / покинули"
          tone="gold"
          value={summary.suspendedOrLeft}
        />
      </div>

      <GlassCard className="events-toolbar">
        <div className="events-toolbar__top">
          <div>
            <h2>Фильтры</h2>
            <p>Список читается через admin_list_users для текущей общины.</p>
          </div>
          <div className="events-toolbar__actions">
            <Button disabled={loading || !communityId} onClick={loadMembers}>
              {loading ? "Обновляем..." : "Обновить"}
            </Button>
          </div>
        </div>

        <div className="events-filters members-filters" aria-label="Фильтры участников">
          <label className="filter-field">
            <span>Поиск</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Имя, email, телефон или город"
              type="search"
              value={search}
            />
          </label>

          <label className="filter-field">
            <span>Статус членства</span>
            <select
              onChange={(event) =>
                setMembershipStatus(event.target.value as MembershipStatusFilter)
              }
              value={membershipStatus}
            >
              {MEMBERSHIP_STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Роль</span>
            <select
              onChange={(event) => setRole(event.target.value as RoleFilter)}
              value={role}
            >
              {ROLE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </GlassCard>

      <GlassCard className="table-panel" elevated>
        <div className="table-panel__header">
          <h2>Список участников</h2>
          <div className="events-summary">
            <span>Показано {members.length}</span>
            <Badge tone="glass">admin_list_users</Badge>
          </div>
        </div>

        {loading ? (
          <MembersState title="Загружаем участников..." />
        ) : error ? (
          <MembersState description={error} title="Не удалось загрузить участников">
            <Button onClick={loadMembers} variant="primary">
              Повторить
            </Button>
          </MembersState>
        ) : members.length === 0 ? (
          <MembersState
            description="Измените фильтры или проверьте, что в Supabase есть profiles."
            title="Участники не найдены"
          />
        ) : (
          <MembersTable members={members} />
        )}
      </GlassCard>
    </div>
  );
}

function MembersSummaryCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: AdminBadgeTone;
  value: number;
}) {
  return (
    <div className={`members-summary-card members-summary-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MembersTable({ members }: { members: AdminMemberListRow[] }) {
  return (
    <div className="events-table-scroll">
      <div className="data-table data-table--members" role="table" aria-label="Участники">
        <div className="data-table__row data-table__row--head" role="row">
          <span role="columnheader">Пользователь</span>
          <span role="columnheader">Телефон / город</span>
          <span role="columnheader">Статус</span>
          <span role="columnheader">Роль</span>
          <span role="columnheader">Записи</span>
          <span role="columnheader">Последняя запись</span>
        </div>

        {members.map((member) => (
          <div className="data-table__row data-table__row--member" key={member.userId} role="row">
            <div className="member-table-stack" role="cell">
              <strong>{member.displayName}</strong>
              {member.email ? <small>{member.email}</small> : null}
            </div>
            <div className="member-table-stack" role="cell">
              <span>{member.phone ?? "—"}</span>
              {member.city ? <small>{member.city}</small> : null}
            </div>
            <span role="cell">
              <Badge tone={getMembershipStatusTone(member)}>
                {getMembershipStatusLabel(member)}
              </Badge>
            </span>
            <span role="cell">{renderRoleBadge(member)}</span>
            <span role="cell">{formatRegistrationSummary(member)}</span>
            <span role="cell">{formatDateTimeOrDash(member.lastRegistrationAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MembersState({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="events-state" role="status">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {children ? <div className="events-state__actions">{children}</div> : null}
    </div>
  );
}

function renderRoleBadge(member: AdminMemberListRow): ReactNode {
  if (!member.membershipId || !member.membershipRole) {
    return <span className="member-table-muted">—</span>;
  }

  return (
    <Badge tone={getRoleTone(member.membershipRole)}>{member.membershipRole}</Badge>
  );
}

function getRoleTone(role: string): AdminBadgeTone {
  return ROLE_TONES[role] ?? "muted";
}

function getMembershipStatusLabel(member: AdminMemberListRow): string {
  if (!member.membershipId) {
    return "Пользователь приложения";
  }

  const labels: Record<string, string> = {
    active: "Участник",
    left: "Покинул",
    pending: "Ожидает",
    suspended: "Приостановлен",
  };

  return labels[member.membershipStatus ?? ""] ?? member.membershipStatus ?? "—";
}

function getMembershipStatusTone(member: AdminMemberListRow): AdminBadgeTone {
  if (!member.membershipId) {
    return "muted";
  }

  if (member.membershipStatus === "active") {
    return "green";
  }

  if (member.membershipStatus === "pending") {
    return "gold";
  }

  return "muted";
}

function formatRegistrationSummary(member: AdminMemberListRow): string {
  return [
    `Будущие: ${member.registrationsUpcoming}`,
    `Прошедшие: ${member.registrationsPast}`,
    `Отменены: ${member.registrationsCancelled}`,
  ].join(" · ");
}

function formatDateTimeOrDash(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
