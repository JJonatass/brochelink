import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdminPage } from "@/lib/auth";

export const metadata = { title: { default: "Administração", template: "%s · Admin · BrocheLink" }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage("/admin");
  return (
    <div>
      <AdminNav />
      {children}
    </div>
  );
}
