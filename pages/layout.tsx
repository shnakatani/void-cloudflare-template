import type { ReactNode } from "react";

// root layout が読む CSS は、Void がこの layout の下のすべてのページの <head> に載せる
import "@/styles.css";

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
