import type { Metadata } from "next";
import "./globals.css";
import "./community.css";
import CommentDraftSuccessGuard from "./comment-draft-success-guard";

export const metadata: Metadata = {
  title: "LINEレンジャー レジェンド帯キャラ集計＋新キャラ情報掲示板｜確認版",
  description: "元のレジェンド帯PvPキャラクター集計を忠実に維持し、新キャラ情報掲示板を同一サイトへ併設した確認版。",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  icons: {icon: "/favicon.svg"},
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode;}>) {
  return <html lang="ja" className="dark"><body className="antialiased"><CommentDraftSuccessGuard />{children}</body></html>;
}
