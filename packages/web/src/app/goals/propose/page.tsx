import ProposeGoalForm from "@/components/ProposeGoalForm";

export const dynamic = "force-dynamic";

export default function ProposeGoalPage() {
  return (
    <div>
      <h1 className="page-title">Propose a Goal</h1>
      <p className="page-subtitle">
        Define a measurable, time-bound goal for billionaires to tackle.
      </p>
      <ProposeGoalForm />
    </div>
  );
}
