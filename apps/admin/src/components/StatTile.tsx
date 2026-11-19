/** One figure on a dashboard: a label, the value, and an optional note under it. */
export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="muted text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="muted text-xs">{note}</span>}
    </div>
  );
}
