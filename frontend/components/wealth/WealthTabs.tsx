"use client";

/** 재테크 하위 메뉴 공통 탭 — 세 페이지가 같은 내비게이션을 공유한다 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building, ClipboardCheck, BookOpen } from "lucide-react";

const TABS = [
  { href: "/wealth/subscription", label: "신규 청약 정보", icon: Building },
  { href: "/wealth/apartment",    label: "아파트 선택 방법", icon: ClipboardCheck },
  { href: "/wealth/terms",        label: "용어 설명",       icon: BookOpen },
];

export function WealthTabs() {
  const path = usePathname();
  return (
    <div className="flex flex-wrap gap-1.5">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = path === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={14} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
