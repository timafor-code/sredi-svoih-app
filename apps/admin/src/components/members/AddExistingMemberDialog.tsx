import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  getAdminUserProfile,
  listAdminUsers,
  setAdminUserMembership,
  updateAdminUserProfile,
} from "../../services/adminMembersService";
import {
  ADMIN_MEMBER_MEMBERSHIP_ROLES,
  type AdminMemberListRow,
  type AdminMemberMembershipRole,
  type AdminMemberMembershipStatus,
  type AdminMemberProfile,
} from "../../types/members";
import {
  AdminMemberProfileForm,
  buildAdminMemberProfileUpdateFields,
  createAdminMemberProfileDraft,
  type AdminMemberProfileDraft,
} from "./AdminMemberProfileForm";

type AddExistingMemberDialogProps = {
  communityId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

const ADD_MEMBER_SEARCH_LIMIT = 30;
const COMMUNITY_ID_ERROR =
  "Не удалось определить communityId текущей активной membership.";
const ADD_MEMBER_STATUSES = ["active", "pending"] as const satisfies readonly AdminMemberMembershipStatus[];

type AddMemberStatus = (typeof ADD_MEMBER_STATUSES)[number];

const MEMBERSHIP_ROLE_LABELS: Record<AdminMemberMembershipRole, string> = {
  admin: "Администратор",
  event_manager: "Менеджер событий",
  member: "Участник",
  rabbi: "Раввин",
};

const ADD_MEMBER_STATUS_LABELS: Record<AddMemberStatus, string> = {
  active: "Активный",
  pending: "Ожидает",
};

export function AddExistingMemberDialog({
  communityId,
  onClose,
  onSaved,
}: AddExistingMemberDialogProps) {
  const searchRequestSeq = useRef(0);
  const profileRequestSeq = useRef(0);

  const [search, setSearch] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<AdminMemberListRow[]>([]);
  const [selectedMember, setSelectedMember] =
    useState<AdminMemberListRow | null>(null);
  const [selectedProfile, setSelectedProfile] =
    useState<AdminMemberProfile | null>(null);
  const [profileDraft, setProfileDraft] =
    useState<AdminMemberProfileDraft | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [membershipRole, setMembershipRole] =
    useState<AdminMemberMembershipRole>("member");
  const [membershipStatus, setMembershipStatus] =
    useState<AddMemberStatus>("active");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedDetail = selectedProfile ?? selectedMember;
  const canSave =
    Boolean(communityId) &&
    Boolean(selectedDetail) &&
    Boolean(profileDraft) &&
    !profileLoading &&
    !saving;

  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => !profile.membershipId),
    [profiles],
  );

  useEffect(() => {
    setSearch("");
    setSearched(false);
    setSearchLoading(false);
    setSearchError(null);
    setProfiles([]);
    setSelectedMember(null);
    setSelectedProfile(null);
    setProfileDraft(null);
    setProfileLoading(false);
    setProfileError(null);
    setMembershipRole("member");
    setMembershipStatus("active");
    setSaving(false);
    setSaveError(null);
  }, [communityId]);

  const runSearch = useCallback(async () => {
    const requestId = searchRequestSeq.current + 1;
    searchRequestSeq.current = requestId;
    setSearched(true);

    if (!communityId) {
      setProfiles([]);
      setSearchError(COMMUNITY_ID_ERROR);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const nextProfiles = await listAdminUsers({
        communityId,
        limit: ADD_MEMBER_SEARCH_LIMIT,
        membershipStatus: "no_membership",
        offset: 0,
        search: search.trim() || null,
      });

      if (requestId === searchRequestSeq.current) {
        setProfiles(nextProfiles.filter((profile) => !profile.membershipId));
      }
    } catch (nextError) {
      if (requestId === searchRequestSeq.current) {
        setProfiles([]);
        setSearchError(
          nextError instanceof Error
            ? nextError.message
            : "Не удалось найти профили приложения.",
        );
      }
    } finally {
      if (requestId === searchRequestSeq.current) {
        setSearchLoading(false);
      }
    }
  }, [communityId, search]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch();
  };

  const selectProfile = useCallback(
    async (member: AdminMemberListRow) => {
      const requestId = profileRequestSeq.current + 1;
      profileRequestSeq.current = requestId;

      setSelectedMember(member);
      setSelectedProfile(null);
      setProfileDraft(null);
      setProfileLoading(true);
      setProfileError(null);
      setSaveError(null);

      if (!communityId) {
        setProfileLoading(false);
        setProfileError(COMMUNITY_ID_ERROR);
        return;
      }

      try {
        const profile = await getAdminUserProfile(member.userId, communityId);

        if (requestId !== profileRequestSeq.current) {
          return;
        }

        if (profile.membershipId) {
          setProfileError(
            "У этого профиля уже есть членство в текущей общине.",
          );
          setSelectedProfile(profile);
          setProfileDraft(null);
          return;
        }

        setSelectedProfile(profile);
        setProfileDraft(createAdminMemberProfileDraft(profile, profile));
      } catch (nextError) {
        if (requestId === profileRequestSeq.current) {
          setProfileError(
            nextError instanceof Error
              ? nextError.message
              : "Не удалось загрузить профиль приложения.",
          );
        }
      } finally {
        if (requestId === profileRequestSeq.current) {
          setProfileLoading(false);
        }
      }
    },
    [communityId],
  );

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!communityId) {
      setSaveError(COMMUNITY_ID_ERROR);
      return;
    }

    if (!selectedDetail || !profileDraft) {
      setSaveError("Выберите профиль приложения для добавления в общину.");
      return;
    }

    const fieldsResult = buildAdminMemberProfileUpdateFields(
      selectedDetail,
      profileDraft,
    );

    if (!fieldsResult.ok) {
      setSaveError(fieldsResult.error);
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (Object.keys(fieldsResult.fields).length > 0) {
        await updateAdminUserProfile({
          communityId,
          fields: fieldsResult.fields,
          targetUserId: selectedDetail.userId,
        });
      }

      await setAdminUserMembership({
        communityId,
        role: membershipRole,
        status: membershipStatus,
        userId: selectedDetail.userId,
      });

      await onSaved();
      onClose();
    } catch (nextError) {
      setSaveError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось добавить участника в общину.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="member-add-backdrop" onClick={onClose}>
      <section
        aria-labelledby="member-add-title"
        aria-modal="true"
        className="member-add-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="member-add-dialog__head">
          <div>
            <span>Профиль приложения</span>
            <h2 id="member-add-title">Добавить участника</h2>
            <p>
              Найдите существующий профиль без членства в этой общине, проверьте
              данные и назначьте роль.
            </p>
          </div>
          <button
            aria-label="Закрыть добавление участника"
            className="member-detail-drawer__close"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="member-add-dialog__body">
          <section className="member-add-dialog__section">
            <form className="member-add-search" onSubmit={handleSearchSubmit}>
              <label className="filter-field">
                <span>Поиск профиля</span>
                <input
                  autoFocus
                  disabled={searchLoading || saving}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Имя, email, телефон, город или ID"
                  type="search"
                  value={search}
                />
              </label>
              <Button disabled={searchLoading || saving} type="submit" variant="primary">
                {searchLoading ? "Ищем..." : "Найти"}
              </Button>
            </form>

            {searchError ? (
              <p
                className="member-membership-feedback member-membership-feedback--error"
                role="alert"
              >
                {searchError}
              </p>
            ) : null}

            <SearchResults
              loading={searchLoading}
              onSelectProfile={(profile) => void selectProfile(profile)}
              profiles={visibleProfiles}
              searched={searched}
              selectedUserId={selectedMember?.userId ?? null}
            />
          </section>

          <section className="member-add-dialog__section">
            <h3>Профиль и членство</h3>
            {!selectedMember ? (
              <p className="member-detail-empty">
                Выберите профиль приложения из результатов поиска.
              </p>
            ) : profileLoading ? (
              <p className="member-add-state" role="status">
                Загружаем профиль...
              </p>
            ) : profileError ? (
              <p
                className="member-membership-feedback member-membership-feedback--error"
                role="alert"
              >
                {profileError}
              </p>
            ) : profileDraft && selectedDetail ? (
              <form className="member-add-form" onSubmit={handleSave}>
                <SelectedProfileSummary member={selectedDetail} />

                <div className="member-membership-fields">
                  <label className="member-membership-field">
                    <span>Роль</span>
                    <select
                      disabled={saving}
                      onChange={(event) =>
                        setMembershipRole(
                          event.target.value as AdminMemberMembershipRole,
                        )
                      }
                      value={membershipRole}
                    >
                      {ADMIN_MEMBER_MEMBERSHIP_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {MEMBERSHIP_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="member-membership-field">
                    <span>Статус</span>
                    <select
                      disabled={saving}
                      onChange={(event) =>
                        setMembershipStatus(event.target.value as AddMemberStatus)
                      }
                      value={membershipStatus}
                    >
                      {ADD_MEMBER_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {ADD_MEMBER_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <AdminMemberProfileForm
                  disabled={saving}
                  draft={profileDraft}
                  onChange={setProfileDraft}
                />

                {saveError ? (
                  <p
                    className="member-membership-feedback member-membership-feedback--error"
                    role="alert"
                  >
                    {saveError}
                  </p>
                ) : null}

                <div className="member-membership-actions">
                  <Button disabled={saving} onClick={onClose} variant="ghost">
                    Отмена
                  </Button>
                  <Button disabled={!canSave} type="submit" variant="primary">
                    {saving ? "Сохраняем..." : "Добавить участника"}
                  </Button>
                </div>
              </form>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}

function SearchResults({
  loading,
  onSelectProfile,
  profiles,
  searched,
  selectedUserId,
}: {
  loading: boolean;
  onSelectProfile: (profile: AdminMemberListRow) => void;
  profiles: AdminMemberListRow[];
  searched: boolean;
  selectedUserId: string | null;
}) {
  if (loading) {
    return (
      <p className="member-add-state" role="status">
        Ищем профили приложения...
      </p>
    );
  }

  if (!searched) {
    return (
      <p className="member-detail-empty">
        Введите имя, email, телефон, город или ID существующего профиля.
      </p>
    );
  }

  if (profiles.length === 0) {
    return (
      <p className="member-detail-empty">
        Профили без членства в этой общине не найдены.
      </p>
    );
  }

  return (
    <div
      aria-label="Найденные профили приложения"
      className="member-add-results"
      role="listbox"
    >
      {profiles.map((profile) => (
        <button
          aria-selected={profile.userId === selectedUserId}
          className={[
            "member-add-result",
            profile.userId === selectedUserId ? "member-add-result--selected" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          key={profile.userId}
          onClick={() => onSelectProfile(profile)}
          role="option"
          type="button"
        >
          <span className="member-add-result__main">
            <strong>{profile.displayName}</strong>
            <span>{profile.email ?? "email не указан"}</span>
            <small>{formatProfileMeta(profile)}</small>
          </span>
          <Badge tone="muted">Нет членства</Badge>
        </button>
      ))}
    </div>
  );
}

function SelectedProfileSummary({ member }: { member: AdminMemberListRow }) {
  return (
    <div className="member-add-selected">
      <div>
        <strong>{member.displayName}</strong>
        <span>{member.email ?? "email не указан"}</span>
      </div>
      <Badge tone="blue">Существующий профиль</Badge>
    </div>
  );
}

function formatProfileMeta(profile: AdminMemberListRow): string {
  return [
    profile.phone ? `Телефон: ${profile.phone}` : null,
    profile.city ? `Город: ${profile.city}` : null,
    `ID: ${profile.userId}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
