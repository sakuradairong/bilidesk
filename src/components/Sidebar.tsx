import type { PageId } from "../types";

const ITEMS: { id: PageId; label: string }[] = [
  { id: "home", label: "推荐" },
  { id: "featured", label: "精选" },
  { id: "search", label: "搜索" },
  { id: "history", label: "历史" },
];

type Props = {
  page: PageId;
  onChange: (page: PageId) => void;
};

export function Sidebar({ page, onChange }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <strong>BiliDesk</strong>
        <span>非官方客户端</span>
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={`nav-btn ${page === item.id ? "active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </aside>
  );
}
