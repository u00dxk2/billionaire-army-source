import ProposePersonForm from "@/components/ProposePersonForm";

export const dynamic = "force-dynamic";

export default function ProposeBillionairePage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: "1rem" }}>
      <ProposePersonForm />
    </div>
  );
}
