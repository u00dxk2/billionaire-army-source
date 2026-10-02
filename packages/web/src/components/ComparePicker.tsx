"use client";

import { useRouter } from "next/navigation";

interface PickerPerson {
  id: string;
  name: string;
}

export default function ComparePicker({
  persons,
  a,
  b,
}: {
  persons: PickerPerson[];
  a: string;
  b: string;
}) {
  const router = useRouter();

  function update(side: "a" | "b", id: string) {
    const params = new URLSearchParams();
    const next = { a, b, [side]: id };
    if (next.a) params.set("a", next.a);
    if (next.b) params.set("b", next.b);
    router.replace(`/compare?${params.toString()}`);
  }

  return (
    <div className="filter-bar">
      <select
        className="form-input filter-select"
        value={a}
        onChange={(e) => update("a", e.target.value)}
        aria-label="Choose first billionaire"
      >
        <option value="">Choose a billionaire…</option>
        {persons.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="compare-vs">vs</span>
      <select
        className="form-input filter-select"
        value={b}
        onChange={(e) => update("b", e.target.value)}
        aria-label="Choose second billionaire"
      >
        <option value="">Choose a billionaire…</option>
        {persons.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
