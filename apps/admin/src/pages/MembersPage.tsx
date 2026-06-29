import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import {
  getAdminUserProfile,
  listAdminUserRegistrations,
  listAdminUsers,
  setAdminUserMembership,
  updateAdminUserProfile,
} from "../services/adminMembersService";
import { useAdminAuth } from "../store/useAdminAuth";
import type { AdminBadgeTone } from "../types/admin";
import {
  ADMIN_MEMBER_MEMBERSHIP_ROLES,
  ADMIN_MEMBER_MEMBERSHIP_STATUSES,
  type AdminMemberBirthTimeContext,
  type AdminMemberMembershipRole,
  type AdminMemberMembershipStatus,
  type AdminMemberMaritalStatus,
  type AdminMemberListFilters,
  type AdminMemberListRow,
  type AdminMemberProfile,
  type AdminMemberRegistrationRow,
  type AdminMemberTribeStatus,
  type AdminUpdateUserProfileFields,
} from "../types/members";

type MembershipStatusFilter = NonNullable<AdminMemberListFilters["membershipStatus"]>;
type RoleFilter = NonNullable<AdminMemberListFilters["role"]>;

type MembersSummary = {
  active: number;
  noMembership: number;
  suspendedOrLeft: number;
  total: number;
};

type MemberProfileEditDraft = {
  about: string;
  birthDate: string;
  birthTimeContext: AdminMemberBirthTimeContext;
  city: string;
  displayName: string;
  email: string;
  firstName: string;
  fullName: string;
  hebrewBirthDate: string;
  hebrewName: string;
  lastName: string;
  maritalStatus: AdminMemberMaritalStatus | "";
  nusach: string;
  onboardingCompleted: boolean;
  phone: string;
  tribeStatus: AdminMemberTribeStatus | "";
};

type ProfileUpdateFieldsResult =
  | { fields: AdminUpdateUserProfileFields; ok: true }
  | { error: string; ok: false };

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
  { value: "all", label: "Все" },
  { value: "member", label: "Участник" },
  { value: "rabbi", label: "Раввин" },
  { value: "event_manager", label: "Менеджер событий" },
  { value: "admin", label: "Администратор" },
];

const ROLE_TONES: Record<string, AdminBadgeTone> = {
  admin: "red",
  event_manager: "gold",
  member: "blue",
  rabbi: "purple",
};

const MEMBERSHIP_ROLE_LABELS: Record<AdminMemberMembershipRole, string> = {
  admin: "Администратор",
  event_manager: "Менеджер событий",
  member: "Участник",
  rabbi: "Раввин",
};

const MEMBERSHIP_STATUS_LABELS: Record<AdminMemberMembershipStatus, string> = {
  active: "Активный",
  left: "Исключён / покинул",
  pending: "Ожидает",
  suspended: "Приостановлен",
};

const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  attended: "Пришёл",
  cancelled: "Отменена",
  confirmed: "Подтверждена",
  no_show: "Не пришёл",
  pending: "Заявка",
  rejected: "Отклонена",
  waitlisted: "Лист ожидания",
};

const HEBREW_MONTH_GENITIVE_LABELS: Record<string, string> = {
  "Адар I": "Адара I",
  "Адар II": "Адара II",
  Ав: "Ава",
  Адар: "Адара",
  Ияр: "Ияра",
  Кислев: "Кислева",
  Нисан: "Нисана",
  Сиван: "Сивана",
  Таммуз: "Таммуза",
  Тевет: "Тевета",
  Тишрей: "Тишрея",
  Хешван: "Хешвана",
  Шват: "Швата",
  Элул: "Элула",
};

const HEBREW_DATE_MAX_LABEL_LENGTH = 80;

const MEMBERSHIP_ROLE_OPTIONS = ADMIN_MEMBER_MEMBERSHIP_ROLES;
const MEMBERSHIP_STATUS_OPTIONS = ADMIN_MEMBER_MEMBERSHIP_STATUSES;
const MEMBERSHIP_LEFT_CONFIRM_MESSAGE =
  "Пользователь останется пользователем приложения, но потеряет членство в общине. Продолжить?";

const BIRTH_TIME_CONTEXT_OPTIONS: Array<{
  label: string;
  value: AdminMemberBirthTimeContext;
}> = [
  { value: "unknown", label: "Неизвестно" },
  { value: "before_sunset", label: "До захода солнца" },
  { value: "after_sunset", label: "После захода солнца" },
];

const TRIBE_STATUS_OPTIONS: Array<{
  label: string;
  value: AdminMemberTribeStatus;
}> = [
  { value: "kohen", label: "Коэн" },
  { value: "levi", label: "Леви" },
  { value: "israel", label: "Исраэль" },
];

const MARITAL_STATUS_OPTIONS: Array<{
  label: string;
  value: AdminMemberMaritalStatus;
}> = [
  { value: "single", label: "Не женат / не замужем" },
  { value: "married", label: "Женат / замужем" },
  { value: "divorced", label: "В разводе" },
  { value: "widowed", label: "Вдовец / вдова" },
  { value: "other", label: "Другое" },
];

export function MembersPage() {
  const auth = useAdminAuth();
  const communityId = auth.membership?.community_id ?? null;
  const requestSeq = useRef(0);
  const detailRequestSeq = useRef(0);

  const [members, setMembers] = useState<AdminMemberListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatusFilter>("all");
  const [role, setRole] = useState<RoleFilter>("all");
  const [selectedMember, setSelectedMember] = useState<AdminMemberListRow | null>(
    null,
  );
  const [selectedProfile, setSelectedProfile] =
    useState<AdminMemberProfile | null>(null);
  const [selectedRegistrations, setSelectedRegistrations] = useState<
    AdminMemberRegistrationRow[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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

  const loadMemberDetails = useCallback(
    async (member: AdminMemberListRow) => {
      const requestId = detailRequestSeq.current + 1;
      detailRequestSeq.current = requestId;

      setSelectedMember(member);
      setSelectedProfile(null);
      setSelectedRegistrations([]);
      setDetailLoading(true);
      setDetailError(null);

      if (!communityId) {
        setDetailLoading(false);
        setDetailError(COMMUNITY_ID_ERROR);
        return;
      }

      try {
        const [profile, registrations] = await Promise.all([
          getAdminUserProfile(member.userId, communityId),
          listAdminUserRegistrations(member.userId, communityId),
        ]);

        if (requestId === detailRequestSeq.current) {
          setSelectedProfile(profile);
          setSelectedRegistrations(registrations);
        }
      } catch (nextError) {
        if (requestId === detailRequestSeq.current) {
          setSelectedProfile(null);
          setSelectedRegistrations([]);
          setDetailError(
            nextError instanceof Error
              ? nextError.message
              : "Не удалось загрузить карточку участника.",
          );
        }
      } finally {
        if (requestId === detailRequestSeq.current) {
          setDetailLoading(false);
        }
      }
    },
    [communityId],
  );

  const closeMemberDetails = useCallback(() => {
    detailRequestSeq.current += 1;
    setSelectedMember(null);
    setSelectedProfile(null);
    setSelectedRegistrations([]);
    setDetailLoading(false);
    setDetailError(null);
  }, []);

  const retryMemberDetails = useCallback(() => {
    if (selectedMember) {
      void loadMemberDetails(selectedMember);
    }
  }, [loadMemberDetails, selectedMember]);

  const refreshMemberMembershipData = useCallback(
    async (member: AdminMemberListRow) => {
      if (!communityId) {
        throw new Error(COMMUNITY_ID_ERROR);
      }

      const detailRequestId = detailRequestSeq.current + 1;
      const listRequestId = requestSeq.current + 1;
      detailRequestSeq.current = detailRequestId;
      requestSeq.current = listRequestId;
      setDetailError(null);

      try {
        const [profile, registrations, nextMembers] = await Promise.all([
          getAdminUserProfile(member.userId, communityId),
          listAdminUserRegistrations(member.userId, communityId),
          listAdminUsers({
            communityId,
            search: search.trim() || null,
            membershipStatus,
            role,
            limit: MEMBERS_PAGE_SIZE,
            offset: 0,
          }),
        ]);

        if (detailRequestId === detailRequestSeq.current) {
          const refreshedMember =
            nextMembers.find((nextMember) => nextMember.userId === member.userId) ??
            profile;

          setSelectedMember((currentMember) =>
            currentMember?.userId === member.userId ? refreshedMember : currentMember,
          );
          setSelectedProfile(profile);
          setSelectedRegistrations(registrations);
        }

        if (listRequestId === requestSeq.current) {
          setMembers(nextMembers);
          setError(null);
          setLoading(false);
        }
      } catch (nextError) {
        if (detailRequestId === detailRequestSeq.current) {
          setDetailError(
            nextError instanceof Error
              ? nextError.message
              : "Не удалось обновить карточку участника.",
          );
        }

        if (listRequestId === requestSeq.current) {
          setLoading(false);
        }

        throw nextError;
      }
    },
    [communityId, membershipStatus, role, search],
  );

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
          <MembersTable members={members} onOpenMember={loadMemberDetails} />
        )}
      </GlassCard>

      {selectedMember ? (
        <MemberDetailDrawer
          communityId={communityId}
          detailError={detailError}
          detailLoading={detailLoading}
          member={selectedMember}
          onClose={closeMemberDetails}
          onMembershipChanged={refreshMemberMembershipData}
          onProfileChanged={refreshMemberMembershipData}
          onRetry={retryMemberDetails}
          profile={selectedProfile}
          registrations={selectedRegistrations}
        />
      ) : null}
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

function MembersTable({
  members,
  onOpenMember,
}: {
  members: AdminMemberListRow[];
  onOpenMember: (member: AdminMemberListRow) => void;
}) {
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
          <div
            aria-label={`Открыть карточку участника ${member.displayName}`}
            className="data-table__row data-table__row--member"
            key={member.userId}
            onClick={() => onOpenMember(member)}
            onKeyDown={(event) =>
              handleMemberRowKeyDown(event, member, onOpenMember)
            }
            role="row"
            tabIndex={0}
          >
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
            <div className="member-table-stack" role="cell">
              <span>{formatDateTimeOrDash(member.lastRegistrationAt)}</span>
              <small className="member-table-open">Открыть</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function handleMemberRowKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  member: AdminMemberListRow,
  onOpenMember: (member: AdminMemberListRow) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  onOpenMember(member);
}

function MemberDetailDrawer({
  communityId,
  detailError,
  detailLoading,
  member,
  onClose,
  onMembershipChanged,
  onProfileChanged,
  onRetry,
  profile,
  registrations,
}: {
  communityId: string | null;
  detailError: string | null;
  detailLoading: boolean;
  member: AdminMemberListRow;
  onClose: () => void;
  onMembershipChanged: (member: AdminMemberListRow) => Promise<void>;
  onProfileChanged: (member: AdminMemberListRow) => Promise<void>;
  onRetry: () => void;
  profile: AdminMemberProfile | null;
  registrations: AdminMemberRegistrationRow[];
}) {
  const detail = profile ?? member;
  const currentMembershipRole = normalizeMembershipRole(detail.membershipRole);
  const currentMembershipStatus = normalizeMembershipStatus(
    detail.membershipStatus,
  );
  const [membershipRole, setMembershipRole] =
    useState<AdminMemberMembershipRole>(() => currentMembershipRole);
  const [membershipStatusValue, setMembershipStatusValue] =
    useState<AdminMemberMembershipStatus>(() => currentMembershipStatus);
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [membershipSuccess, setMembershipSuccess] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState<MemberProfileEditDraft>(() =>
    createProfileEditDraft(member, profile),
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const hasMembershipChanges =
    Boolean(detail.membershipId) &&
    (membershipRole !== currentMembershipRole ||
      membershipStatusValue !== currentMembershipStatus);

  useEffect(() => {
    setMembershipRole(currentMembershipRole);
    setMembershipStatusValue(currentMembershipStatus);
  }, [currentMembershipRole, currentMembershipStatus, detail.userId]);

  useEffect(() => {
    setMembershipSaving(false);
    setMembershipError(null);
    setMembershipSuccess(null);
    setProfileEditing(false);
    setProfileDraft(createProfileEditDraft(member, profile));
    setProfileSaving(false);
    setProfileError(null);
  }, [detail.userId]);

  const saveMembership = useCallback(
    async ({
      role,
      status,
      successMessage,
    }: {
      role: AdminMemberMembershipRole;
      status: AdminMemberMembershipStatus;
      successMessage: string;
    }) => {
      if (!communityId) {
        setMembershipError(COMMUNITY_ID_ERROR);
        return;
      }

      setMembershipSaving(true);
      setMembershipError(null);
      setMembershipSuccess(null);

      try {
        await setAdminUserMembership({
          userId: detail.userId,
          communityId,
          role,
          status,
        });

        setMembershipRole(role);
        setMembershipStatusValue(status);
        await onMembershipChanged(detail);
        setMembershipSuccess(successMessage);
      } catch (nextError) {
        setMembershipError(
          nextError instanceof Error
            ? nextError.message
            : "Не удалось сохранить членство.",
        );
      } finally {
        setMembershipSaving(false);
      }
    },
    [communityId, detail, onMembershipChanged],
  );

  const startProfileEdit = useCallback(() => {
    setProfileDraft(createProfileEditDraft(member, profile));
    setProfileError(null);
    setProfileEditing(true);
  }, [member, profile]);

  const cancelProfileEdit = useCallback(() => {
    setProfileDraft(createProfileEditDraft(member, profile));
    setProfileError(null);
    setProfileEditing(false);
  }, [member, profile]);

  const saveProfile = useCallback(async () => {
    if (!communityId) {
      setProfileError(COMMUNITY_ID_ERROR);
      return;
    }

    const fieldsResult = buildProfileUpdateFields(detail, profileDraft);

    if (!fieldsResult.ok) {
      setProfileError(fieldsResult.error);
      return;
    }

    if (Object.keys(fieldsResult.fields).length === 0) {
      setProfileError("Нет изменений для сохранения.");
      return;
    }

    setProfileSaving(true);
    setProfileError(null);

    try {
      await updateAdminUserProfile({
        targetUserId: detail.userId,
        communityId,
        fields: fieldsResult.fields,
      });
      await onProfileChanged(detail);
      setProfileEditing(false);
    } catch (nextError) {
      setProfileError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось сохранить профиль.",
      );
    } finally {
      setProfileSaving(false);
    }
  }, [communityId, detail, onProfileChanged, profileDraft]);

  return (
    <div className="member-detail-backdrop" onClick={onClose}>
      <aside
        aria-labelledby="member-detail-title"
        aria-modal="true"
        className="member-detail-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="member-detail-drawer__head">
          <div className="member-detail-drawer__title">
            <span>Карточка участника</span>
            <h2 id="member-detail-title">{detail.displayName}</h2>
            <p>{detail.email ?? "email не указан"}</p>
            <div className="member-detail-badges" aria-label="Статус и роль">
              <Badge tone={getMembershipStatusTone(detail)}>
                {getMembershipStatusLabel(detail)}
              </Badge>
              {renderRoleBadge(detail, { emptyAsBadge: true })}
            </div>
          </div>
          <button
            aria-label="Закрыть карточку участника"
            className="member-detail-drawer__close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="member-detail-drawer__body">
          {detailLoading ? (
            <MemberDetailState title="Загружаем карточку участника..." />
          ) : detailError ? (
            <MemberDetailState
              description={detailError}
              title="Не удалось загрузить карточку участника"
            >
              <Button onClick={onRetry} variant="primary">
                Повторить
              </Button>
            </MemberDetailState>
          ) : (
            <>
              <MemberProfileSection
                draft={profileDraft}
                error={profileError}
                isEditing={profileEditing}
                member={member}
                onCancelEdit={cancelProfileEdit}
                onDraftChange={setProfileDraft}
                onSaveEdit={saveProfile}
                onStartEdit={startProfileEdit}
                profile={profile}
                saving={profileSaving}
              />
              <MemberMembershipSection member={member} profile={profile} />
              {communityId ? (
                <MemberMembershipActions
                  currentMembershipStatus={currentMembershipStatus}
                  hasMembershipChanges={hasMembershipChanges}
                  member={detail}
                  membershipError={membershipError}
                  membershipRole={membershipRole}
                  membershipSaving={membershipSaving}
                  membershipStatus={membershipStatusValue}
                  membershipSuccess={membershipSuccess}
                  onCreateMembership={() =>
                    void saveMembership({
                      role: "member",
                      status: "active",
                      successMessage: "Пользователь стал участником общины.",
                    })
                  }
                  onMembershipRoleChange={setMembershipRole}
                  onMembershipStatusChange={setMembershipStatusValue}
                  onQuickStatusChange={(status, successMessage) =>
                    void saveMembership({
                      role: currentMembershipRole,
                      status,
                      successMessage,
                    })
                  }
                  onSaveMembership={() =>
                    void saveMembership({
                      role: membershipRole,
                      status: membershipStatusValue,
                      successMessage: "Изменения членства сохранены.",
                    })
                  }
                />
              ) : null}
              <MemberRegistrationsSection
                profile={profile}
                registrations={registrations}
              />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function MemberProfileSection({
  draft,
  error,
  isEditing,
  member,
  onCancelEdit,
  onDraftChange,
  onSaveEdit,
  onStartEdit,
  profile,
  saving,
}: {
  draft: MemberProfileEditDraft;
  error: string | null;
  isEditing: boolean;
  member: AdminMemberListRow;
  onCancelEdit: () => void;
  onDraftChange: (draft: MemberProfileEditDraft) => void;
  onSaveEdit: () => void;
  onStartEdit: () => void;
  profile: AdminMemberProfile | null;
  saving: boolean;
}) {
  const detail = profile ?? member;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSaveEdit();
  };

  if (isEditing) {
    return (
      <MemberDetailSection title="Профиль">
        <form className="member-membership-editor" onSubmit={handleSubmit}>
          <div className="member-membership-actions">
            <Button disabled={saving} onClick={onCancelEdit} variant="ghost">
              Отмена
            </Button>
            <Button disabled={saving} type="submit" variant="primary">
              {saving ? "Сохраняем..." : "Сохранить"}
            </Button>
          </div>

          {error ? (
            <p
              className="member-membership-feedback member-membership-feedback--error"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <MemberProfileForm
            disabled={saving}
            draft={draft}
            onChange={onDraftChange}
          />
        </form>
      </MemberDetailSection>
    );
  }

  return (
    <MemberDetailSection title="Профиль">
      <div className="member-membership-actions">
        <Button onClick={onStartEdit} size="sm" variant="primary">
          Редактировать
        </Button>
      </div>

      <div className="member-detail-grid">
        <MemberDetailField label="Полное имя">
          {formatTextOrDash(profile?.fullName)}
        </MemberDetailField>
        <MemberDetailField label="Имя">
          {formatTextOrDash(detail.firstName)}
        </MemberDetailField>
        <MemberDetailField label="Фамилия">
          {formatTextOrDash(detail.lastName)}
        </MemberDetailField>
        <MemberDetailField label="Отображаемое имя">
          {formatTextOrDash(detail.displayName)}
        </MemberDetailField>
        <MemberDetailField label="Еврейское имя">
          {formatTextOrDash(profile?.hebrewName)}
        </MemberDetailField>
        <MemberDetailField label="Email профиля">
          {formatTextOrDash(detail.email)}
        </MemberDetailField>
        <MemberDetailField label="Телефон">
          {formatTextOrDash(detail.phone)}
        </MemberDetailField>
        <MemberDetailField label="Город">{formatTextOrDash(detail.city)}</MemberDetailField>
        <MemberDetailField label="Дата рождения">
          {formatDateOrDash(detail.birthDate)}
        </MemberDetailField>
        <MemberDetailField label="Еврейская дата рождения" wide>
          {formatHebrewDateOrDash(detail.hebrewBirthDate)}
        </MemberDetailField>
        <MemberDetailField label="Время рождения">
          {formatBirthTimeContextLabel(profile?.birthTimeContext)}
        </MemberDetailField>
        <MemberDetailField label="Нусах">
          {formatTextOrDash(detail.nusach)}
        </MemberDetailField>
        <MemberDetailField label="Статус происхождения">
          {formatTribeStatusLabel(profile?.tribeStatus)}
        </MemberDetailField>
        <MemberDetailField label="Семейное положение">
          {formatMaritalStatusLabel(profile?.maritalStatus)}
        </MemberDetailField>
        <MemberDetailField label="О себе" multiline wide>
          {formatTextOrDash(profile?.about)}
        </MemberDetailField>
        <MemberDetailField label="Онбординг завершён">
          {formatBoolean(detail.onboardingCompleted)}
        </MemberDetailField>
      </div>
    </MemberDetailSection>
  );
}

function MemberProfileForm({
  disabled,
  draft,
  onChange,
}: {
  disabled: boolean;
  draft: MemberProfileEditDraft;
  onChange: (draft: MemberProfileEditDraft) => void;
}) {
  const updateDraft = <Key extends keyof MemberProfileEditDraft>(
    key: Key,
    value: MemberProfileEditDraft[Key],
  ) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div className="member-detail-grid">
      <label className="event-form-field">
        <span>Полное имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("fullName", event.target.value)}
          type="text"
          value={draft.fullName}
        />
      </label>

      <label className="event-form-field">
        <span>Имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("firstName", event.target.value)}
          type="text"
          value={draft.firstName}
        />
      </label>

      <label className="event-form-field">
        <span>Фамилия</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("lastName", event.target.value)}
          type="text"
          value={draft.lastName}
        />
      </label>

      <label className="event-form-field">
        <span>Отображаемое имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("displayName", event.target.value)}
          type="text"
          value={draft.displayName}
        />
      </label>

      <label className="event-form-field">
        <span>Еврейское имя</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("hebrewName", event.target.value)}
          type="text"
          value={draft.hebrewName}
        />
      </label>

      <label className="event-form-field">
        <span>Email профиля</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("email", event.target.value)}
          type="text"
          value={draft.email}
        />
      </label>

      <label className="event-form-field">
        <span>Телефон</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("phone", event.target.value)}
          type="tel"
          value={draft.phone}
        />
      </label>

      <label className="event-form-field">
        <span>Город</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("city", event.target.value)}
          type="text"
          value={draft.city}
        />
      </label>

      <label className="event-form-field">
        <span>Дата рождения</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("birthDate", event.target.value)}
          type="date"
          value={draft.birthDate}
        />
      </label>

      <label className="event-form-field">
        <span>Время рождения</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft(
              "birthTimeContext",
              event.target.value as AdminMemberBirthTimeContext,
            )
          }
          value={draft.birthTimeContext}
        >
          {BIRTH_TIME_CONTEXT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="event-form-field">
        <span>Нусах</span>
        <input
          disabled={disabled}
          onChange={(event) => updateDraft("nusach", event.target.value)}
          type="text"
          value={draft.nusach}
        />
      </label>

      <label className="event-form-field">
        <span>Статус происхождения</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft(
              "tribeStatus",
              event.target.value as AdminMemberTribeStatus | "",
            )
          }
          value={draft.tribeStatus}
        >
          <option value="">Не указано</option>
          {TRIBE_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="event-form-field">
        <span>Семейное положение</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft(
              "maritalStatus",
              event.target.value as AdminMemberMaritalStatus | "",
            )
          }
          value={draft.maritalStatus}
        >
          <option value="">Не указано</option>
          {MARITAL_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="event-form-field">
        <span>Онбординг завершён</span>
        <select
          disabled={disabled}
          onChange={(event) =>
            updateDraft("onboardingCompleted", event.target.value === "true")
          }
          value={draft.onboardingCompleted ? "true" : "false"}
        >
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </select>
      </label>

      <label className="event-form-field event-form-field--wide">
        <span>Еврейская дата рождения (JSON)</span>
        <textarea
          disabled={disabled}
          onChange={(event) =>
            updateDraft("hebrewBirthDate", event.target.value)
          }
          placeholder='{"day":10,"monthNameRu":"Хешван","year":5746}'
          value={draft.hebrewBirthDate}
        />
      </label>

      <label className="event-form-field event-form-field--wide">
        <span>О себе</span>
        <textarea
          disabled={disabled}
          maxLength={200}
          onChange={(event) => updateDraft("about", event.target.value)}
          value={draft.about}
        />
      </label>
    </div>
  );
}

function MemberMembershipSection({
  member,
  profile,
}: {
  member: AdminMemberListRow;
  profile: AdminMemberProfile | null;
}) {
  const detail = profile ?? member;

  return (
    <MemberDetailSection title="Членство">
      {!detail.membershipId ? (
        <p className="member-detail-empty">
          Пользователь зарегистрирован в приложении, но не является членом этой
          общины.
        </p>
      ) : (
        <div className="member-detail-grid">
          <MemberDetailField label="ID членства">
            {formatTextOrDash(detail.membershipId)}
          </MemberDetailField>
          <MemberDetailField label="ID общины">
            {formatTextOrDash(profile?.membershipCommunityId ?? detail.communityId)}
          </MemberDetailField>
          <MemberDetailField label="Роль">
            {getMembershipRoleLabel(detail.membershipRole)}
          </MemberDetailField>
          <MemberDetailField label="Статус">
            {getMembershipStatusValueLabel(detail.membershipStatus)}
          </MemberDetailField>
          <MemberDetailField label="Дата вступления">
            {formatDateTimeOrDash(detail.joinedAt)}
          </MemberDetailField>
          <MemberDetailField label="Кто пригласил">
            {formatTextOrDash(detail.invitedBy)}
          </MemberDetailField>
          <MemberDetailField label="Членство создано">
            {formatDateTimeOrDash(profile?.membershipCreatedAt ?? null)}
          </MemberDetailField>
        </div>
      )}
    </MemberDetailSection>
  );
}

function MemberMembershipActions({
  currentMembershipStatus,
  hasMembershipChanges,
  member,
  membershipError,
  membershipRole,
  membershipSaving,
  membershipStatus,
  membershipSuccess,
  onCreateMembership,
  onMembershipRoleChange,
  onMembershipStatusChange,
  onQuickStatusChange,
  onSaveMembership,
}: {
  currentMembershipStatus: AdminMemberMembershipStatus;
  hasMembershipChanges: boolean;
  member: AdminMemberListRow;
  membershipError: string | null;
  membershipRole: AdminMemberMembershipRole;
  membershipSaving: boolean;
  membershipStatus: AdminMemberMembershipStatus;
  membershipSuccess: string | null;
  onCreateMembership: () => void;
  onMembershipRoleChange: (role: AdminMemberMembershipRole) => void;
  onMembershipStatusChange: (status: AdminMemberMembershipStatus) => void;
  onQuickStatusChange: (
    status: AdminMemberMembershipStatus,
    successMessage: string,
  ) => void;
  onSaveMembership: () => void;
}) {
  const handleExcludeFromCommunity = () => {
    if (window.confirm(MEMBERSHIP_LEFT_CONFIRM_MESSAGE)) {
      onQuickStatusChange(
        "left",
        "Пользователь исключён из общины, но профиль сохранён.",
      );
    }
  };
  const canActivate = currentMembershipStatus === "pending";
  const canRestore =
    currentMembershipStatus === "suspended" || currentMembershipStatus === "left";
  const canSuspend =
    currentMembershipStatus === "active" || currentMembershipStatus === "pending";
  const canExclude =
    currentMembershipStatus === "active" ||
    currentMembershipStatus === "pending" ||
    currentMembershipStatus === "suspended";

  return (
    <MemberDetailSection title="Действия с членством">
      {!member.membershipId ? (
        <div className="member-membership-action-panel">
          <div>
            <strong>Пользователь приложения</strong>
            <p>
              Этот пользователь зарегистрирован в приложении, но ещё не является
              членом общины.
            </p>
          </div>
          <Button
            disabled={membershipSaving}
            onClick={onCreateMembership}
            variant="primary"
          >
            {membershipSaving ? "Сохраняем..." : "Сделать участником"}
          </Button>
        </div>
      ) : (
        <div className="member-membership-editor">
          <div className="member-membership-fields">
            <label className="member-membership-field">
              <span>Роль</span>
              <select
                disabled={membershipSaving}
                onChange={(event) =>
                  onMembershipRoleChange(event.target.value as AdminMemberMembershipRole)
                }
                value={membershipRole}
              >
                {MEMBERSHIP_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {getMembershipRoleLabel(role)}
                  </option>
                ))}
              </select>
            </label>

            <label className="member-membership-field">
              <span>Статус</span>
              <select
                disabled={membershipSaving}
                onChange={(event) =>
                  onMembershipStatusChange(
                    event.target.value as AdminMemberMembershipStatus,
                  )
                }
                value={membershipStatus}
              >
                {MEMBERSHIP_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {getMembershipStatusValueLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="member-membership-actions">
            <Button
              disabled={membershipSaving || !hasMembershipChanges}
              onClick={onSaveMembership}
              variant="primary"
            >
              {membershipSaving ? "Сохраняем..." : "Сохранить изменения"}
            </Button>
          </div>

          <div className="member-membership-quick-actions" aria-label="Быстрые действия с членством">
            {canActivate ? (
              <Button
                disabled={membershipSaving}
                onClick={() =>
                  onQuickStatusChange("active", "Членство восстановлено.")
                }
                size="sm"
                variant="success"
              >
                Активировать
              </Button>
            ) : null}
            {canRestore ? (
              <Button
                disabled={membershipSaving}
                onClick={() =>
                  onQuickStatusChange("active", "Членство восстановлено.")
                }
                size="sm"
                variant="success"
              >
                Восстановить
              </Button>
            ) : null}
            {canSuspend ? (
              <Button
                disabled={membershipSaving}
                onClick={() =>
                  onQuickStatusChange("suspended", "Членство приостановлено.")
                }
                size="sm"
              >
                Приостановить
              </Button>
            ) : null}
            {canExclude ? (
              <Button
                disabled={membershipSaving}
                onClick={handleExcludeFromCommunity}
                size="sm"
                variant="primary"
              >
                Исключить из общины
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <MemberMembershipFeedback
        error={membershipError}
        saving={membershipSaving}
        success={membershipSuccess}
      />
    </MemberDetailSection>
  );
}

function MemberMembershipFeedback({
  error,
  saving,
  success,
}: {
  error: string | null;
  saving: boolean;
  success: string | null;
}) {
  if (saving) {
    return (
      <p className="member-membership-feedback" role="status">
        Сохраняем...
      </p>
    );
  }

  if (error) {
    return (
      <p className="member-membership-feedback member-membership-feedback--error" role="alert">
        {error}
      </p>
    );
  }

  if (success) {
    return (
      <p className="member-membership-feedback member-membership-feedback--success" role="status">
        {success}
      </p>
    );
  }

  return null;
}

function MemberRegistrationsSection({
  profile,
  registrations,
}: {
  profile: AdminMemberProfile | null;
  registrations: AdminMemberRegistrationRow[];
}) {
  return (
    <MemberDetailSection title="Регистрации">
      {profile ? (
        <div className="member-detail-counters" aria-label="Сводка регистраций">
          <MemberDetailCounter label="Всего" value={profile.registrationsTotal} />
          <MemberDetailCounter label="Будущие" value={profile.registrationsUpcoming} />
          <MemberDetailCounter label="Прошедшие" value={profile.registrationsPast} />
          <MemberDetailCounter
            label="Отменены"
            value={profile.registrationsCancelled}
          />
        </div>
      ) : null}

      {registrations.length === 0 ? (
        <p className="member-detail-empty">Записей на события пока нет.</p>
      ) : (
        <div className="member-registration-list">
          {registrations.map((registration) => (
            <MemberRegistrationCard
              key={registration.registrationId}
              registration={registration}
            />
          ))}
        </div>
      )}
    </MemberDetailSection>
  );
}

function MemberRegistrationCard({
  registration,
}: {
  registration: AdminMemberRegistrationRow;
}) {
  const selectedOptions = formatSelectedOptions(registration);

  return (
    <article className="member-registration-card">
      <div className="member-registration-card__head">
        <div>
          <strong>{registration.eventTitle}</strong>
          {registration.occurrenceTitle ? (
            <span>{registration.occurrenceTitle}</span>
          ) : null}
        </div>
        <Badge tone={getRegistrationStatusTone(registration.registrationStatus)}>
          {getRegistrationStatusLabel(registration.registrationStatus)}
        </Badge>
      </div>

      <div className="member-detail-grid member-detail-grid--compact">
        <MemberDetailField label="Дата события">
          {formatDateTimeOrDash(registration.occurrenceStartsAt)}
        </MemberDetailField>
        <MemberDetailField label="Мест">
          {String(registration.seatsCount)}
        </MemberDetailField>
        <MemberDetailField label="Статус оплаты">
          {formatTextOrDash(registration.paymentStatus)}
        </MemberDetailField>
        <MemberDetailField label="Дата записи">
          {formatDateTimeOrDash(registration.registeredAt)}
        </MemberDetailField>
        {selectedOptions ? (
          <MemberDetailField label="Выбранные варианты" wide>
            {selectedOptions}
          </MemberDetailField>
        ) : null}
      </div>
    </article>
  );
}

function MemberDetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="member-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MemberDetailField({
  children,
  label,
  multiline = false,
  wide = false,
}: {
  children: ReactNode;
  label: string;
  multiline?: boolean;
  wide?: boolean;
}) {
  const classes = [
    "member-detail-field",
    multiline ? "member-detail-field--multiline" : null,
    wide ? "member-detail-field--wide" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function MemberDetailCounter({ label, value }: { label: string; value: number }) {
  return (
    <div className="member-detail-counter">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MemberDetailState({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="member-detail-state" role={description ? "alert" : "status"}>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {children ? <div className="events-state__actions">{children}</div> : null}
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

function renderRoleBadge(
  member: AdminMemberListRow,
  options: { emptyAsBadge?: boolean } = {},
): ReactNode {
  if (!member.membershipId || !member.membershipRole) {
    if (options.emptyAsBadge) {
      return <Badge tone="muted">—</Badge>;
    }

    return <span className="member-table-muted">—</span>;
  }

  return (
    <Badge tone={getRoleTone(member.membershipRole)}>
      {getMembershipRoleLabel(member.membershipRole)}
    </Badge>
  );
}

function getRoleTone(role: string): AdminBadgeTone {
  return ROLE_TONES[role] ?? "muted";
}

function getMembershipRoleLabel(role: string | null | undefined): string {
  if (!role) {
    return "—";
  }

  return MEMBERSHIP_ROLE_LABELS[role as AdminMemberMembershipRole] ?? role;
}

function getMembershipStatusValueLabel(status: string | null | undefined): string {
  if (!status) {
    return "—";
  }

  return (
    MEMBERSHIP_STATUS_LABELS[status as AdminMemberMembershipStatus] ?? status
  );
}

function getRegistrationStatusLabel(status: string): string {
  return REGISTRATION_STATUS_LABELS[status] ?? status;
}

function normalizeMembershipRole(
  role: AdminMemberListRow["membershipRole"],
): AdminMemberMembershipRole {
  return MEMBERSHIP_ROLE_OPTIONS.some((option) => option === role)
    ? (role as AdminMemberMembershipRole)
    : "member";
}

function normalizeMembershipStatus(
  status: AdminMemberListRow["membershipStatus"],
): AdminMemberMembershipStatus {
  return MEMBERSHIP_STATUS_OPTIONS.some((option) => option === status)
    ? (status as AdminMemberMembershipStatus)
    : "active";
}

function createProfileEditDraft(
  member: AdminMemberListRow,
  profile: AdminMemberProfile | null,
): MemberProfileEditDraft {
  const detail = profile ?? member;

  return {
    about: profile?.about ?? "",
    birthDate: formatDateInputValue(detail.birthDate),
    birthTimeContext: normalizeBirthTimeContextDraft(profile?.birthTimeContext),
    city: detail.city ?? "",
    displayName: detail.displayName ?? "",
    email: detail.email ?? "",
    firstName: detail.firstName ?? "",
    fullName: profile?.fullName ?? "",
    hebrewBirthDate: formatJsonForEdit(detail.hebrewBirthDate),
    hebrewName: profile?.hebrewName ?? "",
    lastName: detail.lastName ?? "",
    maritalStatus: normalizeMaritalStatusDraft(profile?.maritalStatus),
    nusach: detail.nusach ?? "",
    onboardingCompleted: detail.onboardingCompleted,
    phone: detail.phone ?? "",
    tribeStatus: normalizeTribeStatusDraft(profile?.tribeStatus),
  };
}

function buildProfileUpdateFields(
  detail: AdminMemberListRow | AdminMemberProfile,
  draft: MemberProfileEditDraft,
): ProfileUpdateFieldsResult {
  const hebrewBirthDateResult = parseHebrewBirthDateDraft(draft.hebrewBirthDate);

  if (!hebrewBirthDateResult.ok) {
    return hebrewBirthDateResult;
  }

  const fields: AdminUpdateUserProfileFields = {};
  const currentFullName = "fullName" in detail ? detail.fullName : null;
  const currentHebrewName = "hebrewName" in detail ? detail.hebrewName : null;
  const currentBirthTimeContext =
    "birthTimeContext" in detail ? detail.birthTimeContext : null;
  const currentTribeStatus = "tribeStatus" in detail ? detail.tribeStatus : null;
  const currentMaritalStatus =
    "maritalStatus" in detail ? detail.maritalStatus : null;
  const currentAbout = "about" in detail ? detail.about : null;

  const fullName = nullableTrimmedString(draft.fullName);
  if (fullName !== nullableTrimmedString(currentFullName)) {
    fields.fullName = fullName;
  }

  const firstName = nullableTrimmedString(draft.firstName);
  if (firstName !== nullableTrimmedString(detail.firstName)) {
    fields.firstName = firstName;
  }

  const lastName = nullableTrimmedString(draft.lastName);
  if (lastName !== nullableTrimmedString(detail.lastName)) {
    fields.lastName = lastName;
  }

  const displayName = nullableTrimmedString(draft.displayName);
  if (displayName !== nullableTrimmedString(detail.displayName)) {
    fields.displayName = displayName;
  }

  const hebrewName = nullableTrimmedString(draft.hebrewName);
  if (hebrewName !== nullableTrimmedString(currentHebrewName)) {
    fields.hebrewName = hebrewName;
  }

  const email = nullableTrimmedString(draft.email);
  if (email !== nullableTrimmedString(detail.email)) {
    fields.email = email;
  }

  const phone = nullableTrimmedString(draft.phone);
  if (phone !== nullableTrimmedString(detail.phone)) {
    fields.phone = phone;
  }

  const city = nullableTrimmedString(draft.city);
  if (city !== nullableTrimmedString(detail.city)) {
    fields.city = city;
  }

  const birthDate = nullableTrimmedString(draft.birthDate);
  if (birthDate !== nullableTrimmedString(formatDateInputValue(detail.birthDate))) {
    fields.birthDate = birthDate;
  }

  if (
    !areJsonRecordsEqual(hebrewBirthDateResult.value, detail.hebrewBirthDate)
  ) {
    fields.hebrewBirthDate = hebrewBirthDateResult.value;
  }

  if (
    draft.birthTimeContext !==
    normalizeBirthTimeContextDraft(currentBirthTimeContext)
  ) {
    fields.birthTimeContext = draft.birthTimeContext;
  }

  const nusach = nullableTrimmedString(draft.nusach);
  if (nusach !== nullableTrimmedString(detail.nusach)) {
    fields.nusach = nusach;
  }

  const tribeStatus = draft.tribeStatus || null;
  if (tribeStatus !== (normalizeTribeStatusDraft(currentTribeStatus) || null)) {
    fields.tribeStatus = tribeStatus;
  }

  const maritalStatus = draft.maritalStatus || null;
  if (
    maritalStatus !== (normalizeMaritalStatusDraft(currentMaritalStatus) || null)
  ) {
    fields.maritalStatus = maritalStatus;
  }

  const about = nullableTrimmedString(draft.about);
  if (about !== nullableTrimmedString(currentAbout)) {
    fields.about = about;
  }

  if (draft.onboardingCompleted !== detail.onboardingCompleted) {
    fields.onboardingCompleted = draft.onboardingCompleted;
  }

  return { fields, ok: true };
}

function parseHebrewBirthDateDraft(
  value: string,
): { ok: true; value: Record<string, unknown> | null } | { error: string; ok: false } {
  const normalized = value.trim();

  if (!normalized) {
    return { ok: true, value: null };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch {
    return {
      error: "Еврейская дата рождения должна быть корректным JSON-объектом.",
      ok: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      error: "Еврейская дата рождения должна быть JSON-объектом или пустым значением.",
      ok: false,
    };
  }

  return { ok: true, value: parsed };
}

function nullableTrimmedString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";

  return normalized.length > 0 ? normalized : null;
}

function formatDateInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const dateMatch = value.match(/^\d{4}-\d{2}-\d{2}/);

  if (dateMatch) {
    return dateMatch[0];
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatJsonForEdit(value: Record<string, unknown> | null): string {
  if (!value) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function areJsonRecordsEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeBirthTimeContextDraft(
  value: string | null | undefined,
): AdminMemberBirthTimeContext {
  return BIRTH_TIME_CONTEXT_OPTIONS.some((option) => option.value === value)
    ? (value as AdminMemberBirthTimeContext)
    : "unknown";
}

function normalizeTribeStatusDraft(
  value: string | null | undefined,
): AdminMemberTribeStatus | "" {
  return TRIBE_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as AdminMemberTribeStatus)
    : "";
}

function normalizeMaritalStatusDraft(
  value: string | null | undefined,
): AdminMemberMaritalStatus | "" {
  return MARITAL_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as AdminMemberMaritalStatus)
    : "";
}

function formatBirthTimeContextLabel(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return (
    BIRTH_TIME_CONTEXT_OPTIONS.find((option) => option.value === value)?.label ??
    value
  );
}

function formatTribeStatusLabel(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return (
    TRIBE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

function formatMaritalStatusLabel(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return (
    MARITAL_STATUS_OPTIONS.find((option) => option.value === value)?.label ??
    value
  );
}

function getMembershipStatusLabel(member: AdminMemberListRow): string {
  if (!member.membershipId) {
    return "Пользователь приложения";
  }

  return getMembershipStatusValueLabel(member.membershipStatus);
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

function getRegistrationStatusTone(status: string): AdminBadgeTone {
  if (status === "confirmed" || status === "attended") {
    return "green";
  }

  if (status === "pending" || status === "waitlisted") {
    return "gold";
  }

  if (status === "rejected" || status === "cancelled") {
    return "red";
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

function formatDateOrDash(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
  }).format(date);
}

function formatTextOrDash(value: string | null | undefined): string {
  if (!value || value.trim().length === 0) {
    return "—";
  }

  return value;
}

function formatHebrewDateOrDash(value: unknown): string {
  if (value == null) {
    return "—";
  }

  if (typeof value === "string") {
    return formatHebrewDateStringOrDash(value);
  }

  if (!isRecord(value)) {
    return "—";
  }

  const labelRu = readNonEmptyString(value.labelRu);

  if (labelRu) {
    return formatHebrewDateStringOrDash(labelRu);
  }

  const day = readHebrewDateNumber(value.day);
  const monthNameRu = readNonEmptyString(value.monthNameRu);
  const year = readHebrewDateNumber(value.year);

  if (!day || !monthNameRu || !year) {
    return "—";
  }

  return `${day} ${formatHebrewMonthGenitive(monthNameRu)} ${year}`;
}

function formatHebrewDateStringOrDash(value: string): string {
  const formatted = normalizeHebrewDateLabelRu(value.trim());

  if (
    formatted.length === 0 ||
    formatted.length > HEBREW_DATE_MAX_LABEL_LENGTH ||
    formatted.startsWith("{") ||
    formatted.startsWith("[")
  ) {
    return "—";
  }

  return formatted;
}

function normalizeHebrewDateLabelRu(value: string): string {
  const match = value.match(/^(\d{1,2})\s+(.+?)\s+(\d{3,4})$/u);

  if (!match) {
    return value;
  }

  const [, day, monthNameRu, year] = match;

  return `${day} ${formatHebrewMonthGenitive(monthNameRu)} ${year}`;
}

function formatHebrewMonthGenitive(monthNameRu: string): string {
  const normalized = monthNameRu.trim().replace(/\s+/g, " ");

  return HEBREW_MONTH_GENITIVE_LABELS[normalized] ?? normalized;
}

function readHebrewDateNumber(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^\d+$/.test(normalized) ? normalized : null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBoolean(value: boolean): string {
  return value ? "Да" : "Нет";
}

function formatSelectedOptions(registration: AdminMemberRegistrationRow): string | null {
  if (registration.selectedOptions.length === 0) {
    return null;
  }

  return registration.selectedOptions
    .map((option) => `${option.title} x ${option.quantity}`)
    .join(", ");
}
