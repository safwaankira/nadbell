export function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-24 flex-1 rounded-lg border border-border px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <input
        className="mt-1 w-full bg-transparent font-mono text-base outline-none"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
      />
    </label>
  );
}
