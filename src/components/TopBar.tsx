import type { FormEvent } from "react";
import type { Profile } from "../types";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  onSearch: (value: string) => void;
  profile: Profile | null;
  onLogin: () => void;
  onLogout: () => void;
};

export function TopBar({ query, onQuery, onSearch, profile, onLogin, onLogout }: Props) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(query.trim());
  }

  return (
    <form className="topbar" onSubmit={submit}>
      <input
        className="search-box"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="搜索视频"
      />
      <button className="primary-btn" type="submit">
        搜索
      </button>
      {profile?.is_login ? (
        <button className="user-chip" type="button" onClick={onLogout} title="点击退出登录">
          {profile.face ? <img src={profile.face} alt="" /> : null}
          {profile.name}
        </button>
      ) : (
        <button className="ghost-btn" type="button" onClick={onLogin}>
          登录
        </button>
      )}
    </form>
  );
}
