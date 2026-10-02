import AdminReview from "@/components/AdminReview";
import AdminComments from "@/components/AdminComments";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Review Queue — Billionaire Army",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.5rem",
        paddingTop: "1rem",
      }}
    >
      <AdminReview />
      {/* Comment moderation. The routes behind this shipped long before any way
          to reach them existed — see AdminComments.tsx for why that matters. */}
      <AdminComments />
    </div>
  );
}
